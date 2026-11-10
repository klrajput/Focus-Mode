// server/src/routes/index.ts — the /api/v1 router assembly point (T-010/T-012).
// Why: one place lists the resource routers mounted under the frozen API base (DEC-013:
// `/api/v1`); W2 tasks (devices, sessions, …) add their routers here without touching app.ts.
// Invariants: every children router is mounted under `/api/v1`; options are threaded down so tests
// can tune middleware (e.g. the auth rate-limit threshold).

import { Router } from 'express';
import { createAuthRouter } from './auth.routes.js';

export interface ApiRouterOptions {
  authRateLimitMax: number;
}

export function createApiRouter(options: ApiRouterOptions): Router {
  const router = Router();
  router.use('/auth', createAuthRouter({ rateLimitMax: options.authRateLimitMax }));
  return router;
}
