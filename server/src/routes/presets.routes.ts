// server/src/routes/presets.routes.ts — `/api/v1/presets` (T-061, contract §3.1 #24).
// Why: read-only list of admin-published allow-list templates for authenticated users; admin CRUD
// is T-073. The frozen contract gives presets no sort/filter schema, so only page/limit are accepted.
// Invariants: authenticated USER only; response is the NFR-009 paginated envelope.

import { Router } from 'express';
import { list } from '../controllers/presets.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validateQuery } from '../middlewares/validate.js';
import { pageLimitQuerySchema } from '../utils/pagination.js';

export function createPresetsRouter(): Router {
  const router = Router();

  router.use(requireAuth, requireRole('USER'));
  router.get('/', validateQuery(pageLimitQuerySchema), list);

  return router;
}
