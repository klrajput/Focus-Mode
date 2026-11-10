// server/src/routes/insights.routes.ts — `/api/v1/insights` (T-070, contract §3.1 #21).
// Why: analytics are an owner-scoped USER action; the frozen `insightsQuerySchema` validates
// `range` (7d|30d|90d) and the optional timezone override, so the service always receives a
// well-formed query. Invariants: authenticated USER only (401/403 otherwise); no path params.

import { Router } from 'express';
import { insightsQuerySchema } from '@focus-mode/shared';
import { get } from '../controllers/insights.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { createInsightsRateLimiter } from '../middlewares/rateLimit.js';
import { validateQuery } from '../middlewares/validate.js';

export function createInsightsRouter(): Router {
  const router = Router();

  router.use(requireAuth, requireRole('USER'));
  // W6/SEC-4: analytics aggregation is CPU-heavy → per-user limit (default 60/min).
  router.use(createInsightsRateLimiter());
  router.get('/', validateQuery(insightsQuerySchema), get);

  return router;
}
