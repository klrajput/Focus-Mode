// server/src/routes/users.routes.ts — `/api/v1/users/me*` (T-072, contract §3.1 #6–#7).
// Why: profile and password management for the caller's own account. Bodies use the frozen shared
// schemas (`profilePatchSchema`, `changePasswordSchema`); the password change is additionally rate
// limited because contract #7 lists `RATE_LIMITED` as a possible error (bcrypt is slow by design but
// an online guessing loop still must be bounded).
// Invariants: authenticated user only (label `auth`: USER *and* ADMIN may manage their own profile);
// `email`/`role`/`isActive` are not patchable here; the response never contains a password hash.

import { Router } from 'express';
import { changePasswordSchema, profilePatchSchema } from '@focus-mode/shared';
import { changeMyPassword, getMe, patchMe } from '../controllers/users.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { createAuthRateLimiter, createUserSettingsRateLimiter } from '../middlewares/rateLimit.js';
import { validate } from '../middlewares/validate.js';

export interface UsersRouterOptions {
  /** Password-change attempts per 15 min per IP (reuses the auth limiter, SEC-4 shape). */
  passwordRateLimitMax: number;
}

export function createUsersRouter(options: UsersRouterOptions): Router {
  const router = Router();
  const passwordLimiter = createAuthRateLimiter(options.passwordRateLimitMax);

  router.use(requireAuth);
  // W6/SEC-4: per-user limit on the settings surface (default 60/min; password has its own too).
  router.use(createUserSettingsRateLimiter());
  router.get('/me', getMe);
  router.patch('/me', validate(profilePatchSchema), patchMe);
  router.post('/me/password', passwordLimiter, validate(changePasswordSchema), changeMyPassword);

  return router;
}
