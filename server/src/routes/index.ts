// server/src/routes/index.ts — the /api/v1 router assembly point (T-010/T-012/T-040).
// Why: one place lists the resource routers mounted under the frozen API base (DEC-013:
// `/api/v1`); later tasks (sessions, allow-list, …) add their routers here without app.ts edits.
// Invariants: every children router is mounted under `/api/v1`; options are threaded down so tests
// can tune middleware (e.g. the auth rate-limit threshold).

import { Router } from 'express';
import { createAgentRouter } from './agent.routes.js';
import { createAuthRouter } from './auth.routes.js';
import { createDevicesRouter } from './devices.routes.js';

export interface ApiRouterOptions {
  authRateLimitMax: number;
}

export function createApiRouter(options: ApiRouterOptions): Router {
  const router = Router();
  router.use('/auth', createAuthRouter({ rateLimitMax: options.authRateLimitMax }));
  router.use('/devices', createDevicesRouter());
  router.use('/agent', createAgentRouter());
  return router;
}
