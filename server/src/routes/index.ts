// server/src/routes/index.ts — the /api/v1 router assembly point (T-010/T-012/T-040/T-060–T-073).
// Why: one place lists the resource routers mounted under the frozen API base (DEC-013:
// `/api/v1`); later tasks (insights, notifications, admin, …) add their routers here without
// app.ts edits.
// Invariants: every child router is mounted under `/api/v1`; options are threaded down so tests can
// tune middleware (e.g. the auth rate-limit threshold); router order has no overlap between paths.

import { Router } from 'express';
import { createAgentRouter } from './agent.routes.js';
import { createAgentLinksRouter } from './agent-links.routes.js';
import { createAllowlistRouter } from './allowlist.routes.js';
import { createAuthRouter } from './auth.routes.js';
import { createDevicesRouter } from './devices.routes.js';
import { createInsightsRouter } from './insights.routes.js';
import { createNotificationsRouter } from './notifications.routes.js';
import { createPresetsRouter } from './presets.routes.js';
import { createSchedulesRouter } from './schedules.routes.js';
import { createSessionsRouter } from './sessions.routes.js';
import { createUsersRouter } from './users.routes.js';

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
  router.use('/insights', createInsightsRouter());
  router.use('/notifications', createNotificationsRouter());
  router.use('/users', createUsersRouter({ passwordRateLimitMax: options.authRateLimitMax }));
  router.use('/agent-links', createAgentLinksRouter());

  // NOTE: the W5 admin router (`/api/v1/admin/*`, T-073/T-074) is owned by a parallel worker.
  // When `routes/admin.routes.ts` lands, A0 only needs: `router.use('/admin', createAdminRouter());`
  // here (no other file changes).

  return router;
}
