// server/src/server.ts — process bootstrap: MongoDB connection, HTTP listen, agent-link hub,
// graceful shutdown (T-010/T-041, TECHNICAL_DESIGN §8). Why: keeping this separate from app.ts means
// tests never bind a port or need a real database, while production gets one ordered startup:
// validate env (import of config/env) → connect Mongo → listen → attach the agent-link WebSocket
// hub → handle SIGINT/SIGTERM by closing the hub, then HTTP, then the DB.
// Invariants: fails fast and exits non-zero when Mongo is unreachable; a second signal or a hung
// close cannot leave the process stuck forever (10 s force-exit); connection strings are never
// logged with credentials (NFR-016).

import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { startCronJobs, stopCronJobs } from './cron/index.js';
import { AGENT_LINK_PATH, attachAgentHub, closeAgentHub } from './realtime/agentHub.js';

export interface RunningServer {
  /** Port actually bound (useful for tests/scripts that pass PORT=0). */
  port: number;
  /** Close the hub, the HTTP server and the Mongo connection; safe to call once. */
  stop: () => Promise<void>;
}

/** Strip credentials from a Mongo URI before logging it (NFR-016). */
function sanitizeMongoUri(uri: string): string {
  return uri.replace(/\/\/[^@/]+@/, '//***@');
}

/** Connect to MongoDB, build the app and start listening. Rejects on any startup failure. */
export async function startServer(): Promise<RunningServer> {
  logger.info(
    { env: env.NODE_ENV, mongoUri: sanitizeMongoUri(env.MONGO_URI) },
    'starting Focus Mode API',
  );
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
  logger.info({ host: mongoose.connection.host }, 'MongoDB connected');

  const app = buildApp();
  const httpServer = createServer(app);

  const port = await new Promise<number>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(env.PORT, () => {
      httpServer.off('error', reject);
      const address = httpServer.address();
      resolve(typeof address === 'object' && address !== null ? address.port : env.PORT);
    });
  });
  logger.info({ port }, 'Focus Mode API listening');

  // The hub shares this HTTP server and claims only `/agent-link` (plus the `/api/v1/agent-link`
  // spelling the agent derives from its API base, DEC-013). Its sweeper starts inside attach.
  attachAgentHub(httpServer);
  logger.info({ path: AGENT_LINK_PATH }, 'agent-link WebSocket hub attached');

  // T-063/T-068: the scheduler needs live presence (hub) and the DB; stop it before they close.
  startCronJobs();

  let stopPromise: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      logger.info('closing cron jobs, agent-link hub, HTTP server and MongoDB connection');
      try {
        await stopCronJobs();
      } catch (error) {
        logger.error({ err: error }, 'cron job shutdown failed');
      }
      // Presence writes and socket termination finish before the driver disconnects.
      try {
        await closeAgentHub();
      } catch (error) {
        logger.error({ err: error }, 'agent-link hub close failed');
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      await mongoose.disconnect();
      logger.info('shutdown complete');
    })();
    return stopPromise;
  };

  return { port, stop };
}
