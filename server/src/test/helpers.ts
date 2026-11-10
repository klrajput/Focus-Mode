// server/src/test/helpers.ts — shared supertest + mongodb-memory-server harness (T-010 test infra).
// Why: every API suite needs the same three things — a real Express app from buildApp(), a throwaway
// MongoDB, and a clean database per test. Keeping it here means no suite touches a real DB/port and
// the KI-006 workaround (mongod binary inside the repo because the sandbox denies ~/.cache writes)
// is applied in exactly one place.
// Invariants: tests use the production middleware stack (no stubs); each test starts from an empty
// database; documents created in tests hold real bcrypt hashes (cost 12) like production.

import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { buildApp, type BuildAppOptions } from '../app.js';

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
