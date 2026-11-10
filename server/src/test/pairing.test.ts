// server/src/test/pairing.test.ts — T-040 acceptance (FR-003/FR-026, REC-002, DEC-014):
// agent pre-register → dashboard pair → agent enroll poll, plus GET/DELETE /devices.
// Why: this is the security-critical handshake that links a machine to an account; the tests drive
// the real Express app + real MongoDB and re-derive every hash independently with `node:crypto`
// (never with the modules under test) so "only hashes at rest" and the two-stage digest are proven,
// not assumed. The T-041 hub is mocked so DELETE can assert the `revoked` push without a socket.
// Invariants asserted: no plaintext code/secret/token in DB; single-use code and enrollment;
// 10-min TTL; 5 failed guesses then 410; wrong code → 400 INVALID_PAIRING_CODE; owner scoping
// (foreign device = 404); contract rate limits (5/min register, 10/min pair); USER-only access.

import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { Allowlist } from '../models/Allowlist.js';
import { Device } from '../models/Device.js';
import { hasCompleteProtectedSet } from '../models/protected-apps.js';
import { User } from '../models/User.js';
import {
  bearer,
  clearTestDatabase,
  createPairedTestDevice,
  createTestApp,
  pairTestDevice,
  pollTestDevice,
  registerTestDevice,
  registerTestUser,
  startTestDatabase,
  stopTestDatabase,
  testPairingCode,
} from './helpers.js';

// T-041's hub is a WebSocket side-effect; the DELETE route's contract is "call revokeDevice(id)".
vi.mock('../realtime/agentHub.js', () => ({
  revokeDevice: vi.fn(async () => true),
}));
import { revokeDevice } from '../realtime/agentHub.js';

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

let app: Express;
let accessToken: string;
let userId: string;

async function adminToken(): Promise<string> {
  await User.create({
    name: 'Admin Test',
    email: 'admin.test@demo.com',
    passwordHash: await bcrypt.hash('Admin@123', 12),
    role: 'ADMIN',
  });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin.test@demo.com', password: 'Admin@123' });
  return login.body.data.accessToken as string;
}

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
  vi.mocked(revokeDevice).mockClear();
  // Fresh app per test → fresh in-memory rate-limit stores, so the SEC-4 limits are deterministic.
  app = createTestApp();
  const registration = await registerTestUser(app);
  expect(registration.response.status).toBe(201);
  accessToken = registration.response.body.data.accessToken as string;
  userId = registration.response.body.data.user.id as string;
});

describe('POST /api/v1/agent/register (contract §3.1 #37, DEC-014 step 1)', () => {
  it('stores only hashes: peppered code digest, enroll-secret hash, 10-min TTL', async () => {
    const code = testPairingCode();
    const registered = await registerTestDevice(app, { code, name: 'Kabir-MacBook' });

    expect(registered.deviceId).toMatch(/^[a-f0-9]{24}$/);
    expect(registered.enrollSecret).toMatch(/^[A-Za-z0-9_-]{32,128}$/);

    const device = await Device.findById(registered.deviceId).lean();
    expect(device).not.toBeNull();
    expect(device?.ownerId).toBeNull();
    expect(device?.status).toBe('DISCONNECTED');
    expect(device?.deviceTokenHash).toBeNull();
    expect(device?.pairedAt).toBeNull();
    // Stage-2 digest is 64-char hex and is NOT the code (or its agent-side digest) in plaintext.
    expect(device?.pairTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(device?.pairTokenHash).not.toBe(code);
    expect(device?.pairTokenHash).not.toBe(registered.codeHmac);
    // The one-time enroll secret is stored as an independent SHA-256 only.
    expect(device?.enrollSecretHash).toBe(sha256Hex(registered.enrollSecret));
    expect(device?.pairAttempts).toBe(0);

    const ttlMs = (device?.pairExpiresAt?.getTime() ?? 0) - Date.now();
    expect(ttlMs).toBeGreaterThan(9 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it('is idempotency-safe: the same code digest twice answers 409 CONFLICT', async () => {
    const first = await registerTestDevice(app, { code: '123456' });
    const second = await request(app).post('/api/v1/agent/register').send({
      codeHmac: first.codeHmac,
      os: 'macOS',
      name: 'Second-TestBook',
      agentVersion: '1.4.0',
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
    expect(await Device.countDocuments()).toBe(1);
  });

  it('rejects a malformed code digest with 400 VALIDATION_ERROR', async () => {
    const response = await request(app).post('/api/v1/agent/register').send({
      codeHmac: 'not-a-digest',
      os: 'macOS',
      name: 'Kabir-MacBook',
      agentVersion: '1.4.0',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/devices/pair (contract §3.1 #8, DEC-014 step 3)', () => {
  it('pairs with the typed code, binds the owner, clears the digest and seeds the allow-list', async () => {
    const registered = await registerTestDevice(app, { code: testPairingCode() });
    const response = await pairTestDevice(app, accessToken, registered.code);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        device: {
          id: registered.deviceId,
          name: 'Kabir-TestBook',
          os: 'macOS',
          status: 'DISCONNECTED',
          agentVersion: '1.4.0',
          lastSeenAt: null,
        },
      },
    });
    expect(response.body.data.device.pairedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    // No token may reach the browser: the device token is delivered to the agent by poll only.
    expect(JSON.stringify(response.body)).not.toContain('deviceToken');

    const device = await Device.findById(registered.deviceId).lean();
    expect(String(device?.ownerId)).toBe(userId);
    expect(device?.pairTokenHash).toBeNull();
    expect(device?.pairExpiresAt).toBeNull();
    expect(device?.pairedAt).toBeInstanceOf(Date);
    // The one-time enroll secret stays valid until the agent polls, then it is consumed.
    expect(device?.enrollSecretHash).toBe(sha256Hex(registered.enrollSecret));

    const allowlist = await Allowlist.findOne({ userId }).lean();
    expect(allowlist?.version).toBe(1);
    expect(allowlist?.userApps).toEqual([]);
    expect(hasCompleteProtectedSet(allowlist?.protectedApps ?? [])).toBe(true);
  });

  it('applies the optional device name from the dashboard', async () => {
    const registered = await registerTestDevice(app);
    const response = await pairTestDevice(app, accessToken, registered.code, 'Office-PC');

    expect(response.status).toBe(200);
    expect(response.body.data.device.name).toBe('Office-PC');
  });

  it('answers 400 INVALID_PAIRING_CODE for a wrong code and does not bind anything', async () => {
    const registered = await registerTestDevice(app, { code: '123456' });
    const response = await pairTestDevice(app, accessToken, '654321');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PAIRING_CODE');
    const device = await Device.findById(registered.deviceId).lean();
    expect(device?.ownerId).toBeNull();
  });

  it('answers 410 PAIRING_EXPIRED for an expired pending device and invalidates it', async () => {
    const registered = await registerTestDevice(app);
    await Device.updateOne(
      { _id: registered.deviceId },
      { $set: { pairExpiresAt: new Date(Date.now() - 1000) } },
    );

    const response = await pairTestDevice(app, accessToken, registered.code);

    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('PAIRING_EXPIRED');
    expect(await Device.findById(registered.deviceId)).toBeNull();
  });

  it('allows 5 failed guesses (400) then latches pairing with 410 PAIRING_EXPIRED', async () => {
    const registered = await registerTestDevice(app, { code: '123456' });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await pairTestDevice(app, accessToken, '999999');
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_PAIRING_CODE');
    }

    const sixth = await pairTestDevice(app, accessToken, '999999');
    expect(sixth.status).toBe(410);
    expect(sixth.body.error.code).toBe('PAIRING_EXPIRED');

    // The latch is the "code invalidated" behaviour: even the correct code is refused now.
    const withCorrectCode = await pairTestDevice(app, accessToken, registered.code);
    expect(withCorrectCode.status).toBe(410);
    expect((await Device.findById(registered.deviceId).lean())?.ownerId).toBeNull();
  });

  it('enforces 10 pairing attempts per minute per user (11th → 429)', async () => {
    const statuses: number[] = [];
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      const response = await pairTestDevice(app, accessToken, '000000');
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses[10]).toBe(429);
  });
});

describe('POST /api/v1/agent/enroll/poll (contract §3.1 #38, DEC-014 step 5)', () => {
  it('returns the device token exactly once and records only its hash', async () => {
    const registered = await registerTestDevice(app);
    await pairTestDevice(app, accessToken, registered.code);

    const poll = await pollTestDevice(app, registered.deviceId, registered.enrollSecret);

    expect(poll.status).toBe(200);
    expect(poll.body).toMatchObject({
      success: true,
      data: { userId, allowListVersion: 1 },
    });
    const deviceToken = poll.body.data.deviceToken as string;
    expect(deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256-bit base64url

    const device = await Device.findById(registered.deviceId).lean();
    expect(device?.deviceTokenHash).toBe(sha256Hex(deviceToken));
    expect(device?.deviceTokenHash).not.toBe(deviceToken);
    expect(device?.enrollSecretHash).toBeNull();
  });

  it('answers 410 PAIRING_EXPIRED on the second poll (single-use enrollment)', async () => {
    const registered = await registerTestDevice(app);
    await pairTestDevice(app, accessToken, registered.code);
    const first = await pollTestDevice(app, registered.deviceId, registered.enrollSecret);
    expect(first.status).toBe(200);

    const second = await pollTestDevice(app, registered.deviceId, registered.enrollSecret);

    expect(second.status).toBe(410);
    expect(second.body.error.code).toBe('PAIRING_EXPIRED');
    expect(second.body).not.toHaveProperty('data');
  });

  it('answers 404 NOT_FOUND for a wrong enroll secret', async () => {
    const registered = await registerTestDevice(app);
    await pairTestDevice(app, accessToken, registered.code);

    const poll = await pollTestDevice(app, registered.deviceId, 'x'.repeat(43));

    expect(poll.status).toBe(404);
    expect(poll.body.error.code).toBe('NOT_FOUND');
  });

  it('never issues a token for an unpaired pending device (404)', async () => {
    const registered = await registerTestDevice(app);

    const poll = await pollTestDevice(app, registered.deviceId, registered.enrollSecret);

    expect(poll.status).toBe(404);
    expect(poll.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(poll.body)).not.toContain('deviceToken');
  });
});

describe('GET /api/v1/devices (contract §3.1 #9, NFR-009)', () => {
  it('returns an empty paginated list for a user without paired devices (pending devices hidden)', async () => {
    await registerTestDevice(app);

    const response = await request(app).get('/api/v1/devices').set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { items: [], page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it('lists only the caller’s paired devices with the contract shape and pagination', async () => {
    await createPairedTestDevice(app, accessToken, { name: 'Kabir-MacBook' });
    await createPairedTestDevice(app, accessToken, { name: 'Office-PC' });

    const response = await request(app)
      .get('/api/v1/devices?page=1&limit=1')
      .set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(response.body.data.items).toHaveLength(1);
    const item = response.body.data.items[0] as Record<string, unknown>;
    expect(Object.keys(item).sort()).toEqual(
      ['agentVersion', 'id', 'lastSeenAt', 'name', 'os', 'pairedAt', 'status'].sort(),
    );
    expect(item.status).toBe('DISCONNECTED');
  });

  it('does not leak another user’s devices', async () => {
    await createPairedTestDevice(app, accessToken, { name: 'Kabir-MacBook' });
    const other = await registerTestUser(app, { email: 'other@demo.com' });
    const otherToken = other.response.body.data.accessToken as string;

    const response = await request(app).get('/api/v1/devices').set(bearer(otherToken));

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(0);
  });

  it('filters by search over the device name', async () => {
    await createPairedTestDevice(app, accessToken, { name: 'Kabir-MacBook' });
    await createPairedTestDevice(app, accessToken, { name: 'Office-PC' });

    const response = await request(app)
      .get('/api/v1/devices?search=office')
      .set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].name).toBe('Office-PC');
  });

  it('requires authentication (401) and rejects ADMIN tokens (403, contract §1.2 USER)', async () => {
    const unauthenticated = await request(app).get('/api/v1/devices');
    expect(unauthenticated.status).toBe(401);

    const admin = await request(app)
      .get('/api/v1/devices')
      .set(bearer(await adminToken()));
    expect(admin.status).toBe(403);
    expect(admin.body.error.code).toBe('FORBIDDEN');
  });
});

describe('DELETE /api/v1/devices/:id (contract §3.1 #10, INV-5)', () => {
  it('revokes the agent link, invalidates the device and removes it from the list', async () => {
    const paired = await createPairedTestDevice(app, accessToken);

    const response = await request(app)
      .delete(`/api/v1/devices/${paired.deviceId}`)
      .set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { id: paired.deviceId, revoked: true },
    });
    expect(vi.mocked(revokeDevice)).toHaveBeenCalledWith(paired.deviceId);
    expect(await Device.findById(paired.deviceId)).toBeNull();
    const remaining = await request(app).get('/api/v1/devices').set(bearer(accessToken));
    expect(remaining.body.data.total).toBe(0);
  });

  it('answers 404 for a device owned by another user and keeps it intact', async () => {
    const paired = await createPairedTestDevice(app, accessToken);
    const other = await registerTestUser(app, { email: 'other@demo.com' });
    const otherToken = other.response.body.data.accessToken as string;

    const response = await request(app)
      .delete(`/api/v1/devices/${paired.deviceId}`)
      .set(bearer(otherToken));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(await Device.findById(paired.deviceId)).not.toBeNull();
  });

  it('answers 404 on a second delete (idempotent from the client perspective)', async () => {
    const paired = await createPairedTestDevice(app, accessToken);
    await request(app).delete(`/api/v1/devices/${paired.deviceId}`).set(bearer(accessToken));

    const second = await request(app)
      .delete(`/api/v1/devices/${paired.deviceId}`)
      .set(bearer(accessToken));

    expect(second.status).toBe(404);
  });
});

describe('SEC-4 rate limit on agent registration', () => {
  it('answers 429 on the 6th registration from one IP in a minute', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const registered = await registerTestDevice(app, { code: testPairingCode() });
      expect(registered.deviceId).toMatch(/^[a-f0-9]{24}$/);
    }
    const sixth = await request(app)
      .post('/api/v1/agent/register')
      .send({
        codeHmac: 'a'.repeat(64),
        os: 'macOS',
        name: 'Rate-Limited-Book',
        agentVersion: '1.4.0',
      });

    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');
  });
});
