// server/src/routes/agent-links.routes.ts — `/api/v1/agent-links` (T-072, contract §3.1 #25).
// Why: anonymous visitors on the landing page and users on `/settings` need the current installer
// links, so this route is public (no auth middleware). Admin CRUD lives in the admin worker's
// router (T-073). Invariants: public read-only; page/limit only (fixed deterministic order in the
// service); never exposes the publishing admin id.

import { Router } from 'express';
import { list } from '../controllers/agent-links.controller.js';
import { validateQuery } from '../middlewares/validate.js';
import { pageLimitQuerySchema } from '../utils/pagination.js';

export function createAgentLinksRouter(): Router {
  const router = Router();

  router.get('/', validateQuery(pageLimitQuerySchema), list);

  return router;
}
