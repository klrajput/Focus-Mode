// server/src/routes/allowlist.routes.ts — `/api/v1/allowlist*` (T-061, contract §3.1 #15–#16).
// Why: the allow-list is a single owner-scoped resource; PUT is the only mutation the frozen
// contract defines. Preset application is an additive W3 helper (task-23) that reuses the same
// protected-set rules — it never edits `protectedApps`.
// Invariants: authenticated USER only; bodies validated by the frozen `allowlistPutSchema`
// (≤50 user apps, unique keys); `?mode=` is the only accepted query parameter.

import { Router } from 'express';
import { z } from 'zod';
import { allowlistPutSchema } from '@focus-mode/shared';
import { applyPreset, get, put } from '../controllers/allowlist.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate, validateQuery } from '../middlewares/validate.js';

/** Preset application mode; "merge" (default) keeps existing user apps, "replace" swaps them. */
const presetApplyQuerySchema = z.strictObject({
  mode: z.enum(['merge', 'replace']).default('merge'),
});

export function createAllowlistRouter(): Router {
  const router = Router();

  router.use(requireAuth, requireRole('USER'));

  router.get('/', get);
  router.put('/', validate(allowlistPutSchema), put);
  router.post('/preset/:id', validateQuery(presetApplyQuerySchema), applyPreset);

  return router;
}
