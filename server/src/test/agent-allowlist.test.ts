// server/src/test/agent-allowlist.test.ts — `GET /api/v1/agent/allowlist` (C-20, DEC-021 §2).
// Why: a scheduled start happens with no dashboard open, so the Focus Agent must fetch the owner's
// allow-list over its device token before `enterFocus`. The endpoint is agent-authenticated (no user
// JWT), owner-scoped and always returns the complete locked protected set (INV-3) plus the user's
// apps and cache version — creating the default row lazily if the account never had one.
// Invariants asserted: device-token auth only (401 for missing/invalid/revoked/user-JWT), pending
// (ownerless) devices can never read a list, and each device sees only its own owner's list.

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Allowlist } from '../models/Allowlist.js';
import { Device } from '../models/Device.js';
import { buildProtectedAppEntries, hasCompleteProtectedSet } from '../models/protected-apps.js';
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
} from './helpers.js';

const VSCODE = {
  key: 'vscode',
  label: 'Visual Studio Code',
  win: ['Code.exe'],
  mac: ['com.microsoft.VSCode'],
};

let app: Express;

async function getAllowlist(token: string) {
  return request(app).get('/api/v1/agent/allowlist').set(bearer(token));
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
});

describe('GET /api/v1/agent/allowlist (C-20)', () => {
  it('returns the owner’s full allow-list for a valid device token (lazily created)', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata' });
    const { token } = await createTestDevice({ ownerId: user._id });

    const response = await getAllowlist(token);

    expect(response.status).toBe(200);
    const data = response.body.data as {
      protectedApps: { key: string; label: string }[];
      userApps: unknown[];
      version: number;
    };
    expect(data.version).toBe(1);
    expect(data.userApps).toEqual([]);
    expect(hasCompleteProtectedSet(data.protectedApps)).toBe(true);
    expect(await Allowlist.countDocuments({ userId: user._id })).toBe(1);
  });

  it('returns the configured user apps and current version', async () => {
    const user = await createDirectUser();
    const { token } = await createTestDevice({ ownerId: user._id });
    await Allowlist.create({
      userId: user._id,
      protectedApps: buildProtectedAppEntries(),
      userApps: [VSCODE],
      version: 4,
    });

    const response = await getAllowlist(token);

    expect(response.status).toBe(200);
    expect(response.body.data.version).toBe(4);
    expect(response.body.data.userApps).toEqual([VSCODE]);
  });

  it('rejects a missing, unknown or revoked device token with 401 UNAUTHENTICATED', async () => {
    const user = await createDirectUser();
    const { deviceId, token } = await createTestDevice({ ownerId: user._id });

    const missing = await request(app).get('/api/v1/agent/allowlist');
    const unknown = await getAllowlist(`${token}-wrong`);

    // Revoke the token the way `DELETE /devices/:id` does (hash cleared).
    await Device.updateOne({ _id: deviceId }, { $set: { deviceTokenHash: null } });
    const revoked = await getAllowlist(token);

    for (const response of [missing, unknown, revoked]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('never serves an unpaired (ownerless) pending device even if it has a token hash', async () => {
    const token = 'pending-device-token-value';
    await Device.create({
      ownerId: null,
      name: 'Pending Mac',
      os: 'macOS',
      agentVersion: '1.4.0',
      deviceTokenHash: hashDeviceToken(token),
    });

    const response = await getAllowlist(token);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('does not accept a user access token as device auth', async () => {
    const registration = await registerTestUser(app);
    const userToken = registration.response.body.data.accessToken as string;

    const response = await getAllowlist(userToken);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('keeps each device scoped to its own owner’s allow-list', async () => {
    const firstUser = await createDirectUser();
    const secondUser = await createDirectUser();
    const firstDevice = await createTestDevice({ ownerId: firstUser._id });
    const secondDevice = await createTestDevice({ ownerId: secondUser._id });
    await Allowlist.create({
      userId: secondUser._id,
      protectedApps: buildProtectedAppEntries(),
      userApps: [VSCODE],
      version: 2,
    });

    const first = await getAllowlist(firstDevice.token);
    const second = await getAllowlist(secondDevice.token);

    expect(first.body.data.userApps).toEqual([]);
    expect(first.body.data.version).toBe(1);
    expect(second.body.data.userApps).toEqual([VSCODE]);
    expect(second.body.data.version).toBe(2);
  });
});
