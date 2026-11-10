// server/vitest.config.ts — test runner configuration for @focus-mode/server (T-010/T-012 infra).
// Why: every suite needs the same validated env (NODE_ENV=test) and a mongod binary that the DSH
// sandbox is allowed to execute. KI-006: mongodb-memory-server's default cache is `~/.cache`, which
// this sandbox denies — the workaround is MONGOMS_DOWNLOAD_DIR inside the repo (DEC-013).
// Invariants: tests never touch a real database or port; suite files run sequentially because each
// file boots its own memory server and the dev machine has a single cached mongod binary;
// LOG_LEVEL=silent keeps expected 4xx logs out of the test output.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** KI-006: the mongod binary cached inside the workspace by the W0 scaffold. */
const MONGOMS_DOWNLOAD_DIR = fileURLToPath(
  new URL('../node_modules/.cache/mongodb-memory-server', import.meta.url),
);

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Sequential: one mongodb-memory-server per suite on the shared dev machine (KI-006), and
    // deterministic rate-limit windows (each app instance gets a fresh in-memory store).
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // >= 32 chars so config/env.ts (SEC-2) accepts it; explicitly a placeholder, never a
      // real secret (gitleaks allowlists CHANGE_ME_* values — see .gitleaks.toml).
      JWT_SECRET: 'CHANGE_ME_test_only_jwt_secret_padding_0000',
      JWT_EXPIRES_IN: '30m',
      CLIENT_URL: 'http://localhost:5173,http://localhost:5174',
      RATE_LIMIT_AUTH_MAX: '1000',
      // Not used by tests (the helper starts mongodb-memory-server) but required by config/env.ts.
      MONGO_URI: 'mongodb://127.0.0.1:27017/focus-mode-test',
      MONGOMS_DOWNLOAD_DIR,
    },
  },
});
