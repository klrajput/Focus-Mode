// server/src/test/admin.test.ts — T-073 acceptance (FR-019; INTEGRATION_CONTRACTS §3.1 #26–#36).
// Why: the admin surface is the only privileged API — it must be unreachable without an ADMIN
// database role (401 unauthenticated, 403 USER), must never leak `passwordHash`, must refuse
// self-lockout, must keep protected apps out of presets (INV-3), must publish installer links from
// https GitHub hosts only, and stats must stay aggregate-only (PDF §6 "non-invasive admin").
// Invariants asserted: pagination/search/sort/validation; deactivated login → 403 ACCOUNT_DISABLED;
// promoted user gains access with an existing token (DB role is authoritative); preset/agent-link
// CRUD; `publishedBy` is the calling admin; stats has no user-identifying field.
//
// Mounting note: `routes/index.ts` is owned by A5 and does not mount `/admin` yet, so admin requests
// go through a dedicated app that reproduces the relevant production stack (helmet → JSON cap →
// operator sanitiser → router → 404 → central error handler) with the real `requireAuth`/
// `requireRole('ADMIN')` middlewares and real controllers. Auth/login requests use the real
// `buildApp()` app so the ACCOUNT_DISABLED check exercises the shipped auth route.

import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@focus-mode/shared';
import { JSON_BODY_LIMIT } from '../app.js';
import { AgentLink } from '../models/AgentLink.js';
import { Device } from '../models/Device.js';
import { Preset } from '../models/Preset.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { clearCollections, startTestDatabase, type TestDatabase } from '../models/test-db.js';
import { errorHandler } from '../middlewares/error.js';
import { notFound } from '../middlewares/not-found.js';
import { sanitizeRequest } from '../middlewares/sanitize.js';
import { adminRouter } from '../routes/admin.routes.js';
import { signAccessToken } from '../utils/jwt.js';
import {
  bearer,
  createDirectUser,
  createTestApp,
  createTestDevice,
  registerTestUser,
  TEST_USER,
} from './helpers.js';

/** A syntactically valid ObjectId that never exists in the test database. */
const MISSING_ID = '507f1f77bcf86cd799439011';
const USER_PASSWORD = TEST_USER.password;

const VSCODE = {
  key: 'vscode',
  label: 'Visual Studio Code',
  win: ['Code.exe'],
  mac: ['com.microsoft.VSCode'],
};
const SLACK = { key: 'slack', label: 'Slack', mac: ['com.tinyspeck.slackmacgap'] };
const FIGMA = { key: 'figma', label: 'Figma', mac: ['com.figma.Desktop'] };

const VALID_AGENT_URL =
  'https://github.com/focus-mode/agent/releases/download/v1.4.0/Focus-Agent-1.4.0-arm64.dmg';

type AdminMethod = 'get' | 'post' | 'patch' | 'delete';

interface TokenUser {
  id: string;
  token: string;
}

/** Admin API app: the production middleware order minus pino/CORS, mounting only `/admin`. */
function buildAdminTestApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(sanitizeRequest);
  app.use('/api/v1/admin', adminRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/** Supertest agent call by method name (keeps the endpoint table readable and typed). */
function adminCall(method: AdminMethod, path: string) {
  const agent = request(adminApp);
  switch (method) {
    case 'get':
      return agent.get(path);
    case 'post':
      return agent.post(path);
    case 'patch':
      return agent.patch(path);
    case 'delete':
      return agent.delete(path);
  }
}

/** Authenticated admin call. */
function asAdmin(method: AdminMethod, path: string, token: string) {
  return adminCall(method, path).set(bearer(token));
}

let adminApp: Express;

/** Seed a user directly and mint a real HS256 access token for it (no bcrypt cost per test). */
async function createTokenUser(role: Role): Promise<TokenUser> {
  const user = await createDirectUser({
    role,
    name: role === 'ADMIN' ? 'Ada Admin' : 'Kabir User',
  });
  const id = String(user._id);
  return { id, token: signAccessToken(id, role) };
}

function expectPaginated(data: unknown): asserts data is {
  items: unknown[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
} {
  expect(data).toMatchObject({
    page: expect.any(Number),
    limit: expect.any(Number),
    total: expect.any(Number),
    totalPages: expect.any(Number),
    items: expect.any(Array),
  });
}

let adminUser: TokenUser;
let normalUser: TokenUser;
let database: TestDatabase;

beforeAll(async () => {
  database = await startTestDatabase();
});

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await clearCollections();
  adminApp = buildAdminTestApp();
  adminUser = await createTokenUser('ADMIN');
  normalUser = await createTokenUser('USER');
});

// ---------------------------------------------------------------------------
// Access control — every admin endpoint is ADMIN-only (contract §1.2)
// ---------------------------------------------------------------------------

const PROTECTED_ENDPOINTS: { method: AdminMethod; path: string; body?: unknown }[] = [
  { method: 'get', path: '/api/v1/admin/users' },
  { method: 'patch', path: `/api/v1/admin/users/${MISSING_ID}`, body: { isActive: false } },
  { method: 'get', path: '/api/v1/admin/presets' },
  { method: 'post', path: '/api/v1/admin/presets', body: { name: 'Coding', apps: [VSCODE] } },
  { method: 'patch', path: `/api/v1/admin/presets/${MISSING_ID}`, body: { name: 'Renamed' } },
  { method: 'delete', path: `/api/v1/admin/presets/${MISSING_ID}` },
  { method: 'get', path: '/api/v1/admin/agent-links' },
  {
    method: 'post',
    path: '/api/v1/admin/agent-links',
    body: { os: 'macOS', arch: 'arm64', label: 'macOS', url: VALID_AGENT_URL, version: '1.4.0' },
  },
  { method: 'patch', path: `/api/v1/admin/agent-links/${MISSING_ID}`, body: { label: 'Renamed' } },
  { method: 'delete', path: `/api/v1/admin/agent-links/${MISSING_ID}` },
  { method: 'get', path: '/api/v1/admin/stats' },
];

describe('admin access control (contract §1.2: ADMIN only)', () => {
  for (const endpoint of PROTECTED_ENDPOINTS) {
    it(`${endpoint.method.toUpperCase()} ${endpoint.path} → 401 without a token`, async () => {
      const response = await adminCall(endpoint.method, endpoint.path).send(
        (endpoint.body ?? {}) as object,
      );

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it(`${endpoint.method.toUpperCase()} ${endpoint.path} → 403 for a USER token`, async () => {
      const response = await asAdmin(endpoint.method, endpoint.path, normalUser.token).send(
        (endpoint.body ?? {}) as object,
      );

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  }

  it('rejects a deactivated admin with 403 ACCOUNT_DISABLED on the next request', async () => {
    await User.updateOne({ _id: adminUser.id }, { $set: { isActive: false } });

    const response = await asAdmin('get', '/api/v1/admin/users', adminUser.token);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

// ---------------------------------------------------------------------------
// GET /admin/users (#26)
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/users (contract §3.1 #26)', () => {
  it('returns a paginated public-user list without passwordHash or other internals', async () => {
    const response = await asAdmin('get', '/api/v1/admin/users', adminUser.token);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expectPaginated(response.body.data);
    expect(response.body.data.total).toBe(2);
    expect(response.body.data.items).toHaveLength(2);
    const item = response.body.data.items[0] as Record<string, unknown>;
    expect(Object.keys(item).sort()).toEqual(
      [
        'id',
        'name',
        'email',
        'role',
        'timezone',
        'defaultDurationMin',
        'isActive',
        'createdAt',
        'lastLoginAt',
      ].sort(),
    );
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('paginates with the NFR-009 envelope', async () => {
    for (let index = 0; index < 5; index += 1) {
      await createDirectUser({
        name: `Page User ${index}`,
        email: `page-${index}@demo.com`,
      });
    }

    const first = await asAdmin('get', '/api/v1/admin/users?page=1&limit=3', adminUser.token);
    const second = await asAdmin('get', '/api/v1/admin/users?page=2&limit=3', adminUser.token);

    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ page: 1, limit: 3, total: 7, totalPages: 3 });
    expect(first.body.data.items).toHaveLength(3);
    expect(second.body.data).toMatchObject({ page: 2, limit: 3, total: 7, totalPages: 3 });
    expect(second.body.data.items).toHaveLength(3);
    const firstIds = (first.body.data.items as { id: string }[]).map((user) => user.id);
    const secondIds = (second.body.data.items as { id: string }[]).map((user) => user.id);
    expect(firstIds).not.toEqual(expect.arrayContaining(secondIds));
  });

  it('searches name/email case-insensitively and escapes regex metacharacters', async () => {
    await createDirectUser({ name: 'A.*B Literal', email: 'literal.regex@demo.com' });
    await createDirectUser({ name: 'AxB Decoy', email: 'axb.decoy@demo.com' });

    const literal = await asAdmin(
      'get',
      `/api/v1/admin/users?search=${encodeURIComponent('A.*B')}`,
      adminUser.token,
    );
    const byEmail = await asAdmin('get', '/api/v1/admin/users?search=AXB.DECOY', adminUser.token);

    expect(literal.status).toBe(200);
    expect(literal.body.data.total).toBe(1);
    expect(literal.body.data.items[0].email).toBe('literal.regex@demo.com');
    expect(byEmail.body.data.total).toBe(1);
    expect(byEmail.body.data.items[0].email).toBe('axb.decoy@demo.com');
  });

  it('filters by role and isActive', async () => {
    await createDirectUser({ name: 'Disabled User', isActive: false });

    const admins = await asAdmin('get', '/api/v1/admin/users?role=ADMIN', adminUser.token);
    const disabled = await asAdmin('get', '/api/v1/admin/users?isActive=false', adminUser.token);
    const active = await asAdmin('get', '/api/v1/admin/users?isActive=true', adminUser.token);

    expect(admins.body.data.total).toBe(1);
    expect(admins.body.data.items[0].role).toBe('ADMIN');
    expect(disabled.body.data.total).toBe(1);
    expect(disabled.body.data.items[0].name).toBe('Disabled User');
    expect(disabled.body.data.items[0].isActive).toBe(false);
    expect(active.body.data.total).toBe(2);
  });

  it('sorts by the whitelisted fields, ascending and descending', async () => {
    const ascending = await asAdmin('get', '/api/v1/admin/users?sort=email', adminUser.token);
    const descending = await asAdmin('get', '/api/v1/admin/users?sort=-email', adminUser.token);

    const ascendingEmails = (ascending.body.data.items as { email: string }[]).map(
      (user) => user.email,
    );
    expect(ascendingEmails).toEqual([...ascendingEmails].sort());
    const descendingEmails = (descending.body.data.items as { email: string }[]).map(
      (user) => user.email,
    );
    expect(descendingEmails).toEqual([...ascendingEmails].reverse());
  });

  it('rejects unknown filters, non-whitelisted sorts and out-of-range pagination', async () => {
    const unknownFilter = await asAdmin(
      'get',
      '/api/v1/admin/users?passwordHash=$ne',
      adminUser.token,
    );
    const unknownKey = await asAdmin('get', '/api/v1/admin/users?deviceId=abc', adminUser.token);
    const badSort = await asAdmin('get', '/api/v1/admin/users?sort=passwordHash', adminUser.token);
    const badLimit = await asAdmin('get', '/api/v1/admin/users?limit=101', adminUser.token);
    const badPage = await asAdmin('get', '/api/v1/admin/users?page=0', adminUser.token);
    const badRole = await asAdmin('get', '/api/v1/admin/users?role=SUPER', adminUser.token);
    const badIsActive = await asAdmin('get', '/api/v1/admin/users?isActive=1', adminUser.token);

    for (const response of [
      unknownFilter,
      unknownKey,
      badSort,
      badLimit,
      badPage,
      badRole,
      badIsActive,
    ]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id (#27)
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/admin/users/:id (contract §3.1 #27)', () => {
  it('deactivates a user and blocks their next login with 403 ACCOUNT_DISABLED', async () => {
    const authApp = createTestApp();
    const registration = await registerTestUser(authApp, {
      name: 'Kabir Login',
      email: 'kabir.login@demo.com',
    });
    const userId = registration.response.body.data.user.id as string;

    const deactivated = await asAdmin(
      'patch',
      `/api/v1/admin/users/${userId}`,
      adminUser.token,
    ).send({ isActive: false });

    expect(deactivated.status).toBe(200);
    expect(deactivated.body.success).toBe(true);
    expect(deactivated.body.data.isActive).toBe(false);
    expect(deactivated.body.data.id).toBe(userId);
    expect(JSON.stringify(deactivated.body)).not.toContain('passwordHash');

    const blockedLogin = await request(authApp)
      .post('/api/v1/auth/login')
      .send({ email: 'kabir.login@demo.com', password: USER_PASSWORD });
    expect(blockedLogin.status).toBe(403);
    expect(blockedLogin.body.error.code).toBe('ACCOUNT_DISABLED');

    const reactivated = await asAdmin(
      'patch',
      `/api/v1/admin/users/${userId}`,
      adminUser.token,
    ).send({ isActive: true });
    expect(reactivated.body.data.isActive).toBe(true);

    const allowedLogin = await request(authApp)
      .post('/api/v1/auth/login')
      .send({ email: 'kabir.login@demo.com', password: USER_PASSWORD });
    expect(allowedLogin.status).toBe(200);
    expect(allowedLogin.body.data.user.id).toBe(userId);
  });

  it('refuses self-deactivation with 409 CONFLICT and keeps the admin active', async () => {
    const response = await asAdmin(
      'patch',
      `/api/v1/admin/users/${adminUser.id}`,
      adminUser.token,
    ).send({ isActive: false });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(response.body.error.message).toContain('deactivate');

    const stillAdmin = await User.findById(adminUser.id).lean();
    expect(stillAdmin?.isActive).toBe(true);
    const followUp = await asAdmin('get', '/api/v1/admin/users', adminUser.token);
    expect(followUp.status).toBe(200);
  });

  it('refuses self-demotion with 409 CONFLICT and keeps the ADMIN role', async () => {
    const response = await asAdmin(
      'patch',
      `/api/v1/admin/users/${adminUser.id}`,
      adminUser.token,
    ).send({ role: 'USER' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect((await User.findById(adminUser.id).lean())?.role).toBe('ADMIN');
  });

  it('promotes a USER and the existing token can use the admin API immediately', async () => {
    const promoted = await asAdmin(
      'patch',
      `/api/v1/admin/users/${normalUser.id}`,
      adminUser.token,
    ).send({ role: 'ADMIN' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.role).toBe('ADMIN');

    // requireAuth reloads the user from Mongo, so the DB role wins over the token claim.
    const afterPromotion = await asAdmin('get', '/api/v1/admin/users', normalUser.token);
    expect(afterPromotion.status).toBe(200);
  });

  it('answers 404 for a missing or malformed user id', async () => {
    const missing = await asAdmin(
      'patch',
      `/api/v1/admin/users/${MISSING_ID}`,
      adminUser.token,
    ).send({ isActive: false });
    const malformed = await asAdmin(
      'patch',
      '/api/v1/admin/users/not-an-object-id',
      adminUser.token,
    ).send({ isActive: false });

    for (const response of [missing, malformed]) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('rejects an empty patch and any unknown field', async () => {
    const empty = await asAdmin(
      'patch',
      `/api/v1/admin/users/${normalUser.id}`,
      adminUser.token,
    ).send({});
    const unknown = await asAdmin(
      'patch',
      `/api/v1/admin/users/${normalUser.id}`,
      adminUser.token,
    ).send({ passwordHash: 'x' });

    for (const response of [empty, unknown]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// Presets CRUD (#28–#31)
// ---------------------------------------------------------------------------

describe('/api/v1/admin/presets CRUD (contract §3.1 #28–#31)', () => {
  it('creates a preset (201), lists it paginated and never exposes createdBy', async () => {
    const created = await asAdmin('post', '/api/v1/admin/presets', adminUser.token).send({
      name: 'Coding',
      apps: [VSCODE, SLACK],
    });

    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
    expect(Object.keys(created.body.data).sort()).toEqual(['apps', 'createdAt', 'id', 'name']);
    expect(created.body.data.name).toBe('Coding');
    expect(created.body.data.apps).toEqual([VSCODE, SLACK]);
    expect(JSON.stringify(created.body)).not.toContain('createdBy');

    const stored = await asAdmin('get', '/api/v1/admin/presets', adminUser.token);
    expect(stored.body.data.total).toBe(1);
    expect(stored.body.data.items[0].id).toBe(created.body.data.id);
  });

  it('answers 409 CONFLICT for a duplicate preset name', async () => {
    const payload = { name: 'Study', apps: [FIGMA] };
    const first = await asAdmin('post', '/api/v1/admin/presets', adminUser.token).send(payload);
    const duplicate = await asAdmin('post', '/api/v1/admin/presets', adminUser.token).send(payload);

    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
  });

  it('rejects protected apps (by key and by identifier) with 400 PROTECTED_ENTRY', async () => {
    const byKey = await asAdmin('post', '/api/v1/admin/presets', adminUser.token).send({
      name: 'Bad Key',
      apps: [{ key: 'chrome', label: 'Google Chrome', mac: ['com.google.Chrome'] }],
    });
    const byIdentifier = await asAdmin('post', '/api/v1/admin/presets', adminUser.token).send({
      name: 'Bad Identifier',
      apps: [{ key: 'my-browser', label: 'My Browser', mac: ['com.apple.Safari'] }],
    });

    for (const response of [byKey, byIdentifier]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('PROTECTED_ENTRY');
    }
    expect(await Preset.countDocuments()).toBe(0);
  });

  it('validates the create payload (no apps, unknown field, duplicate keys)', async () => {
    const noApps = await asAdmin('post', '/api/v1/admin/presets', adminUser.token).send({
      name: 'Empty',
      apps: [],
    });
    const unknown = await asAdmin('post', '/api/v1/admin/presets', adminUser.token).send({
      name: 'Unknown',
      apps: [VSCODE],
      isProtected: true,
    });
    const duplicateKeys = await asAdmin('post', '/api/v1/admin/presets', adminUser.token).send({
      name: 'Duplicated',
      apps: [VSCODE, { ...VSCODE, label: 'VS Code again' }],
    });

    for (const response of [noApps, unknown, duplicateKeys]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('updates name/apps, refuses a duplicate name and protected apps', async () => {
    const created = await asAdmin('post', '/api/v1/admin/presets', adminUser.token).send({
      name: 'Focus',
      apps: [VSCODE],
    });
    const presetId = created.body.data.id as string;
    await asAdmin('post', '/api/v1/admin/presets', adminUser.token).send({
      name: 'Taken',
      apps: [FIGMA],
    });

    const renamed = await asAdmin(
      'patch',
      `/api/v1/admin/presets/${presetId}`,
      adminUser.token,
    ).send({ name: 'Deep Focus', apps: [SLACK] });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Deep Focus');
    expect(renamed.body.data.apps).toEqual([SLACK]);

    const duplicateName = await asAdmin(
      'patch',
      `/api/v1/admin/presets/${presetId}`,
      adminUser.token,
    ).send({ name: 'Taken' });
    expect(duplicateName.status).toBe(409);
    expect(duplicateName.body.error.code).toBe('CONFLICT');

    const protectedApps = await asAdmin(
      'patch',
      `/api/v1/admin/presets/${presetId}`,
      adminUser.token,
    ).send({ apps: [{ key: 'firefox', label: 'Mozilla Firefox', mac: ['org.mozilla.firefox'] }] });
    expect(protectedApps.status).toBe(400);
    expect(protectedApps.body.error.code).toBe('PROTECTED_ENTRY');

    const missing = await asAdmin(
      'patch',
      `/api/v1/admin/presets/${MISSING_ID}`,
      adminUser.token,
    ).send({ name: 'Ghost' });
    expect(missing.status).toBe(404);
  });

  it('deletes a preset and answers 404 afterwards', async () => {
    const created = await asAdmin('post', '/api/v1/admin/presets', adminUser.token).send({
      name: 'Temporary',
      apps: [VSCODE],
    });
    const presetId = created.body.data.id as string;

    const deleted = await asAdmin('delete', `/api/v1/admin/presets/${presetId}`, adminUser.token);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ success: true, data: { id: presetId } });

    const again = await asAdmin('delete', `/api/v1/admin/presets/${presetId}`, adminUser.token);
    expect(again.status).toBe(404);
    const malformed = await asAdmin('delete', '/api/v1/admin/presets/nope', adminUser.token);
    expect(malformed.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Agent-link CRUD (#32–#35)
// ---------------------------------------------------------------------------

describe('/api/v1/admin/agent-links CRUD (contract §3.1 #32–#35)', () => {
  it('publishes an https GitHub installer link and records the calling admin', async () => {
    const created = await asAdmin('post', '/api/v1/admin/agent-links', adminUser.token).send({
      os: 'macOS',
      arch: 'arm64',
      label: 'macOS (Apple silicon)',
      url: VALID_AGENT_URL,
      version: '1.4.0',
    });

    expect(created.status).toBe(201);
    expect(Object.keys(created.body.data).sort()).toEqual([
      'arch',
      'id',
      'label',
      'os',
      'publishedAt',
      'url',
      'version',
    ]);
    expect(created.body.data.url).toBe(VALID_AGENT_URL);
    expect(typeof created.body.data.publishedAt).toBe('string');
    expect(JSON.stringify(created.body)).not.toContain('publishedBy');

    const stored = await AgentLink.findById(created.body.data.id).lean();
    expect(String(stored?.publishedBy)).toBe(adminUser.id);
  });

  it('accepts the objects.githubusercontent.com asset CDN', async () => {
    const response = await asAdmin('post', '/api/v1/admin/agent-links', adminUser.token).send({
      os: 'windows',
      arch: 'x64',
      label: 'Windows installer',
      url: 'https://objects.githubusercontent.com/assets/Focus-Agent-Setup.exe',
      version: '1.4.1',
    });

    expect(response.status).toBe(201);
  });

  it('rejects javascript:, data:, http, foreign hosts and spoofed hosts with VALIDATION_ERROR', async () => {
    const invalidUrls = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://github.com/focus-mode/agent/releases/download/v1.4.0/agent.dmg',
      'https://example.com/Focus-Agent.dmg',
      'https://github.com.evil.com/Focus-Agent.dmg',
      'https://user:pass@github.com/Focus-Agent.dmg',
    ];

    for (const url of invalidUrls) {
      const response = await asAdmin('post', '/api/v1/admin/agent-links', adminUser.token).send({
        os: 'macOS',
        arch: 'arm64',
        label: 'Suspicious link',
        url,
        version: '1.4.0',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toContainEqual(expect.objectContaining({ path: 'url' }));
    }
    expect(await AgentLink.countDocuments()).toBe(0);
  });

  it('validates the link payload (missing host fields, bad version)', async () => {
    const missingOs = await asAdmin('post', '/api/v1/admin/agent-links', adminUser.token).send({
      arch: 'arm64',
      label: 'macOS',
      url: VALID_AGENT_URL,
      version: '1.4.0',
    });
    const badVersion = await asAdmin('post', '/api/v1/admin/agent-links', adminUser.token).send({
      os: 'macOS',
      arch: 'arm64',
      label: 'macOS',
      url: VALID_AGENT_URL,
      version: 'latest',
    });

    for (const response of [missingOs, badVersion]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('lists links paginated with the fixed publishedAt order', async () => {
    for (const [index, label] of ['First', 'Second', 'Third'].entries()) {
      await asAdmin('post', '/api/v1/admin/agent-links', adminUser.token).send({
        os: 'macOS',
        arch: 'universal',
        label: `${label} build`,
        url: `${VALID_AGENT_URL}?build=${index}`,
        version: `1.4.${index}`,
      });
    }

    const page = await asAdmin('get', '/api/v1/admin/agent-links?page=1&limit=2', adminUser.token);

    expect(page.status).toBe(200);
    expect(page.body.data).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(page.body.data.items).toHaveLength(2);

    const tooLarge = await asAdmin('get', '/api/v1/admin/agent-links?limit=101', adminUser.token);
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('updates allowed fields but re-validates a new url', async () => {
    const created = await asAdmin('post', '/api/v1/admin/agent-links', adminUser.token).send({
      os: 'linux',
      arch: 'x64',
      label: 'Linux tarball',
      url: VALID_AGENT_URL,
      version: '1.4.0',
    });
    const linkId = created.body.data.id as string;

    const relabeled = await asAdmin(
      'patch',
      `/api/v1/admin/agent-links/${linkId}`,
      adminUser.token,
    ).send({ label: 'Linux AppImage', version: '1.5.0' });
    expect(relabeled.status).toBe(200);
    expect(relabeled.body.data.label).toBe('Linux AppImage');
    expect(relabeled.body.data.version).toBe('1.5.0');

    const badUrl = await asAdmin(
      'patch',
      `/api/v1/admin/agent-links/${linkId}`,
      adminUser.token,
    ).send({ url: 'https://evil.example.com/agent.dmg' });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.error.code).toBe('VALIDATION_ERROR');

    const missing = await asAdmin(
      'patch',
      `/api/v1/admin/agent-links/${MISSING_ID}`,
      adminUser.token,
    ).send({ label: 'Ghost link' });
    expect(missing.status).toBe(404);
  });

  it('deletes a link and answers 404 afterwards', async () => {
    const created = await asAdmin('post', '/api/v1/admin/agent-links', adminUser.token).send({
      os: 'macOS',
      arch: 'x64',
      label: 'Intel Mac build',
      url: VALID_AGENT_URL,
      version: '1.4.0',
    });
    const linkId = created.body.data.id as string;

    const deleted = await asAdmin('delete', `/api/v1/admin/agent-links/${linkId}`, adminUser.token);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toEqual({ id: linkId });

    const again = await asAdmin('delete', `/api/v1/admin/agent-links/${linkId}`, adminUser.token);
    expect(again.status).toBe(404);
    const malformed = await asAdmin('delete', '/api/v1/admin/agent-links/nope', adminUser.token);
    expect(malformed.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/stats (#36) — aggregates only (PDF §6 non-invasive admin)
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/stats (contract §3.1 #36, PDF §6)', () => {
  async function seedStatsFixtures(): Promise<void> {
    const disabled = await createDirectUser({
      name: 'Dormant Account',
      email: 'dormant@demo.com',
      isActive: false,
    });
    const owner = new Types.ObjectId(normalUser.id);

    const connected = await createTestDevice({ ownerId: owner, status: 'CONNECTED' });
    const focusing = await createTestDevice({ ownerId: owner, status: 'FOCUSING' });
    const offline = await createTestDevice({ ownerId: owner, status: 'DISCONNECTED' });

    await Session.create([
      {
        userId: owner,
        deviceId: new Types.ObjectId(connected.deviceId),
        startedAt: new Date('2026-11-10T10:00:00.000Z'),
        endedAt: new Date('2026-11-10T10:30:30.000Z'),
        plannedMinutes: 30,
        actualMinutes: 30.5,
        status: 'COMPLETED',
        source: 'MANUAL',
        clientSessionId: randomUUID(),
        endReason: 'COMPLETED',
      },
      {
        userId: owner,
        deviceId: new Types.ObjectId(focusing.deviceId),
        startedAt: new Date('2026-11-10T11:00:00.000Z'),
        endedAt: new Date('2026-11-10T11:20:00.000Z'),
        plannedMinutes: 25,
        actualMinutes: 20,
        status: 'CANCELLED',
        source: 'MANUAL',
        clientSessionId: randomUUID(),
        endReason: 'USER',
      },
      {
        userId: owner,
        deviceId: new Types.ObjectId(offline.deviceId),
        startedAt: new Date('2026-11-10T12:00:00.000Z'),
        plannedMinutes: 25,
        actualMinutes: 0,
        status: 'ACTIVE',
        source: 'MANUAL',
        clientSessionId: randomUUID(),
        endReason: null,
      },
    ]);

    // The disabled user exists only to prove counts stay aggregate (never listed).
    expect(String(disabled._id)).toHaveLength(24);
  }

  it('returns aggregate counters and focus minutes with no per-user detail', async () => {
    await seedStatsFixtures();

    const response = await asAdmin('get', '/api/v1/admin/stats', adminUser.token);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const stats = response.body.data as Record<string, number>;
    expect(stats).toMatchObject({
      users: 3,
      activeUsers: 2,
      devices: 3,
      connectedDevices: 2,
      sessions: 3,
      activeSessions: 1,
      focusMinutes: 50.5,
    });
    // Task-33 aliases are the same aggregates, never extra data.
    expect(stats).toMatchObject({
      totalUsers: 3,
      totalSessions: 3,
      totalFocusMinutes: 50.5,
      devicesConnected: 2,
    });
    expect(Object.keys(stats).sort()).toEqual(
      [
        'users',
        'activeUsers',
        'devices',
        'connectedDevices',
        'sessions',
        'activeSessions',
        'focusMinutes',
        'totalUsers',
        'totalSessions',
        'totalFocusMinutes',
        'devicesConnected',
      ].sort(),
    );

    // PDF §6: the payload can never identify a user, a device or a session row.
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('dormant@demo.com');
    expect(serialized).not.toContain('Dormant Account');
    expect(serialized).not.toContain(normalUser.id);
    expect(response.body.data).not.toHaveProperty('items');
    expect(response.body.data).not.toHaveProperty('userId');
    expect(response.body.data).not.toHaveProperty('email');
  });

  it('returns zero session/device aggregates when the platform has no activity', async () => {
    // The authenticated admin must stay in the database for requireAuth, so only the other users
    // and all activity are removed — every activity counter must still be exactly zero.
    await User.deleteMany({ _id: { $ne: adminUser.id } });
    await Device.deleteMany({});
    await Session.deleteMany({});

    const response = await asAdmin('get', '/api/v1/admin/stats', adminUser.token);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      users: 1,
      activeUsers: 1,
      devices: 0,
      connectedDevices: 0,
      sessions: 0,
      activeSessions: 0,
      focusMinutes: 0,
      totalUsers: 1,
      totalSessions: 0,
      totalFocusMinutes: 0,
      devicesConnected: 0,
    });
  });
});
