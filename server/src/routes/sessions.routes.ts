// server/src/routes/sessions.routes.ts — `/api/v1/sessions*` (T-060, contract §3.1 #12–#14).
// Why: session create/finalise/list are authenticated USER actions scoped to the caller's own
// devices; request bodies/queries are validated exclusively with the frozen shared schemas.
// Invariants: no session route is reachable unauthenticated (401) or by an ADMIN token (403, the
// contract access label is `USER`); `/sessions/active` is mounted before the list for clarity.

import { Router } from 'express';
import {
  sessionCreateSchema,
  sessionListQuerySchema,
  sessionPatchSchema,
} from '@focus-mode/shared';
import { active, create, finalise, list } from '../controllers/sessions.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate, validateQuery } from '../middlewares/validate.js';

export function createSessionsRouter(): Router {
  const router = Router();

  router.use(requireAuth, requireRole('USER'));

  router.get('/active', active);
  router.post('/', validate(sessionCreateSchema), create);
  router.get('/', validateQuery(sessionListQuerySchema), list);
  router.patch('/:id', validate(sessionPatchSchema), finalise);

  return router;
}
