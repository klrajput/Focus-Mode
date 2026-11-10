// server/src/test/security-hardening.test.ts — W6 adversarial suite (SEC-1…SEC-10, task-38).
// Why: the shipped API must be attacked on purpose, not assumed safe. Each block below is an attack
// that a real reviewer (A9) or an evaluator would try: forged/expired/tampered JWTs (incl. alg=none
// and a correctly-signed ADMIN role claim), operator payloads, mass assignment, malformed ObjectIds,
// oversized bodies, CORS/helmet headers, rate-limit behaviour, and admin lock-out protections.
// Invariants asserted: every auth bypass is 401, a forged role never escalates (DB role is
// authoritative), malformed ids are 404 (never a 500/stack), operator keys are rejected before any
// query, credentials are never reflected cross-origin, and the limiter envelope/keys are correct.
// Exact evidence commands are listed in the task report (A9 writes docs/SECURITY_REVIEW.md).

import { createHash } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { env } from '../config/env.js';
import { errorHandler } from '../middlewares/error.js';
import { createRateLimiter } from '../middlewares/rateLimit.js';
import { Device } from '../models/Device.js';
import {
  bearer,
  clearTestDatabase,
  createDirectUser,
  createPairedTestDevice,
  createTestApp,
  registerTestUser,
  startTestDatabase,
  stopTestDatabase,
  TEST_PASSWORD,
} from './helpers.js';

const TEST_NONCE = 'nonce-0123456789abcdef';

let app: Express;
let accessToken: string;
let userId: string;

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

interface ClaimOverrides {
  secret?: string;
  issuer?: string;
  audience?: string;
  expiresIn?: number | string;
  subject?: string;
  claims?: Record<string, unknown>;
}

/** Sign a HS256 JWT with arbitrary (mis)configuration — mirrors what an attacker can craft. */
function signTestToken(overrides: ClaimOverrides = {}): string {
  return jwt.sign(overrides.claims ?? { role: 'USER' }, overrides.secret ?? env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: (overrides.expiresIn ?? 1800) as jwt.SignOptions['expiresIn'],
    issuer: overrides.issuer ?? 'focus-mode-api',
    audience: overrides.audience ?? 'focus-mode-dashboard',
    subject: overrides.subject ?? userId,
  });
}

function decodeSegments(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const [encodedHeader, encodedPayload] = token.split('.');
  if (!encodedHeader || !encodedPayload) throw new Error('malformed token in test');
  return {
    header: JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >,
    payload: JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >,
  };
}

async function adminToken(): Promise<string> {
  const email = 'admin.security@demo.com';
  await createDirectUser({ email, role: 'ADMIN' });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  return login.body.data.accessToken as string;
}

async function expectNoStack(response: { body: unknown }): Promise<void> {
  const serialized = JSON.stringify(response.body);
  expect(serialized).not.toContain('stack');
  expect(serialized).not.toContain('at Object.');
}

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
  app = createTestApp();
  const registration = await registerTestUser(app);
  accessToken = registration.response.body.data.accessToken as string;
  userId = registration.response.body.data.user.id as string;
});

// ---------------------------------------------------------------------------
// SEC-2: access-token hardening
// ---------------------------------------------------------------------------
describe('SEC-2 JWT hardening (auth bypass attempts)', () => {
  it('rejects an alg=none token (unsigned) with 401', async () => {
    const payload = base64UrlJson({
      sub: userId,
      role: 'ADMIN',
      iss: 'focus-mode-api',
      aud: 'focus-mode-dashboard',
      exp: Math.floor(Date.now() / 1000) + 1800,
      iat: Math.floor(Date.now() / 1000),
    });
    const noneToken = `${base64UrlJson({ alg: 'none', typ: 'JWT' })}.${payload}.`;

    const response = await request(app).get('/api/v1/auth/me').set(bearer(noneToken));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    await expectNoStack(response);
  });

  it('uses HS256 for real tokens and a 30-minute lifetime (SEC-2)', async () => {
    const decoded = decodeSegments(accessToken);
    expect(decoded.header.alg).toBe('HS256');
    const issuedAt = decoded.payload.iat as number;
    const expiresAt = decoded.payload.exp as number;
    expect(expiresAt - issuedAt).toBe(30 * 60);
    expect(decoded.payload.iss).toBe('focus-mode-api');
    expect(decoded.payload.aud).toBe('focus-mode-dashboard');
  });

  it('rejects a token signed with the wrong secret (401)', async () => {
    const forged = signTestToken({ secret: 'X'.repeat(48) });

    const response = await request(app).get('/api/v1/auth/me').set(bearer(forged));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a token with the wrong issuer or audience (401)', async () => {
    const wrongIssuer = signTestToken({ issuer: 'evil-issuer' });
    const wrongAudience = signTestToken({ audience: 'evil-audience' });

    const issuerResponse = await request(app).get('/api/v1/auth/me').set(bearer(wrongIssuer));
    const audienceResponse = await request(app).get('/api/v1/auth/me').set(bearer(wrongAudience));

    expect(issuerResponse.status).toBe(401);
    expect(audienceResponse.status).toBe(401);
  });

  it('rejects an expired token (401)', async () => {
    const expired = signTestToken({ expiresIn: '-1s' });

    const response = await request(app).get('/api/v1/auth/me').set(bearer(expired));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a tampered payload (403→401: signature mismatch)', async () => {
    const [encodedHeader, encodedPayload, encodedSignature] = accessToken.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('bad fixture');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const tampered = `${encodedHeader}.${base64UrlJson({ ...payload, role: 'ADMIN', sub: new Types.ObjectId().toHexString() })}.${encodedSignature}`;

    const response = await request(app).get('/api/v1/auth/me').set(bearer(tampered));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('never escalates privilege from a correctly signed ADMIN role claim (DB role authoritative)', async () => {
    // The attacker knows/crafts the secret (or steals a signing service): the claim must still not
    // grant admin, because requireRole uses the freshly loaded DB role, never the token claim.
    const forgedAdminClaim = signTestToken({ claims: { role: 'ADMIN' } });

    const stats = await request(app).get('/api/v1/admin/stats').set(bearer(forgedAdminClaim));
    const me = await request(app).get('/api/v1/auth/me').set(bearer(forgedAdminClaim));

    expect(stats.status).toBe(403);
    expect(stats.body.error.code).toBe('FORBIDDEN');
    expect(me.body.data.role).toBe('USER');
  });

  it('rejects tokens with a non-ObjectId subject or malformed Authorization headers', async () => {
    const badSubject = signTestToken({ claims: { role: 'USER' }, subject: 'not-an-object-id' });
    const requests = [
      request(app).get('/api/v1/auth/me').set(bearer(badSubject)),
      request(app).get('/api/v1/auth/me').set('Authorization', 'Basic dXNlcjpwYXNz'),
      request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer'),
      request(app).get('/api/v1/auth/me').set('Authorization', 'bearer lowercase-token'),
    ];

    for (const pending of requests) {
      const response = await pending;
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    }
  });
});

// ---------------------------------------------------------------------------
// SEC-6/SEC-7: device token + attestation replay
// ---------------------------------------------------------------------------
describe('SEC-6/SEC-7 device tokens and attestation replay', () => {
  it('stores only the SHA-256 of the device token, never the plaintext (SEC-6)', async () => {
    const paired = await createPairedTestDevice(app, accessToken);

    const raw = await Device.findById(paired.deviceId).lean();
    expect(JSON.stringify(raw)).not.toContain(paired.deviceToken);
    expect(raw?.deviceTokenHash).toBe(
      createHash('sha256').update(paired.deviceToken, 'utf8').digest('hex'),
    );

    const deviceCall = await request(app)
      .get('/api/v1/agent/allowlist')
      .set(bearer(paired.deviceToken));
    expect(deviceCall.status).toBe(200);
  });

  it('rejects a replayed attestation nonce with 409 CONFLICT (server-side single use, C-26)', async () => {
    const paired = await createPairedTestDevice(app, accessToken);
    await Device.updateOne({ _id: paired.deviceId }, { $set: { status: 'CONNECTED' } });

    const first = await request(app)
      .post(`/api/v1/devices/${paired.deviceId}/attest`)
      .set(bearer(accessToken))
      .send({ nonce: TEST_NONCE });
    const replay = await request(app)
      .post(`/api/v1/devices/${paired.deviceId}/attest`)
      .set(bearer(accessToken))
      .send({ nonce: TEST_NONCE });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('CONFLICT');
    expect(replay.body.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SEC-9: operator injection / mass assignment / malformed ids
// ---------------------------------------------------------------------------
describe('SEC-9 operator injection and mass assignment', () => {
  it('rejects NoSQL operator payloads on auth/users/sessions/allowlist/admin bodies', async () => {
    const admin = await adminToken();
    const attacks = [
      request(app)
        .post('/api/v1/auth/login')
        .send({ email: { $ne: null }, password: 'x' }),
      request(app)
        .patch('/api/v1/users/me')
        .set(bearer(accessToken))
        .send({ name: { $gt: '' } }),
      request(app)
        .post('/api/v1/sessions')
        .set(bearer(accessToken))
        .send({ deviceId: { $ne: null }, durationMin: 25 }),
      request(app)
        .put('/api/v1/allowlist')
        .set(bearer(accessToken))
        .send({ userApps: [{ key: 'x-app', label: 'X', $where: '1' }] }),
      request(app)
        .post('/api/v1/admin/presets')
        .set(bearer(admin))
        .send({ name: { $ne: null }, apps: [] }),
    ];

    for (const pending of attacks) {
      const response = await pending;
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(response.body)).toContain('not allowed');
    }
  });

  it('rejects operator keys smuggled through the query string', async () => {
    const response = await request(app).get('/api/v1/sessions?%24where=1').set(bearer(accessToken));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects prototype-pollution payloads and never pollutes Object.prototype', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"__proto__":{"polluted":true},"email":"kabir@demo.com","password":"Kabir@123"}');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects mass-assignment of privileged fields (role/ownerId/status/token)', async () => {
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Kabir New', email: 'mass@demo.com', password: 'Kabir@123', role: 'ADMIN' });
    const profile = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(accessToken))
      .send({ role: 'ADMIN' });
    const session = await request(app).post('/api/v1/sessions').set(bearer(accessToken)).send({
      deviceId: new Types.ObjectId().toHexString(),
      durationMin: 25,
      startedAt: new Date().toISOString(),
      clientSessionId: '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f',
      status: 'COMPLETED',
    });

    expect(registration.status).toBe(400);
    expect(profile.status).toBe(400);
    expect(session.status).toBe(400);
    expect(registration.body.error.details).toContainEqual(
      expect.objectContaining({ path: 'role' }),
    );
  });

  it('treats regex metacharacters in search as literal text (no ReDoS/500)', async () => {
    const response = await request(app)
      .get(`/api/v1/sessions?search=${encodeURIComponent('(a+)+$')}`)
      .set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(0);
  });

  it('maps malformed path ids to 404 NOT_FOUND (never a cast 500) on every router family', async () => {
    const admin = await adminToken();
    const requests = [
      request(app).patch('/api/v1/sessions/not-an-object-id').set(bearer(accessToken)).send({
        status: 'COMPLETED',
        endedAt: new Date().toISOString(),
        actualMinutes: 1,
        endReason: 'COMPLETED',
      }),
      request(app).delete('/api/v1/devices/not-an-object-id').set(bearer(accessToken)),
      request(app)
        .patch('/api/v1/schedules/not-an-object-id')
        .set(bearer(accessToken))
        .send({ enabled: false }),
      request(app).post('/api/v1/allowlist/preset/not-an-object-id').set(bearer(accessToken)),
      request(app).patch('/api/v1/notifications/not-an-object-id/read').set(bearer(accessToken)),
      request(app)
        .post('/api/v1/devices/not-an-object-id/attest')
        .set(bearer(accessToken))
        .send({ nonce: TEST_NONCE }),
      request(app)
        .patch('/api/v1/admin/users/not-an-object-id')
        .set(bearer(admin))
        .send({ isActive: false }),
      request(app).delete('/api/v1/admin/presets/not-an-object-id').set(bearer(admin)),
    ];

    for (const pending of requests) {
      const response = await pending;
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(JSON.stringify(response.body)).not.toContain('CastError');
    }
  });

  it('rejects bodies over the 100kb limit with 400 VALIDATION_ERROR', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.co', password: 'x'.repeat(110 * 1024) });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toContain('too large');
  });
});

// ---------------------------------------------------------------------------
// SEC-3/SEC-10: headers, CORS and no-stack envelopes
// ---------------------------------------------------------------------------
describe('SEC-3/SEC-10 headers, CORS and error envelopes', () => {
  it('sets helmet security headers and hides the framework', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });

  it('reflects an allow-listed Origin without credentials; blocks everything else', async () => {
    const allowed = await request(app)
      .get('/api/v1/health')
      .set('Origin', env.CLIENT_URLS[0] ?? '');
    const blocked = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    const wildcard = await request(app).get('/api/v1/health').set('Origin', '*');
    const preflight = await request(app)
      .options('/api/v1/sessions')
      .set('Origin', env.CLIENT_URLS[0] ?? '')
      .set('Access-Control-Request-Method', 'POST');

    expect(allowed.headers['access-control-allow-origin']).toBe(env.CLIENT_URLS[0]);
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    expect(wildcard.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-origin']).toBe(env.CLIENT_URLS[0]);
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('returns the frozen 401 envelope without stack traces for every auth failure', async () => {
    const response = await request(app).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expect(Object.keys(response.body).sort()).toEqual(['error', 'success']);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
    });
    await expectNoStack(response);
  });
});

// ---------------------------------------------------------------------------
// SEC-4: rate-limit mechanics and mounted limiters
// ---------------------------------------------------------------------------
describe('SEC-4 rate limiting', () => {
  it('mounts the general per-IP limiter on /api/v1 (RateLimit headers present)', async () => {
    // `/api/v1/health` is served by its own probe router before the API router (no limiter by
    // design for hosting probes); a real API route must advertise the general limiter headers.
    const response = await request(app).get('/api/v1/agent-links');

    const policy = response.headers['ratelimit-policy'] ?? response.headers['ratelimit'];
    expect(policy).toBeDefined();
  });

  it('mounted per-user limiters advertise themselves on the protected routers', async () => {
    const admin = await adminToken();
    const probes = [
      await request(app).get('/api/v1/sessions').set(bearer(accessToken)),
      await request(app).get('/api/v1/insights').set(bearer(accessToken)),
      await request(app).get('/api/v1/notifications').set(bearer(accessToken)),
      await request(app).get('/api/v1/users/me').set(bearer(accessToken)),
      await request(app).get('/api/v1/admin/stats').set(bearer(admin)),
      await request(app).get('/api/v1/agent-links'),
    ];

    for (const response of probes) {
      expect(response.status).toBe(200);
      const policy = response.headers['ratelimit-policy'] ?? response.headers['ratelimit'];
      expect(policy).toBeDefined();
    }
  });

  it('returns the 429 RATE_LIMITED envelope when a limiter trips (deterministic probe, no sleep)', async () => {
    const probe = express();
    probe.get(
      '/limited',
      createRateLimiter({
        windowMs: 60_000,
        limit: 2,
        identifier: 'security-probe',
        message: 'Too many requests. Please try again in a minute.',
        keyBy: 'ip',
      }),
      (_req, res) => {
        res.status(200).json({ success: true, data: {} });
      },
    );
    probe.use(errorHandler);

    expect((await request(probe).get('/limited')).status).toBe(200);
    expect((await request(probe).get('/limited')).status).toBe(200);
    const limited = await request(probe).get('/limited');

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again in a minute.',
      },
    });
  });

  it('keys per-user limiters by user id, not by IP (one user cannot exhaust another)', async () => {
    const probe = express();
    probe.use((req, _res, next) => {
      const id = req.headers['x-test-user'];
      req.user = {
        id: typeof id === 'string' ? id : 'anon',
        name: 'Probe User',
        email: 'probe@example.com',
        role: 'USER',
        timezone: 'UTC',
        defaultDurationMin: 60,
        isActive: true,
        createdAt: null,
        lastLoginAt: null,
      };
      next();
    });
    probe.get(
      '/per-user',
      createRateLimiter({
        windowMs: 60_000,
        limit: 1,
        identifier: 'security-per-user',
        message: 'Too many requests.',
        keyBy: 'user',
      }),
      (_req, res) => {
        res.status(200).json({ success: true, data: {} });
      },
    );
    probe.use(errorHandler);

    const userA = await request(probe).get('/per-user').set('x-test-user', 'user-a');
    const userAAgain = await request(probe).get('/per-user').set('x-test-user', 'user-a');
    const userB = await request(probe).get('/per-user').set('x-test-user', 'user-b');

    expect(userA.status).toBe(200);
    expect(userAAgain.status).toBe(429);
    expect(userB.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// SEC-1/SEC-9: admin lock-out protections
// ---------------------------------------------------------------------------
describe('admin protections (SEC-1/SEC-3, W6 item 5)', () => {
  it('blocks an admin from demoting or deactivating itself (409 CONFLICT)', async () => {
    const admin = await adminToken();
    const me = await request(app).get('/api/v1/auth/me').set(bearer(admin));
    const adminId = me.body.data.id as string;

    const demote = await request(app)
      .patch(`/api/v1/admin/users/${adminId}`)
      .set(bearer(admin))
      .send({ role: 'USER' });
    const deactivate = await request(app)
      .patch(`/api/v1/admin/users/${adminId}`)
      .set(bearer(admin))
      .send({ isActive: false });

    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe('CONFLICT');
    expect(deactivate.status).toBe(409);
    expect(deactivate.body.error.code).toBe('CONFLICT');
  });

  it('exposes aggregate-only stats (no per-user identifiers or session details)', async () => {
    const admin = await adminToken();

    const response = await request(app).get('/api/v1/admin/stats').set(bearer(admin));

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data)).toEqual(
      expect.arrayContaining([
        'activeSessions',
        'activeUsers',
        'connectedDevices',
        'devices',
        'focusMinutes',
        'sessions',
        'users',
      ]),
    );
    // No per-user/per-session detail may leak: only numeric aggregates are returned.
    for (const value of Object.values(response.body.data as Record<string, unknown>)) {
      expect(typeof value === 'number' || Array.isArray(value)).toBe(true);
    }
    expect(JSON.stringify(response.body)).not.toContain('@demo.com');
    expect(JSON.stringify(response.body)).not.toMatch(/[a-f0-9]{24}/);
  });

  it('rejects a USER token on every admin route with 403 FORBIDDEN', async () => {
    const adminEndpoints = [
      request(app).get('/api/v1/admin/stats'),
      request(app).get('/api/v1/admin/users'),
      request(app).post('/api/v1/admin/presets').send({ name: 'X', apps: [] }),
    ];

    for (const pending of adminEndpoints) {
      const response = await pending.set(bearer(accessToken));
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
  });
});
