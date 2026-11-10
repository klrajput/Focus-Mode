// server/src/routes/agent.routes.ts — agent-facing routes at `/api/v1/agent/*` (T-040/T-043).
// Why: the Focus Agent is unauthenticated by user JWT; these three endpoints are its whole cloud
// surface before it has a device token (register), while polling with its enroll secret, and the
// public attestation key it caches to verify dashboard attestations.
// Invariants: register is rate-limited 5/min/IP (SEC-4); enroll/poll is only protected by the
// single-use enroll secret (SEC-6/§5.1); attest-key is public and returns only the public key.

import { Router } from 'express';
import { deviceRegisterSchema, enrollPollSchema } from '@focus-mode/shared';
import { attestKey, enrollPoll, register } from '../controllers/agent.controller.js';
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

  return router;
}
