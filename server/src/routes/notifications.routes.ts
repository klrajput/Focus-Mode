// server/src/routes/notifications.routes.ts — `/api/v1/notifications*` (T-075, contract §3.1 #22–#23).
// Why: the bell lists the caller's notifications (paginated, newest first) and marks one read.
// Notifications are only ever created server-side by the scheduler/reaper (T-063/T-068); there is
// deliberately no client-writable notification route. Invariants: authenticated USER only; the read
// route is owner-scoped (foreign/malformed id → 404 NOT_FOUND).

import { Router } from 'express';
import { list, markRead } from '../controllers/notifications.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validateQuery } from '../middlewares/validate.js';
import { pageLimitQuerySchema } from '../utils/pagination.js';

export function createNotificationsRouter(): Router {
  const router = Router();

  router.use(requireAuth, requireRole('USER'));
  router.get('/', validateQuery(pageLimitQuerySchema), list);
  router.patch('/:id/read', markRead);

  return router;
}
