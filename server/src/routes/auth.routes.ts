// server/src/routes/auth.routes.ts — mounts /api/v1/auth/* (T-012, contract §3.1 #2–#5).
// Why: keeps the URL→middleware→controller mapping in one readable table; the auth rate limiter is
// applied to the two public credential endpoints only (SEC-4), never to /me or /logout where a
// valid token is already required.
// Invariants: bodies are validated by the FROZEN shared schemas before the controller runs; the
// limiter value is injected so tests can exercise the 429 path deterministically.

import { Router } from 'express';
import { loginSchema, registerSchema } from '@focus-mode/shared';
import { login, logout, me, register } from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { createAuthRateLimiter } from '../middlewares/rateLimit.js';
import { validate } from '../middlewares/validate.js';

export interface AuthRouterOptions {
  /** SEC-4: 10 requests / 15 min / IP by default (env RATE_LIMIT_AUTH_MAX). */
  rateLimitMax: number;
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const authLimiter = createAuthRateLimiter(options.rateLimitMax);

  router.post('/register', authLimiter, validate(registerSchema), register);
  router.post('/login', authLimiter, validate(loginSchema), login);
  router.post('/logout', requireAuth, logout);
  router.get('/me', requireAuth, me);

  return router;
}
