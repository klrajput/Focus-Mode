// server/src/routes/agent.routes.ts — agent-facing routes at `/api/v1/agent/*` (T-040/T-043/W4).
// Why: the Focus Agent is unauthenticated by user JWT; these endpoints are its whole cloud surface:
// pending pairing (register), one-time token pickup (enroll/poll), the public attestation key it
// caches to verify dashboard attestations, and — with its device token — the owner's allow-list
// needed before a scheduled start (C-20, DEC-021).
// Invariants: register is rate-limited 5/min/IP (SEC-4); enroll/poll is only protected by the
// single-use enroll secret (SEC-6/§5.1); attest-key is public and returns only the public key;
// /allowlist requires a device token and returns only the authenticated device's owner data.

import { Router } from 'express';
import { deviceRegisterSchema, enrollPollSchema } from '@focus-mode/shared';
import { allowlist, attestKey, enrollPoll, register } from '../controllers/agent.controller.js';
import { requireDeviceToken } from '../middlewares/deviceAuth.js';
import { createAgentRegisterRateLimiter } from '../middlewares/rateLimit.js';
import { validate } from '../middlewares/validate.js';

export function createAgentRouter(): Router {
  const router = Router();

  router.post(
    '/register',
    createAgentRegisterRateLimiter(),
    validate(deviceRegisterSchema),
    register,
  );
  router.post('/enroll/poll', validate(enrollPollSchema), enrollPoll);
  router.get('/attest-key', attestKey);
  router.get('/allowlist', requireDeviceToken, allowlist);

  return router;
}
