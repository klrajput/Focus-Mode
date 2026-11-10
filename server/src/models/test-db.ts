// server/src/models/test-db.ts — shared mongodb-memory-server harness for the model + seed suites
// (`src/models/models.test.ts`, `src/seed/seed.test.ts`). It lives in the database-owned tree
// because A5 owns `server/src/test/**`; runtime code never imports it. It sets
// `MONGOMS_DOWNLOAD_DIR` to the repo cache before mongodb-memory-server is loaded (KI-006 /
// DEC-013: the sandbox cannot write `~/.cache`), connects mongoose once per test file and builds
// every index so unique/partial-index assertions test the real database rules.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { AgentLink } from './AgentLink.js';
import { Allowlist } from './Allowlist.js';
import { Device } from './Device.js';
import { Notification } from './Notification.js';
import { Preset } from './Preset.js';
import { Schedule } from './Schedule.js';
import { ScheduleRun } from './ScheduleRun.js';
import { Session } from './Session.js';
import { User } from './User.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (`FocusMode/`), used to locate the cached mongod binary. */
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

/** KI-006: the download cache must stay inside the workspace for the DSH file sandbox. */
export const MONGO_MEMORY_DOWNLOAD_DIR = path.join(
  REPO_ROOT,
  'node_modules',
  '.cache',
  'mongodb-memory-server',
);

/** Every model whose indexes the suites rely on. */
const ALL_MODELS = [
  User,
  Device,
  Session,
  Allowlist,
  Schedule,
  Preset,
  ScheduleRun,
  Notification,
  AgentLink,
] as const;

/** Handle returned by `startTestDatabase`. */
export interface TestDatabase {
  uri: string;
  stop: () => Promise<void>;
}

/** Start an in-memory MongoDB, connect mongoose and build all model indexes. */
export async function startTestDatabase(): Promise<TestDatabase> {
  process.env.MONGOMS_DOWNLOAD_DIR ??= MONGO_MEMORY_DOWNLOAD_DIR;
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  // Indexes must exist before duplicate-key tests; `init()` waits for the build to finish.
  for (const model of ALL_MODELS) await model.init();
  return {
    uri: server.getUri(),
    stop: async () => {
      await mongoose.disconnect();
      await server.stop();
    },
  };
}

/** Remove every document but keep indexes (fast per-test isolation). */
export async function clearCollections(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('test database is not connected');
  const collections = await db.collections();
  await Promise.all(collections.map(async (collection) => collection.deleteMany({})));
}
