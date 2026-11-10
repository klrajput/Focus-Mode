// server/src/routes/admin.routes.ts — `/api/v1/admin*` (T-073, contract §3.1 #26–#36).
// Why: every admin capability lives behind one `/admin` mount so `routes/index.ts` needs a single
// line: `router.use('/admin', adminRouter)`. All endpoints require a Bearer token whose *database*
// role is ADMIN (`requireAuth` reloads the user, so a promoted/demoted account switches access
// immediately; a deactivated admin gets 403 ACCOUNT_DISABLED) — a USER token always gets 403.
// Invariants: request bodies/queries are validated with the frozen shared admin/preset schemas;
// the only local addition is the optional `role`/`isActive` filter on `GET /admin/users` (strict —
// unknown query keys are still rejected). 201 create, 200 read/update/delete, no 204.

import { Router } from 'express';
import {
  adminUserListQuerySchema,
  adminUserPatchSchema,
  agentLinkCreateSchema,
  agentLinkUpdateSchema,
  presetCreateSchema,
  presetUpdateSchema,
  roleSchema,
} from '@focus-mode/shared';
import { z } from 'zod';
import {
  createAgentLink,
  createPresetHandler,
  listAgentLinks,
  listPresetsHandler,
  listUsers,
  patchAgentLink,
  patchPreset,
  patchUser,
  removeAgentLink,
  removePreset,
  stats,
} from '../controllers/admin.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate, validateQuery } from '../middlewares/validate.js';
import { pageLimitQuerySchema } from '../utils/pagination.js';

/**
 * W5 additive filters on top of the frozen `adminUserListQuerySchema` (#26). `.extend` preserves
 * the strict object, so any other query key is still `400 VALIDATION_ERROR`; contracts that only
 * send page/limit/sort/search behave exactly as documented in §1.6.
 */
export const adminUsersQuerySchema = adminUserListQuerySchema.extend({
  role: roleSchema.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

/** Build the admin router (factory mirrors the other routers; see `adminRouter` below). */
export function createAdminRouter(): Router {
  const router = Router();

  // Authentication + ADMIN authorisation for every route in this router (401 then 403).
  router.use(requireAuth, requireRole('ADMIN'));

  router.get('/users', validateQuery(adminUsersQuerySchema), listUsers);
  router.patch('/users/:id', validate(adminUserPatchSchema), patchUser);

  router.get('/presets', validateQuery(pageLimitQuerySchema), listPresetsHandler);
  router.post('/presets', validate(presetCreateSchema), createPresetHandler);
  router.patch('/presets/:id', validate(presetUpdateSchema), patchPreset);
  router.delete('/presets/:id', removePreset);

  router.get('/agent-links', validateQuery(pageLimitQuerySchema), listAgentLinks);
  router.post('/agent-links', validate(agentLinkCreateSchema), createAgentLink);
  router.patch('/agent-links/:id', validate(agentLinkUpdateSchema), patchAgentLink);
  router.delete('/agent-links/:id', removeAgentLink);

  router.get('/stats', stats);

  return router;
}

/**
 * Ready-to-mount instance for `routes/index.ts` (A5's mount request):
 *   `import { adminRouter } from './admin.routes.js';`
 *   `router.use('/admin', adminRouter);`
 */
export const adminRouter: Router = createAdminRouter();
