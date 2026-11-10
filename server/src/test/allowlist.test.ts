// server/src/test/allowlist.test.ts — T-061 acceptance (FR-008/FR-020, INV-3).
// Why: the protected set is the product's safety invariant — a user must never be able to remove,
// edit or impersonate a protected app (browser/Focus Agent/OS essentials), while still freely
// managing their own allow-listed apps. Applying an admin preset must keep those guarantees.
// Invariants asserted: lazy creation with the canonical protected set; PUT rejects every protected
// change with 400 PROTECTED_ENTRY (removal, edit, extra entry, protected key, identifier shadowing);
// ≤50 apps + unique keys per the frozen schema; version bumps only on a real change; presets are
// paginated read-only data; preset merge/replace never touches protectedApps.

import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Preset } from '../models/Preset.js';
import { User } from '../models/User.js';
import { hasCompleteProtectedSet } from '../models/protected-apps.js';
import {
  bearer,
  clearTestDatabase,
  createTestApp,
  registerTestUser,
  startTestDatabase,
  stopTestDatabase,
} from './helpers.js';

const VSCODE = {
  key: 'vscode',
  label: 'Visual Studio Code',
  win: ['Code.exe'],
  mac: ['com.microsoft.VSCode'],
};
const SLACK = {
  key: 'slack',
  label: 'Slack',
  mac: ['com.tinyspeck.slackmacgap'],
};

let app: Express;
let accessToken: string;
let userId: string;

async function getAllowlist() {
  return request(app).get('/api/v1/allowlist').set(bearer(accessToken));
}

async function putAllowlist(body: Record<string, unknown>) {
  return request(app).put('/api/v1/allowlist').set(bearer(accessToken)).send(body);
}

/** Test fixture: presets are admin-authored in T-073; the model only needs a valid `createdBy`. */
async function createPreset(name: string, apps: Record<string, unknown>[]): Promise<string> {
  const preset = await Preset.create({ name, apps, createdBy: new Types.ObjectId(userId) });
  return String(preset._id);
}

async function otherUserToken(): Promise<string> {
  const registration = await registerTestUser(app, { email: 'other.allowlist@demo.com' });
  return registration.response.body.data.accessToken as string;
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

describe('GET /api/v1/allowlist (contract §3.1 #15)', () => {
  it('creates the allow-list lazily with the complete canonical protected set', async () => {
    const response = await getAllowlist();

    expect(response.status).toBe(200);
    const allowlist = response.body.data as {
      protectedApps: { key: string; label: string }[];
      userApps: unknown[];
      version: number;
    };
    expect(allowlist.version).toBe(1);
    expect(allowlist.userApps).toEqual([]);
    expect(hasCompleteProtectedSet(allowlist.protectedApps)).toBe(true);
    // Locked browsers are present and identifiable by key (INV-3).
    expect(allowlist.protectedApps.map((app) => app.key)).toEqual(
      expect.arrayContaining(['chrome', 'firefox', 'focus-agent']),
    );
  });
});

describe('PUT /api/v1/allowlist (contract §3.1 #16, INV-3)', () => {
  it('replaces userApps and bumps the version without touching protectedApps', async () => {
    const before = await getAllowlist();
    const protectedBefore = before.body.data.protectedApps;

    const response = await putAllowlist({ userApps: [VSCODE, SLACK] });

    expect(response.status).toBe(200);
    expect(response.body.data.userApps.map((app: { key: string }) => app.key)).toEqual([
      'vscode',
      'slack',
    ]);
    expect(response.body.data.version).toBe(2);
    expect(response.body.data.protectedApps).toEqual(protectedBefore);

    const refetched = await getAllowlist();
    expect(refetched.body.data.userApps).toHaveLength(2);
    expect(refetched.body.data.version).toBe(2);
  });

  it('ignores an identical protectedApps echo and keeps the version unchanged', async () => {
    await putAllowlist({ userApps: [VSCODE] });
    const current = await getAllowlist();

    const echo = await putAllowlist({
      userApps: [VSCODE],
      protectedApps: current.body.data.protectedApps,
    });

    expect(echo.status).toBe(200);
    expect(echo.body.data.version).toBe(2);
  });

  it('answers 400 PROTECTED_ENTRY when a protected entry is removed', async () => {
    const current = await getAllowlist();
    const [removed, ...kept] = current.body.data.protectedApps as { key: string }[];

    const response = await putAllowlist({ userApps: [], protectedApps: kept });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PROTECTED_ENTRY');
    expect(response.body.error.message).toContain(removed?.key);
  });

  it('answers 400 PROTECTED_ENTRY when a protected entry is edited', async () => {
    const current = await getAllowlist();
    const edited = (current.body.data.protectedApps as Record<string, unknown>[]).map((entry) =>
      entry.key === 'chrome' ? { ...entry, label: 'Not Chrome' } : entry,
    );

    const response = await putAllowlist({ userApps: [], protectedApps: edited });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PROTECTED_ENTRY');
    expect(response.body.error.message).toContain('chrome');
  });

  it('answers 400 PROTECTED_ENTRY when an extra protected entry is added', async () => {
    const current = await getAllowlist();
    const extra = [...(current.body.data.protectedApps as unknown[]), SLACK];

    const response = await putAllowlist({ userApps: [], protectedApps: extra });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PROTECTED_ENTRY');
  });

  it('answers 400 PROTECTED_ENTRY when a user app reuses a protected key', async () => {
    const response = await putAllowlist({
      userApps: [{ key: 'chrome', label: 'My Chrome', mac: ['com.google.Chrome'] }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PROTECTED_ENTRY');
  });

  it('answers 400 PROTECTED_ENTRY when a user app shadows a protected bundle id', async () => {
    const response = await putAllowlist({
      userApps: [{ key: 'my-browser', label: 'My Browser', mac: ['com.google.Chrome'] }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PROTECTED_ENTRY');
  });

  it('enforces the shared limits: ≤50 apps and unique keys', async () => {
    const tooMany = Array.from({ length: 51 }, (_, index) => ({
      key: `app-${index}`,
      label: `App ${index}`,
      mac: [`com.example.app${index}`],
    }));
    const duplicates = [VSCODE, { ...SLACK, key: VSCODE.key }];

    const tooManyResponse = await putAllowlist({ userApps: tooMany });
    const duplicateResponse = await putAllowlist({ userApps: duplicates });

    expect(tooManyResponse.status).toBe(400);
    expect(tooManyResponse.body.error.code).toBe('VALIDATION_ERROR');
    expect(duplicateResponse.status).toBe(400);
    expect(duplicateResponse.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown field (strict schema) with 400 VALIDATION_ERROR', async () => {
    const response = await putAllowlist({ userApps: [], protectedApps: [], hacker: true });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/presets (contract §3.1 #24)', () => {
  it('lists presets as read-only paginated data without exposing createdBy', async () => {
    await createPreset('Coding', [VSCODE]);
    await createPreset('Study', [SLACK]);

    const response = await request(app).get('/api/v1/presets').set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
    const preset = response.body.data.items[0] as Record<string, unknown>;
    expect(Object.keys(preset).sort()).toEqual(['apps', 'createdAt', 'id', 'name']);
    expect(JSON.stringify(response.body)).not.toContain('createdBy');

    const paged = await request(app).get('/api/v1/presets?page=1&limit=1').set(bearer(accessToken));
    expect(paged.body.data.items).toHaveLength(1);
    expect(paged.body.data.totalPages).toBe(2);
  });
});

describe('POST /api/v1/allowlist/preset/:id (W3 preset application)', () => {
  it('merges preset apps into userApps, keeping existing entries and protectedApps intact', async () => {
    await putAllowlist({ userApps: [VSCODE] });
    const protectedBefore = (await getAllowlist()).body.data.protectedApps;
    const presetId = await createPreset('Coding', [VSCODE, SLACK]);

    const response = await request(app)
      .post(`/api/v1/allowlist/preset/${presetId}`)
      .set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data.userApps.map((app: { key: string }) => app.key)).toEqual([
      'vscode',
      'slack',
    ]);
    expect(response.body.data.version).toBe(3);
    expect(response.body.data.protectedApps).toEqual(protectedBefore);
  });

  it('can replace userApps with the preset apps (?mode=replace)', async () => {
    await putAllowlist({ userApps: [VSCODE] });
    const presetId = await createPreset('Study', [SLACK]);

    const response = await request(app)
      .post(`/api/v1/allowlist/preset/${presetId}?mode=replace`)
      .set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data.userApps.map((app: { key: string }) => app.key)).toEqual(['slack']);
  });

  it('never adds a protected app from a preset (INV-3)', async () => {
    const protectedBefore = (await getAllowlist()).body.data.protectedApps;
    const presetId = await createPreset('Everything', [
      { key: 'chrome', label: 'Google Chrome', mac: ['com.google.Chrome'] },
      SLACK,
    ]);

    const response = await request(app)
      .post(`/api/v1/allowlist/preset/${presetId}`)
      .set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data.userApps.map((app: { key: string }) => app.key)).toEqual(['slack']);
    expect(response.body.data.protectedApps).toEqual(protectedBefore);
  });

  it('answers 404 for an unknown preset and 400 for an unknown mode', async () => {
    const missing = await request(app)
      .post('/api/v1/allowlist/preset/507f1f77bcf86cd799439011')
      .set(bearer(accessToken));
    const presetId = await createPreset('Study', [SLACK]);
    const badMode = await request(app)
      .post(`/api/v1/allowlist/preset/${presetId}?mode=append`)
      .set(bearer(accessToken));

    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    expect(badMode.status).toBe(400);
    expect(badMode.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('allow-list isolation and authorisation', () => {
  it('keeps each user’s allow-list independent', async () => {
    await putAllowlist({ userApps: [VSCODE] });
    const otherToken = await otherUserToken();

    const other = await request(app).get('/api/v1/allowlist').set(bearer(otherToken));

    expect(other.status).toBe(200);
    expect(other.body.data.userApps).toEqual([]);
    expect(other.body.data.version).toBe(1);
  });

  it('requires authentication (401) and rejects ADMIN tokens (403)', async () => {
    const unauthenticated = await request(app).get('/api/v1/allowlist');
    expect(unauthenticated.status).toBe(401);

    // An ADMIN token cannot use the USER-only allow-list endpoints (contract §1.2 access label).
    await User.create({
      name: 'Admin Test',
      email: 'admin.allowlist@demo.com',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin.allowlist@demo.com', password: 'Admin@123' });
    const asAdmin = await request(app)
      .get('/api/v1/allowlist')
      .set(bearer(login.body.data.accessToken as string));
    expect(asAdmin.status).toBe(403);
    expect(asAdmin.body.error.code).toBe('FORBIDDEN');
  });
});
