// e2e/helpers/start-api.ts — boots a throwaway real API for Playwright (T-047 prep, owner A8).
// Why: the E2E dashboard and Focus Agent must talk to the REAL Express + MongoDB API — a faked
// backend is forbidden by the exam rules, and supertest-level stubs would not exercise the browser
// path. This process starts mongodb-memory-server, points the production server bootstrap at it,
// seeds the DEC-013 demo data, and keeps the API up until Playwright stops it.
// Invariants: no real database or reserved dev port is touched; all env is set BEFORE
// `server/src/config/env.ts` is evaluated (it validates and freezes at import time); KI-006's
// MONGOMS_DOWNLOAD_DIR is applied so the sandbox may execute the workspace-cached mongod; goodbye is
// graceful on SIGTERM/SIGINT (Playwright sends SIGTERM before force-killing).
//
// Run directly: `npm run build -w @focus-mode/shared && npx tsx e2e/helpers/start-api.ts`

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { API_ORIGIN, CLIENT_ORIGIN, E2E_API_PORT } from './config';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Set an env default without overriding a value the caller/CI deliberately exported. */
function setDefault(name: string, value: string): void {
  if (process.env[name] === undefined || process.env[name] === '') process.env[name] = value;
}

/**
 * Ephemeral Ed25519 attestation keypair in the single-line PEM form the server expects
 * (INTEGRATION_CONTRACTS §4.4). Harmless today; required as soon as T-043's routes land.
 */
async function setAttestationKeyDefaults(): Promise<void> {
  if (process.env.ATTEST_PRIVATE_KEY !== undefined && process.env.ATTEST_PUBLIC_KEY !== undefined) {
    return;
  }
  const { generateKeyPairSync: generateKeyPair } = await import('node:crypto');
  const { privateKey, publicKey } = generateKeyPair('ed25519');
  const singleLinePem = (value: string): string => value.trim().replace(/\n/g, '\\n');
  setDefault(
    'ATTEST_PRIVATE_KEY',
    singleLinePem(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()),
  );
  setDefault(
    'ATTEST_PUBLIC_KEY',
    singleLinePem(publicKey.export({ format: 'pem', type: 'spki' }).toString()),
  );
  setDefault('PAIR_PEPPER', 'CHANGE_ME_e2e_only_pair_pepper_padding_000000');
}

/** Boot memory Mongo → the real API → the demo seed; resolve when all three are ready. */
async function main(): Promise<void> {
  setDefault('NODE_ENV', 'test');
  setDefault('PORT', String(E2E_API_PORT));
  setDefault('CLIENT_URL', CLIENT_ORIGIN);
  // Expected 4xx noise (e.g. the W1 dashboard calling a W2-only endpoint) would drown the E2E
  // output; real server errors still surface at `error` and specs fail on their own assertions.
  setDefault('LOG_LEVEL', 'error');
  // >= 32 chars so config/env.ts (SEC-2) accepts it; clearly a test placeholder, never a secret.
  setDefault('JWT_SECRET', 'CHANGE_ME_e2e_only_jwt_secret_padding_0000000000');
  setDefault('JWT_EXPIRES_IN', '30m');
  // Specs log in repeatedly and the whole suite shares one process; the product limits are for
  // humans, not the harness. The security spec's 429 burst uses the hardcoded 10/min pair limiter.
  setDefault('RATE_LIMIT_AUTH_MAX', '1000');
  // env.ts caps: RATE_LIMIT_API_MAX <= 100_000, the per-resource limiters <= 10_000.
  setDefault('RATE_LIMIT_API_MAX', '100000');
  // The full E2E suite launches several REAL agents from 127.0.0.1 within a minute; the production
  // contract value (5/min/IP on POST /agent/register) would reject the suite's own later launches.
  setDefault('RATE_LIMIT_AGENT_REGISTER_MAX', '10000');
  for (const name of [
    'RATE_LIMIT_PUBLIC_MAX',
    'RATE_LIMIT_INSIGHTS_MAX',
    'RATE_LIMIT_NOTIFICATIONS_MAX',
    'RATE_LIMIT_USERS_MAX',
    'RATE_LIMIT_SESSIONS_MAX',
    'RATE_LIMIT_ADMIN_MAX',
  ]) {
    setDefault(name, '10000');
  }
  setDefault('MONGO_URI', 'mongodb://127.0.0.1:27017/focus-mode-e2e'); // replaced below
  // KI-006: the sandbox cannot write ~/.cache, so point mongodb-memory-server at the workspace cache.
  setDefault(
    'MONGOMS_DOWNLOAD_DIR',
    path.join(REPO_ROOT, 'node_modules', '.cache', 'mongodb-memory-server'),
  );
  await setAttestationKeyDefaults();

  // Dynamic imports only: importing server sources earlier would evaluate config/env.ts too early.
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const memory = await MongoMemoryServer.create({ instance: { dbName: 'focus-mode-e2e' } });
  process.env.MONGO_URI = memory.getUri();
  process.stdout.write(`[e2e-api] mongodb-memory-server ready (${memory.getUri()})\n`);

  // Seed BEFORE the HTTP listener starts: Playwright's `webServer` only waits for `/health`, so if
  // the listener came up first the very first spec could run before the demo accounts exist
  // (observed as a flaky 401 on the first login). `seedDatabase` owns and closes its own mongoose
  // connection when none is open, so this also keeps the seed path identical to `npm run seed`.
  const { seedDatabase } = await import('../../server/src/seed/seed.js');
  const counts = await seedDatabase({
    log: (message) => process.stdout.write(`[e2e-api] ${message}\n`),
  });
  process.stdout.write(
    `[e2e-api] seeded demo data — users=2 sessions=${counts.sessions} ` +
      `schedules=${counts.schedules} presets=${counts.presets} agentLinks=${counts.agentLinks}\n`,
  );

  // Now start the API: once `/health` answers, the seeded fixtures are guaranteed to exist.
  const { startServer } = await import('../../server/src/server.js');
  const running = await startServer();
  process.stdout.write(`[e2e-api] ready on ${API_ORIGIN} (POST/GET ${API_ORIGIN}/health)\n`);

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`[e2e-api] ${signal} — closing HTTP server and memory MongoDB\n`);
    try {
      await running.stop();
    } catch (error) {
      process.stderr.write(`[e2e-api] HTTP/Mongo shutdown failed: ${String(error)}\n`);
    }
    try {
      await memory.stop();
    } catch (error) {
      process.stderr.write(`[e2e-api] memory MongoDB stop failed: ${String(error)}\n`);
    }
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `[e2e-api] failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
