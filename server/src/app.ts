// server/src/app.ts — the Express 5 application factory (T-010).
// Why: the app is a pure factory (no `listen`, no DB connection), so supertest and the real server
// exercise exactly the same middleware stack. Order matters: request logging → security headers →
// CORS → JSON body cap → operator sanitiser (before any validation, NFR-003) → routes → 404 →
// central error handler.
// Invariants: every response uses the NFR-002 envelope; bodies over 100 kb are rejected; CORS only
// reflects origins from CLIENT_URL (SEC-3); /health is served both at the root (hosting probe) and
// under /api/v1 (contract §3.1).

import { randomUUID } from 'node:crypto';
import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middlewares/error.js';
import { notFound } from './middlewares/not-found.js';
import { sanitizeRequest } from './middlewares/sanitize.js';
import { createApiRouter } from './routes/index.js';
import { healthRouter } from './routes/health.routes.js';

/** JSON bodies are capped at 100 kb (TECHNICAL_DESIGN §8); larger requests become 400. */
export const JSON_BODY_LIMIT = '100kb';

export interface BuildAppOptions {
  /** Test seam for the auth limiter; production uses env.RATE_LIMIT_AUTH_MAX (10 per 15 min). */
  authRateLimitMax?: number;
}

/** Build the fully wired application (no side effects beyond constructing middleware). */
export function buildApp(options: BuildAppOptions = {}): Express {
  const app = express();

  // Do not advertise the framework (helmet also manages this; explicit for non-helmet routes).
  app.disable('x-powered-by');

  // W6/SEC-4: trust exactly the configured number of reverse-proxy hops so req.ip (and every
  // per-IP rate limiter) sees the real client without accepting spoofed X-Forwarded-For headers.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(pinoHttp({ logger, genReqId: () => randomUUID() }));
  app.use(helmet());
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(sanitizeRequest);

  app.use('/health', healthRouter);
  app.use('/api/v1/health', healthRouter);
  app.use(
    '/api/v1',
    createApiRouter({
      authRateLimitMax: options.authRateLimitMax ?? env.RATE_LIMIT_AUTH_MAX,
    }),
  );

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/** SEC-3: reflect only the dashboard origins configured in CLIENT_URL; no wildcard. */
function buildCorsOptions(): CorsOptions {
  return {
    // W6/SEC-3: Bearer tokens live in the Authorization header (no cookies), so cross-origin
    // credentials are unnecessary — and disabling them removes a class of CSRF/cookie abuse.
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
    origin(origin, callback) {
      // No Origin header = same-origin/supertest/curl/native clients (not a browser CORS request).
      if (origin === undefined || env.CLIENT_URLS.includes(origin)) {
        callback(null, true);
        return;
      }
      // Disallowed browser origin: send no CORS headers so the browser blocks the response.
      logger.warn({ origin }, 'blocked CORS origin');
      callback(null, false);
    },
  };
}
