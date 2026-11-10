// server/src/index.ts — the executable entrypoint (`npm run dev`, `npm start`).
// Why: server.ts owns startup/shutdown mechanics; this file only wires OS signals to it and keeps
// the process alive. Separating the two lets tests and scripts import `startServer()` without
// installing signal handlers.
// Invariants: SIGINT/SIGTERM trigger a graceful shutdown (close HTTP, disconnect Mongo) and exit 0;
// a shutdown that hangs is force-terminated after 10 s with exit code 1; startup failures exit 1.

import { logger } from './config/logger.js';
import { startServer } from './server.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const running = await startServer();

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'signal received — shutting down gracefully');

    const forceExit = setTimeout(() => {
      logger.error(
        { timeoutMs: SHUTDOWN_TIMEOUT_MS },
        'graceful shutdown timed out — forcing exit',
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    void running
      .stop()
      .then(() => {
        clearTimeout(forceExit);
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'graceful shutdown failed');
        process.exit(1);
      });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  logger.info('startup complete');
}

void main().catch((error: unknown) => {
  // Includes invalid env (config/env.ts throws on import) and Mongo connect failures.
  logger.error({ err: error }, 'server failed to start');
  process.exit(1);
});
