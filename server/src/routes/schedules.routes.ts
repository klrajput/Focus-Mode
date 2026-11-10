// server/src/routes/schedules.routes.ts — `/api/v1/schedules*` (T-062, contract §3.1 #17–#20).
// Why: CRUD for the user's recurring focus plans; bodies validated by the frozen shared schedule
// schemas (days 0–6 non-empty unique, HH:mm, 1–480 minutes, name 2–60). Scheduling execution is
// W4/T-063 — nothing here runs or fakes a schedule.
// Invariants: authenticated USER only; foreign/missing ids answer 404 (owner-scoped queries).

import { Router } from 'express';
import { scheduleCreateSchema, scheduleUpdateSchema } from '@focus-mode/shared';
import { create, list, remove, update } from '../controllers/schedules.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate, validateQuery } from '../middlewares/validate.js';
import { pageLimitQuerySchema } from '../utils/pagination.js';

export function createSchedulesRouter(): Router {
  const router = Router();

  router.use(requireAuth, requireRole('USER'));

  router.get('/', validateQuery(pageLimitQuerySchema), list);
  router.post('/', validate(scheduleCreateSchema), create);
  router.patch('/:id', validate(scheduleUpdateSchema), update);
  router.delete('/:id', remove);

  return router;
}
