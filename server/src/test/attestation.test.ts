// server/src/test/attestation.test.ts — T-043 acceptance (REC-003/SEC-7, DEC-013/DEC-016):
// GET /agent/attest-key and POST /devices/:id/attest.
// Why: the attestation is what stops a hostile page that can reach ws://127.0.0.1 from sending
// focus commands — the agent only unlocks control after verifying a cloud-signed, nonce-bound,
// 60-second EdDSA token. These tests verify the signature and every frozen claim **independently**
// with `node:crypto` (not with the signing module), so the format stays RFC 8037 EdDSA and the
// claims cannot silently drift. `jsonwebtoken` is not used here: it does not support EdDSA (DEC-016).
// Invariants asserted: EdDSA + 60 s TTL; sub=userId, aud=deviceId, nonce echoed; only the public
// key is exposed; owner + CONNECTED device required (404 / 409 NO_DEVICE_CONNECTED); 30/min/user.

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Types } from 'mongoose';
import { Device } from '../models/Device.js';
import { User } from '../models/User.js';
import {
  ATTESTATION_TTL_SECONDS,
  resetAttestationNonceCache,
  signDeviceAttestation,
} from '../services/attestation.service.js';
import {
  bearer,
  clearTestDatabase,
  createPairedTestDevice,
  createTestApp,
  markDeviceConnected,
  registerTestUser,
  startTestDatabase,
  stopTestDatabase,
} from './helpers.js';

const TEST_NONCE = 'nonce-0123456789abcdef';

let app: Express;
let accessToken: string;
let userId: string;
let deviceId: string;

interface SegmentedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

/** Split a compact JWS into its parts without trusting the server's own helper. */
function splitJwt(token: string): SegmentedJwt {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error(`not a compact JWT: ${token}`);
  }
  return {
    header: JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >,
    payload: JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >,
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature: Buffer.from(encodedSignature, 'base64url'),
  };
}

/** Independent Ed25519 signature check with node:crypto (DEC-016). */
function hasValidSignature(publicKeyPem: string, token: string): boolean {
  const { signingInput, signature } = splitJwt(token);
  return cryptoVerify(
    null,
    Buffer.from(signingInput, 'utf8'),
    createPublicKey(publicKeyPem),
    signature,
  );
}

async function attest(nonce: string) {
  return request(app)
    .post(`/api/v1/devices/${deviceId}/attest`)
    .set(bearer(accessToken))
    .send({ nonce });
}

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
  // Fresh app per test → fresh 30/min/user attest counter and deterministic 429 test; the
  // server-side nonce replay cache is process-local, so reset it for test isolation too.
  resetAttestationNonceCache();
  app = createTestApp();
  const registration = await registerTestUser(app);
  accessToken = registration.response.body.data.accessToken as string;
  userId = registration.response.body.data.user.id as string;
  const paired = await createPairedTestDevice(app, accessToken);
  deviceId = paired.deviceId;
  await markDeviceConnected(deviceId);
});

describe('GET /api/v1/agent/attest-key (contract §3.1 #40)', () => {
  it('serves the EdDSA public key without authentication and never the private key', async () => {
    const response = await request(app).get('/api/v1/agent/attest-key');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { algorithm: 'EdDSA' },
    });
    const publicKey = response.body.data.publicKey as string;
    expect(publicKey).toContain('-----BEGIN PUBLIC KEY-----');
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE KEY');
  });
});

describe('POST /api/v1/devices/:id/attest (contract §3.1 #11, REC-003)', () => {
  it('issues a verifiable EdDSA JWT binding nonce + sub(user) + aud(device) with a 60 s TTL', async () => {
    const keyResponse = await request(app).get('/api/v1/agent/attest-key');
    const publicKeyPem = keyResponse.body.data.publicKey as string;

    const response = await attest(TEST_NONCE);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { algorithm: 'EdDSA' },
    });
    const { attestation, expiresAt } = response.body.data as {
      attestation: string;
      expiresAt: string;
    };

    const segments = splitJwt(attestation);
    expect(segments.header).toMatchObject({ alg: 'EdDSA', typ: 'JWT' });
    expect(segments.payload).toMatchObject({
      sub: userId,
      aud: deviceId,
      nonce: TEST_NONCE,
      iss: 'focus-mode-api',
    });
    expect(hasValidSignature(publicKeyPem, attestation)).toBe(true);

    const issuedAt = segments.payload.iat as number;
    const expiresAtSeconds = segments.payload.exp as number;
    expect(expiresAtSeconds - issuedAt).toBe(60);
    expect(expiresAtSeconds).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60);
    expect(Date.parse(expiresAt)).toBe(expiresAtSeconds * 1000);
  });

  it('produces a different attestation per nonce (single-use challenge binding)', async () => {
    const first = await attest('nonce-aaaaaaaaaaaaaaaa');
    const second = await attest('nonce-bbbbbbbbbbbbbbbb');

    expect(first.body.data.attestation).not.toBe(second.body.data.attestation);
    expect(splitJwt(first.body.data.attestation).payload.nonce).toBe('nonce-aaaaaaaaaaaaaaaa');
    expect(splitJwt(second.body.data.attestation).payload.nonce).toBe('nonce-bbbbbbbbbbbbbbbb');
  });

  it('answers 409 NO_DEVICE_CONNECTED for a paired but offline device', async () => {
    await Device.updateOne({ _id: deviceId }, { $set: { status: 'DISCONNECTED' } });

    const response = await attest(TEST_NONCE);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('NO_DEVICE_CONNECTED');
  });

  it('answers 404 for a device owned by another user (never reveals existence)', async () => {
    const other = await registerTestUser(app, { email: 'other@example.com' });
    const otherToken = other.response.body.data.accessToken as string;

    const response = await request(app)
      .post(`/api/v1/devices/${deviceId}/attest`)
      .set(bearer(otherToken))
      .send({ nonce: TEST_NONCE });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('requires authentication (401) and rejects ADMIN tokens (403)', async () => {
    const unauthenticated = await request(app)
      .post(`/api/v1/devices/${deviceId}/attest`)
      .send({ nonce: TEST_NONCE });
    expect(unauthenticated.status).toBe(401);

    await User.create({
      name: 'Admin Test',
      email: 'admin.test@demo.com',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin.test@demo.com', password: 'Admin@123' });
    const adminToken = login.body.data.accessToken as string;

    const asAdmin = await request(app)
      .post(`/api/v1/devices/${deviceId}/attest`)
      .set(bearer(adminToken))
      .send({ nonce: TEST_NONCE });

    expect(asAdmin.status).toBe(403);
    expect(asAdmin.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a nonce outside 16–128 URL-safe characters with 400 VALIDATION_ERROR', async () => {
    const response = await attest('short');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toContainEqual(expect.objectContaining({ path: 'nonce' }));
  });

  it('enforces 30 attestation requests per minute per user (31st → 429)', async () => {
    // A distinct nonce per request: the same nonce is now single-use (W6/SEC-7) and would 409.
    const nonceForAttempt = (attempt: number): string =>
      `nonce-${String(attempt).padStart(20, '0')}`;
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const response = await attest(nonceForAttempt(attempt));
      expect(response.status).toBe(200);
    }

    const throttled = await attest(nonceForAttempt(31));

    expect(throttled.status).toBe(429);
    expect(throttled.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('attestation nonce replay hardening (W6/SEC-7, delta C-26)', () => {
  it('rejects a replayed (userId, deviceId, nonce) tuple with 409 CONFLICT', async () => {
    const first = await attest(TEST_NONCE);
    expect(first.status).toBe(200);

    const replay = await attest(TEST_NONCE);

    expect(replay.status).toBe(409);
    expect(replay.body.success).toBe(false);
    expect(replay.body.error.code).toBe('CONFLICT');
    expect(replay.body.error.message).toContain('already used');
    expect(replay.body.data).toBeUndefined();

    // A fresh challenge nonce still works for the same device.
    const fresh = await attest('nonce-fedcba9876543210');
    expect(fresh.status).toBe(200);
  });

  it('allows the same nonce again after the 60 s attestation TTL has elapsed', () => {
    resetAttestationNonceCache();
    const nonce = 'nonce-expiry-0123456789';
    const nowMs = Date.now();

    const first = signDeviceAttestation({ userId, deviceId, nonce }, { now: () => nowMs });
    expect(typeof first.attestation).toBe('string');
    expect(() =>
      signDeviceAttestation({ userId, deviceId, nonce }, { now: () => nowMs + 1_000 }),
    ).toThrow(/already used/i);

    const afterTtlMs = nowMs + (ATTESTATION_TTL_SECONDS + 1) * 1000;
    expect(() =>
      signDeviceAttestation({ userId, deviceId, nonce }, { now: () => afterTtlMs }),
    ).not.toThrow();
  });

  it('scopes the replay cache per user/device (same nonce for another device is allowed)', () => {
    resetAttestationNonceCache();
    const nonce = 'nonce-scope-0123456789';
    const otherDeviceId = new Types.ObjectId().toHexString();

    expect(() => signDeviceAttestation({ userId, deviceId, nonce })).not.toThrow();
    expect(() => signDeviceAttestation({ userId, deviceId, nonce })).toThrow(/already used/i);
    expect(() => signDeviceAttestation({ userId, deviceId: otherDeviceId, nonce })).not.toThrow();
  });
});
