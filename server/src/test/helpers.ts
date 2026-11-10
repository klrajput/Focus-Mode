// server/src/test/helpers.ts — shared supertest + mongodb-memory-server harness (T-010 test infra).
// Why: every API suite needs the same three things — a real Express app from buildApp(), a throwaway
// MongoDB, and a clean database per test. Keeping it here means no suite touches a real DB/port and
// the KI-006 workaround (mongod binary inside the repo because the sandbox denies ~/.cache writes)
// is applied in exactly one place.
// Invariants: tests use the production middleware stack (no stubs); each test starts from an empty
// database; documents created in tests hold real bcrypt hashes (cost 12) like production.

import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { Allowlist } from '../models/Allowlist.js';
import { Device } from '../models/Device.js';
import { User } from '../models/User.js';
import { computePairingCodeHmac } from '../utils/crypto.js';

// KI-006 / DEC-013: point mongodb-memory-server at the workspace cache before it resolves a binary.
if (process.env.MONGOMS_DOWNLOAD_DIR === undefined) {
  process.env.MONGOMS_DOWNLOAD_DIR = fileURLToPath(
    new URL('../../../node_modules/.cache/mongodb-memory-server', import.meta.url),
  );
}

let memoryServer: MongoMemoryServer | null = null;

/** Boot one in-memory mongod and connect mongoose to it (idempotent per test file). */
export async function startTestDatabase(): Promise<void> {
  if (memoryServer !== null) return;
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri(), { dbName: 'focus-mode-test' });
  // Build the indexes the API suites rely on (unique email, unique partial pairTokenHash, one
  // allow-list per user) before any test asserts on duplicate-key behaviour.
  await Promise.all([User.init(), Device.init(), Allowlist.init()]);
}

/** Disconnect mongoose and stop the in-memory mongod. */
export async function stopTestDatabase(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer !== null) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

/** Delete every document between tests while keeping indexes/connection. */
export async function clearTestDatabase(): Promise<void> {
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections).map(async (collection) => {
      await collection.deleteMany({});
    }),
  );
}

/** The real app built exactly as production does (test-only options allowed). */
export function createTestApp(options: BuildAppOptions = {}): Express {
  return buildApp(options);
}

/** Credentials used by most auth tests (meets the shared password rules). */
export const TEST_USER = {
  name: 'Kabir Test',
  email: 'kabir.test@demo.com',
  password: 'Kabir@123',
} as const;

/** POST /api/v1/auth/register with overrides; returns the supertest response and sent payload. */
export async function registerTestUser(
  app: Express,
  overrides: Partial<{ name: string; email: string; password: string }> = {},
) {
  const payload = { ...TEST_USER, ...overrides };
  const response = await request(app).post('/api/v1/auth/register').send(payload);
  return { response, payload };
}

/** Authorization header value for a Bearer token. */
export function bearer(accessToken: string): { Authorization: string } {
  return { Authorization: `Bearer ${accessToken}` };
}

// ---------------------------------------------------------------------------
// Pairing helpers (T-040) — mirror exactly what the Focus Agent/dashboard send.
// ---------------------------------------------------------------------------

/** A fresh 6-digit pairing code as the Focus Agent would display it (leading zeros preserved). */
export function testPairingCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export interface RegisteredTestDevice {
  deviceId: string;
  enrollSecret: string;
  code: string;
  codeHmac: string;
}

/** POST /api/v1/agent/register (step 1) and assert the 201 shape before returning it. */
export async function registerTestDevice(
  app: Express,
  overrides: Partial<{
    code: string;
    name: string;
    os: 'macOS' | 'windows' | 'linux';
    agentVersion: string;
  }> = {},
): Promise<RegisteredTestDevice> {
  const code = overrides.code ?? testPairingCode();
  const codeHmac = computePairingCodeHmac(code);
  const response = await request(app)
    .post('/api/v1/agent/register')
    .send({
      codeHmac,
      os: overrides.os ?? 'macOS',
      name: overrides.name ?? 'Kabir-TestBook',
      agentVersion: overrides.agentVersion ?? '1.4.0',
    });
  if (response.status !== 201) {
    throw new Error(`agent register failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return {
    deviceId: response.body.data.deviceId as string,
    enrollSecret: response.body.data.enrollSecret as string,
    code,
    codeHmac,
  };
}

/** POST /api/v1/devices/pair (step 3) with the dashboard's Bearer token. */
export async function pairTestDevice(
  app: Express,
  accessToken: string,
  code: string,
  name?: string,
) {
  return request(app)
    .post('/api/v1/devices/pair')
    .set(bearer(accessToken))
    .send(name === undefined ? { code } : { code, name });
}

/** POST /api/v1/agent/enroll/poll (step 5) with the agent-held enroll secret. */
export async function pollTestDevice(app: Express, deviceId: string, enrollSecret: string) {
  return request(app).post('/api/v1/agent/enroll/poll').send({ deviceId, enrollSecret });
}

/** Full register→pair→poll happy path; returns the ids/credentials and the polled device token. */
export async function createPairedTestDevice(
  app: Express,
  accessToken: string,
  overrides: Partial<{ name: string; os: 'macOS' | 'windows' | 'linux' }> = {},
): Promise<RegisteredTestDevice & { deviceToken: string }> {
  const registered = await registerTestDevice(app, overrides);
  const paired = await pairTestDevice(app, accessToken, registered.code);
  if (paired.status !== 200) {
    throw new Error(`pair failed: ${paired.status} ${JSON.stringify(paired.body)}`);
  }
  const polled = await pollTestDevice(app, registered.deviceId, registered.enrollSecret);
  if (polled.status !== 200) {
    throw new Error(`poll failed: ${polled.status} ${JSON.stringify(polled.body)}`);
  }
  return { ...registered, deviceToken: polled.body.data.deviceToken as string };
}

/** Mark a device CONNECTED as the T-041 hub does after the agent-link upgrade (for attest tests). */
export async function markDeviceConnected(deviceId: string): Promise<void> {
  await Device.updateOne(
    { _id: deviceId },
    { $set: { status: 'CONNECTED', lastSeenAt: new Date() } },
  );
}
