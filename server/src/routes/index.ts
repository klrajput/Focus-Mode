// server/src/routes/index.ts — the /api/v1 router assembly point (T-010/T-012/T-040/T-060–T-062).
// Why: one place lists the resource routers mounted under the frozen API base (DEC-013:
// `/api/v1`); later tasks (insights, notifications, admin, …) add their routers here without
// app.ts edits.
// Invariants: every child router is mounted under `/api/v1`; options are threaded down so tests can
// tune middleware (e.g. the auth rate-limit threshold); router order has no overlap between paths.

import { Router } from 'express';
import { createAgentRouter } from './agent.routes.js';
import { createAllowlistRouter } from './allowlist.routes.js';
import { createAuthRouter } from './auth.routes.js';
import { createDevicesRouter } from './devices.routes.js';
import { createPresetsRouter } from './presets.routes.js';
import { createSchedulesRouter } from './schedules.routes.js';
import { createSessionsRouter } from './sessions.routes.js';

export interface ApiRouterOptions {
  authRateLimitMax: number;
}

export function createApiRouter(options: ApiRouterOptions): Router {
  const router = Router();

  router.use('/auth', createAuthRouter({ rateLimitMax: options.authRateLimitMax }));
  router.use('/devices', createDevicesRouter());
  router.use('/agent', createAgentRouter());
  router.use('/sessions', createSessionsRouter());
  router.use('/allowlist', createAllowlistRouter());
  router.use('/presets', createPresetsRouter());
  router.use('/schedules', createSchedulesRouter());

  return router;
}
