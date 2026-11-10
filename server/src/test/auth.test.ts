// server/src/test/auth.test.ts — T-012 acceptance (FR-001): register/login/logout/me over the real
// app + a real in-memory MongoDB, including SEC-1 bcrypt cost, SEC-2 JWT issuance, the 403
// ACCOUNT_DISABLED path, requireRole('ADMIN') (403 for USER) and the SEC-4 auth rate limit (429 on
// the 11th attempt in the window).
// Why: these are the security-critical behaviours of the API; proving them against real mongoose
// documents (not mocks) is what makes "no faked backend/auth" true.
// Invariants asserted: no response ever contains passwordHash; registration always creates USER;
// unknown email and wrong password are indistinguishable (401 UNAUTHENTICATED); a disabled account
// cannot log in (403 ACCOUNT_DISABLED); admin-only routes reject USER tokens with 403.

import bcrypt from 'bcryptjs';
import express, { type Express, type Request, type Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@focus-mode/shared';
import { buildApp } from '../app.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { errorHandler } from '../middlewares/error.js';
import { User } from '../models/User.js';
import {
  bearer,
  clearTestDatabase,
  createTestApp,
  registerTestUser,
  startTestDatabase,
  stopTestDatabase,
  TEST_USER,
} from './helpers.js';

const PUBLIC_USER_FIELDS = [
  'createdAt',
  'defaultDurationMin',
  'email',
  'id',
  'isActive',
  'lastLoginAt',
  'name',
  'role',
  'timezone',
];

let app: Express;

/** Minimal probe mounting the real auth/role middleware: proves requireRole without inventing an
 *  admin endpoint that belongs to a later task (T-073). */
function buildAdminProbe(): Express {
  const probe = express();
  probe.get('/probe/admin', requireAuth, requireRole('ADMIN'), (req: Request, res: Response) => {
    res.status(200).json({ success: true, data: { role: req.user?.role ?? null } });
  });
  probe.use(errorHandler);
  return probe;
}

async function createUser(overrides: {
  name?: string;
  email: string;
  password?: string;
  role?: Role;
  isActive?: boolean;
}): Promise<void> {
  const password = overrides.password ?? 'Kabir@123';
  await User.create({
    name: overrides.name ?? 'Direct User',
    email: overrides.email,
    passwordHash: await bcrypt.hash(password, 12),
    role: overrides.role ?? 'USER',
    isActive: overrides.isActive ?? true,
  });
}

function expectNoPasswordHash(body: unknown): void {
  expect(JSON.stringify(body)).not.toContain('passwordHash');
}

beforeAll(async () => {
  await startTestDatabase();
  await User.init(); // make the unique email index deterministic for duplicate/key tests
  app = createTestApp();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
});

describe('POST /api/v1/auth/register (contract §3.1 #2)', () => {
  it('creates a USER account (201) with a token and no passwordHash', async () => {
    const { response, payload } = await registerTestUser(app);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        accessToken: expect.any(String),
        user: {
          name: payload.name,
          email: payload.email,
          role: 'USER',
          isActive: true,
          lastLoginAt: null,
        },
      },
    });
    expect(response.body.data.accessToken.split('.')).toHaveLength(3);
    expect(Object.keys(response.body.data.user).sort()).toEqual(PUBLIC_USER_FIELDS);
    expect(response.body.data.user.id).toMatch(/^[a-f0-9]{24}$/);
    expectNoPasswordHash(response.body);
  });

  it('stores the password as bcrypt cost 12 (SEC-1), never in plain text', async () => {
    await registerTestUser(app);

    const raw = await User.collection.findOne<{ passwordHash?: string }>({
      email: TEST_USER.email,
    });
    const passwordHash = raw?.passwordHash;
    expect(typeof passwordHash).toBe('string');
    if (typeof passwordHash !== 'string') throw new Error('expected a stored passwordHash');

    expect(bcrypt.getRounds(passwordHash)).toBe(12);
    expect(passwordHash).not.toBe(TEST_USER.password);
    expect(await bcrypt.compare(TEST_USER.password, passwordHash)).toBe(true);
  });

  it('rejects a duplicate email with 409 CONFLICT', async () => {
    await registerTestUser(app);
    const second = await request(app).post('/api/v1/auth/register').send(TEST_USER);

    expect(second.status).toBe(409);
    expect(second.body).toEqual({
      success: false,
      error: { code: 'CONFLICT', message: 'An account with this email already exists.' },
    });
  });

  it('always creates role USER (FR-001) — the seed creates the ADMIN', async () => {
    const { response } = await registerTestUser(app, { email: 'new.user@demo.com' });

    expect(response.body.data.user.role).toBe('USER');
    const stored = await User.findOne({ email: 'new.user@demo.com' });
    expect(stored?.role).toBe('USER');
  });
});

describe('POST /api/v1/auth/login (contract §3.1 #3)', () => {
  it('returns 200 with a token and records lastLoginAt', async () => {
    await registerTestUser(app);

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { accessToken: expect.any(String), user: { email: TEST_USER.email } },
    });
    expect(typeof response.body.data.user.lastLoginAt).toBe('string');
    expectNoPasswordHash(response.body);

    const stored = await User.collection.findOne({ email: TEST_USER.email });
    expect(stored?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('rejects a wrong password with 401 UNAUTHENTICATED and no details', async () => {
    await registerTestUser(app);

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER.email, password: 'Wrong@123' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password.' },
    });
  });

  it('rejects an unknown email with the same 401 (no user enumeration)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@demo.com', password: 'Kabir@123' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(response.body.error.message).toBe('Invalid email or password.');
  });

  it('rejects a deactivated account with 403 ACCOUNT_DISABLED', async () => {
    await createUser({ email: 'disabled@demo.com', password: 'Kabir@123', isActive: false });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'disabled@demo.com', password: 'Kabir@123' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'ACCOUNT_DISABLED', message: 'This account has been disabled.' },
    });
  });
});

describe('GET /api/v1/auth/me and POST /api/v1/auth/logout (contract §3.1 #4–#5)', () => {
  it('rejects a missing token with 401 UNAUTHENTICATED', async () => {
    const response = await request(app).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
    });
  });

  it('rejects a tampered token with 401 UNAUTHENTICATED', async () => {
    const { response } = await registerTestUser(app);
    const token: string = response.body.data.accessToken;

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set(bearer(`${token}tampered`));

    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the active user for a valid token, reloaded from the database', async () => {
    const { response } = await registerTestUser(app);
    const token: string = response.body.data.accessToken;
    await User.updateOne({ email: TEST_USER.email }, { $set: { name: 'Kabir Renamed' } });

    const me = await request(app).get('/api/v1/auth/me').set(bearer(token));

    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      success: true,
      data: { email: TEST_USER.email, role: 'USER', name: 'Kabir Renamed' },
    });
    expectNoPasswordHash(me.body);
  });

  it('requires authentication for logout and returns {"loggedOut":true} when authenticated', async () => {
    const unauthenticated = await request(app).post('/api/v1/auth/logout');
    expect(unauthenticated.status).toBe(401);

    const { response } = await registerTestUser(app);
    const authenticated = await request(app)
      .post('/api/v1/auth/logout')
      .set(bearer(response.body.data.accessToken));

    expect(authenticated.status).toBe(200);
    expect(authenticated.body).toEqual({ success: true, data: { loggedOut: true } });
  });
});

describe('role authorisation (FR-001: USER token on an ADMIN-only route)', () => {
  it('answers 403 FORBIDDEN for a USER token and 200 for an ADMIN token', async () => {
    const { response: userRegistration } = await registerTestUser(app);
    const userToken: string = userRegistration.body.data.accessToken;

    await createUser({ email: 'admin@demo.com', password: 'Admin@123', role: 'ADMIN' });
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@demo.com', password: 'Admin@123' });
    const adminToken: string = adminLogin.body.data.accessToken;

    const probe = buildAdminProbe();
    const asUser = await request(probe).get('/probe/admin').set(bearer(userToken));
    const asAdmin = await request(probe).get('/probe/admin').set(bearer(adminToken));

    expect(asUser.status).toBe(403);
    expect(asUser.body).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' },
    });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body).toEqual({ success: true, data: { role: 'ADMIN' } });
  });
});

describe('SEC-4 auth rate limit', () => {
  it('answers 429 RATE_LIMITED on the 11th login attempt in the 15-minute window', async () => {
    const limitedApp = buildApp({ authRateLimitMax: 10 });
    const attempt = () =>
      request(limitedApp).post('/api/v1/auth/login').send({
        email: 'nobody@demo.com',
        password: 'Kabir@123',
      });

    for (let index = 0; index < 10; index += 1) {
      const response = await attempt();
      expect(response.status).toBe(401);
    }

    const eleventh = await attempt();

    expect(eleventh.status).toBe(429);
    expect(eleventh.body).toEqual({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authentication attempts. Please try again in 15 minutes.',
      },
    });
  });
});

describe('health readiness with a live database (TECHNICAL_DESIGN §11)', () => {
  it('GET /health/db returns 200 {"db":"ok"} once mongoose is connected', async () => {
    const response = await request(app).get('/health/db');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { status: 'ok', db: 'ok' } });
  });
});
