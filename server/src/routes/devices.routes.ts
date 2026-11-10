// server/src/routes/devices.routes.ts — dashboard device routes at `/api/v1/devices*` (T-040/T-043).
// Why: pairing, listing, unpairing and attestation are all owner-scoped actions of an authenticated
// USER (contract §1.2 access label `USER`: USER role + owner check). The router applies
// requireAuth + requireRole('USER') once, then per-route rate limits from §1.9.
// Invariants: no device route is reachable unauthenticated (401) or by an ADMIN token (403, ADMINs
// manage users/presets, not devices — FR-001); pair/attest limiter stores are per app instance, so
// the tests build a fresh app per case to exercise the 429 path deterministically.

import { Router } from 'express';
import { attestRequestSchema, deviceListQuerySchema, devicePairSchema } from '@focus-mode/shared';
import { attest, list, pair, remove } from '../controllers/devices.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import {
  createDeviceAttestRateLimiter,
  createDevicePairRateLimiter,
} from '../middlewares/rateLimit.js';
import { validate, validateQuery } from '../middlewares/validate.js';

export function createDevicesRouter(): Router {
  const router = Router();

  router.use(requireAuth, requireRole('USER'));

  router.post('/pair', createDevicePairRateLimiter(), validate(devicePairSchema), pair);
  router.get('/', validateQuery(deviceListQuerySchema), list);
  router.delete('/:id', remove);
  router.post(
    '/:id/attest',
    createDeviceAttestRateLimiter(),
    validate(attestRequestSchema),
    attest,
  );

  return router;
}
