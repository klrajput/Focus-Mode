// server/src/test/settings.test.ts — T-072 acceptance: /users/me, password change, unpair-all and the
// public agent-links endpoint (FR-029/FR-019, contract §3.1 #6/#7/#25 + W5 additive endpoints).
// Why: the settings page is the only place a user changes their own account; the password flow must
// prove the old credential stops working and the new one works, and unpair-all must revoke every
// device token (pushing `revoked` to each connected agent) without touching other accounts.
// Invariants asserted: `auth` label = any active user (ADMIN may manage its own profile) while
// unpair-all is USER-only (403 for ADMIN); bodies use the frozen shared schemas (400 on unknown /
// empty / invalid values); profile responses never contain `passwordHash`; password wrong current →
// 401 UNAUTHENTICATED; unpair-all is owner-scoped and revokes agent sockets via the hub.

import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { AgentLink } from '../models/AgentLink.js';
import { Device } from '../models/Device.js';
import { User } from '../models/User.js';
import { hashDeviceToken } from '../utils/device-token.js';
import {
  bearer,
  clearTestDatabase,
  createDirectUser,
  createTestApp,
  createTestDevice,
  registerTestUser,
  startTestDatabase,
  stopTestDatabase,
  TEST_PASSWORD,
} from './helpers.js';

// The unpair-all route pushes `revoked` through the hub; mock it so no WebSocket is required and
// the call itself is asserted.
vi.mock('../realtime/agentHub.js', () => ({
  revokeDevice: vi.fn(async () => true),
}));
import { revokeDevice } from '../realtime/agentHub.js';

let app: Express;
let accessToken: string;
let userId: string;

async function adminToken(): Promise<string> {
  const email = 'admin.settings@demo.com';
  if ((await User.findOne({ email })) === null) {
    await createDirectUser({ email, role: 'ADMIN' });
  }
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: TEST_PASSWORD });
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
  app = createTestApp();
  const registration = await registerTestUser(app);
  accessToken = registration.response.body.data.accessToken as string;
  userId = registration.response.body.data.user.id as string;
});

describe('GET/PATCH /api/v1/users/me (contract §3.1 #6 + W5 additive GET, delta C-21)', () => {
  it('returns the authenticated public user without a password hash', async () => {
    const response = await request(app).get('/api/v1/users/me').set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data).sort()).toEqual(
      [
        'createdAt',
        'defaultDurationMin',
        'email',
        'id',
        'isActive',
        'lastLoginAt',
        'name',
        'role',
        'timezone',
      ].sort(),
    );
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('updates name, timezone and defaultDurationMin and persists them', async () => {
    const response = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(accessToken))
      .send({ name: 'Kabir Edited', timezone: 'Europe/London', defaultDurationMin: 50 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      name: 'Kabir Edited',
      timezone: 'Europe/London',
      defaultDurationMin: 50,
      email: 'kabir.test@demo.com',
    });
    const stored = await User.findById(userId).lean();
    expect(stored).toMatchObject({
      name: 'Kabir Edited',
      timezone: 'Europe/London',
      defaultDurationMin: 50,
    });
  });

  it('validates the frozen profile schema (empty, bad timezone, bounds, unknown fields)', async () => {
    const requests = [
      {},
      { timezone: 'Mars/Olympus' },
      { defaultDurationMin: 0 },
      { defaultDurationMin: 481 },
      { name: 'A' },
      { role: 'ADMIN' },
    ];
    for (const body of requests) {
      const response = await request(app)
        .patch('/api/v1/users/me')
        .set(bearer(accessToken))
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('requires authentication (401) but allows an ADMIN to read/update its own profile (auth label)', async () => {
    const unauthenticated = await request(app).get('/api/v1/users/me');
    const asAdmin = await request(app)
      .get('/api/v1/users/me')
      .set(bearer(await adminToken()));
    const adminUpdate = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(await adminToken()))
      .send({ name: 'Admin Renamed' });

    expect(unauthenticated.status).toBe(401);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data.role).toBe('ADMIN');
    expect(adminUpdate.status).toBe(200);
    expect(adminUpdate.body.data.name).toBe('Admin Renamed');
  });
});

describe('POST /api/v1/users/me/password (contract §3.1 #7)', () => {
  it('changes the password: old password stops working, new one logs in', async () => {
    const change = await request(app)
      .post('/api/v1/users/me/password')
      .set(bearer(accessToken))
      .send({ currentPassword: 'Kabir@123', newPassword: 'NewPass@456' });

    expect(change.status).toBe(200);
    expect(change.body).toEqual({ success: true, data: { changed: true } });

    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'kabir.test@demo.com', password: 'Kabir@123' });
    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'kabir.test@demo.com', password: 'NewPass@456' });

    expect(oldLogin.status).toBe(401);
    expect(oldLogin.body.error.code).toBe('UNAUTHENTICATED');
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.data.accessToken).toEqual(expect.any(String));
  });

  it('answers 401 UNAUTHENTICATED for a wrong current password', async () => {
    const response = await request(app)
      .post('/api/v1/users/me/password')
      .set(bearer(accessToken))
      .send({ currentPassword: 'Wrong@123', newPassword: 'NewPass@456' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(response.body.error.message).toBe('Current password is incorrect.');
  });

  it('validates the shared password schema (weak, same-as-current, unknown field)', async () => {
    const weak = await request(app)
      .post('/api/v1/users/me/password')
      .set(bearer(accessToken))
      .send({ currentPassword: 'Kabir@123', newPassword: 'weak' });
    const same = await request(app)
      .post('/api/v1/users/me/password')
      .set(bearer(accessToken))
      .send({ currentPassword: 'Kabir@123', newPassword: 'Kabir@123' });
    const unknown = await request(app)
      .post('/api/v1/users/me/password')
      .set(bearer(accessToken))
      .send({ currentPassword: 'Kabir@123', newPassword: 'NewPass@456', confirm: 'x' });

    for (const response of [weak, same, unknown]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('requires authentication (401)', async () => {
    const response = await request(app)
      .post('/api/v1/users/me/password')
      .send({ currentPassword: 'Kabir@123', newPassword: 'NewPass@456' });

    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/devices/unpair-all (FR-029, W5 additive endpoint delta C-23)', () => {
  it('revokes every owned device via the hub and deletes the pairings', async () => {
    const first = await createTestDevice({ ownerId: new Types.ObjectId(userId), name: 'Mac A' });
    const second = await createTestDevice({ ownerId: new Types.ObjectId(userId), name: 'Mac B' });

    const response = await request(app).post('/api/v1/devices/unpair-all').set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { unpaired: 2 } });
    expect(vi.mocked(revokeDevice)).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(revokeDevice)
        .mock.calls.map(([id]) => id)
        .sort(),
    ).toEqual([first.deviceId, second.deviceId].sort());
    expect(await Device.countDocuments({ ownerId: userId })).toBe(0);
    // Tokens are gone with the rows: the old token hashes no longer resolve.
    expect(await Device.countDocuments({ deviceTokenHash: hashDeviceToken(first.token) })).toBe(0);
  });

  it('never touches another user’s devices and is idempotent (second call → 0)', async () => {
    const other = await createDirectUser();
    const otherDevice = await createTestDevice({ ownerId: other._id });
    const ownDevice = await createTestDevice({ ownerId: new Types.ObjectId(userId) });

    const firstCall = await request(app)
      .post('/api/v1/devices/unpair-all')
      .set(bearer(accessToken));
    const secondCall = await request(app)
      .post('/api/v1/devices/unpair-all')
      .set(bearer(accessToken));

    expect(firstCall.body.data.unpaired).toBe(1);
    expect(secondCall.body.data.unpaired).toBe(0);
    expect(await Device.findById(otherDevice.deviceId)).not.toBeNull();
    expect(await Device.findById(ownDevice.deviceId)).toBeNull();
    expect(vi.mocked(revokeDevice)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(revokeDevice)).toHaveBeenCalledWith(ownDevice.deviceId);
  });

  it('requires authentication (401) and rejects ADMIN tokens (403, USER label)', async () => {
    const unauthenticated = await request(app).post('/api/v1/devices/unpair-all');
    const asAdmin = await request(app)
      .post('/api/v1/devices/unpair-all')
      .set(bearer(await adminToken()));

    expect(unauthenticated.status).toBe(401);
    expect(asAdmin.status).toBe(403);
    expect(asAdmin.body.error.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/v1/agent-links (contract §3.1 #25, public)', () => {
  async function createAgentLink(overrides: Partial<Record<string, unknown>> = {}) {
    return AgentLink.create({
      os: 'macOS',
      arch: 'arm64',
      label: 'macOS (Apple silicon)',
      url: 'https://github.com/klrajput/Focus-Mode/releases/download/v1.4.0/Focus-Mode-1.4.0-arm64.dmg',
      version: '1.4.0',
      publishedBy: new Types.ObjectId(),
      publishedAt: new Date('2026-11-01T10:00:00.000Z'),
      ...overrides,
    });
  }

  it('serves published links to anonymous callers (no auth header needed)', async () => {
    await createAgentLink();
    await createAgentLink({
      os: 'windows',
      arch: 'x64',
      label: 'Windows 10/11 (x64)',
      url: 'https://github.com/klrajput/Focus-Mode/releases/download/v1.4.0/Focus-Mode-Setup-1.4.0.exe',
    });

    const response = await request(app).get('/api/v1/agent-links');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
    const item = response.body.data.items[0] as Record<string, unknown>;
    expect(Object.keys(item).sort()).toEqual(
      ['arch', 'id', 'label', 'os', 'publishedAt', 'url', 'version'].sort(),
    );
    expect(item.publishedAt).toBe('2026-11-01T10:00:00.000Z');
    expect(JSON.stringify(response.body)).not.toContain('publishedBy');
    // Deterministic order: Windows < macOS is false lexicographically, so macOS sorts first.
    expect(response.body.data.items.map((link: { os: string }) => link.os)).toEqual([
      'macOS',
      'windows',
    ]);
  });

  it('paginates and returns an empty page when nothing is published', async () => {
    const empty = await request(app).get('/api/v1/agent-links');
    await createAgentLink();
    await createAgentLink({
      os: 'linux',
      arch: 'x64',
      label: 'Linux (x64)',
      url: 'https://example.com/a.AppImage',
    });
    const paged = await request(app).get('/api/v1/agent-links?page=2&limit=1');
    const badQuery = await request(app).get('/api/v1/agent-links?sort=name');

    expect(empty.body.data).toMatchObject({ items: [], total: 0, totalPages: 0 });
    expect(paged.status).toBe(200);
    expect(paged.body.data).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2 });
    expect(badQuery.status).toBe(400);
  });
});
