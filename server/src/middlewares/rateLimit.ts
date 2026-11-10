// server/src/middlewares/rateLimit.ts — per-IP auth rate limiting (SEC-4, T-012).
// Why: login/register are the only unauthenticated endpoints that touch passwords, so 10 attempts
// per 15 minutes per IP bounds online guessing. The handler throws the shared RATE_LIMITED AppError
// so the 429 keeps the standard `{success:false,error:{code,message}}` envelope (INTEGRATION
// CONTRACTS §1.9) instead of express-rate-limit's plain-text default.
// Invariants: in-memory store (single API instance, per TECHNICAL_DESIGN §8); the limit value comes
// from env (RATE_LIMIT_AUTH_MAX, default 10) and tests build an app with an explicit lower limit so
// the 429 path is exercised deterministically.
//
// NOTE: in-process limiter — scaling to multiple API instances would need a shared store.
// Deployment note: behind a reverse proxy (Render/Railway) Express must trust exactly one proxy
// hop (`app.set('trust proxy', 1)`) for req.ip to be the client address; the deployment task (W8)
// sets that when the hosting topology is confirmed (BL-07) so per-IP limits stay correct.

import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { ERROR_CODES } from '@focus-mode/shared';
import { AppError } from '../utils/AppError.js';

/** SEC-4: 10 requests / 15 min / IP. */
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMITED_MESSAGE = 'Too many authentication attempts. Please try again in 15 minutes.';

export function createAuthRateLimiter(limit: number): RequestHandler {
  return rateLimit({
    windowMs: AUTH_WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: 'auth',
    handler: (_req, _res, next) => {
      next(new AppError(ERROR_CODES.RATE_LIMITED, RATE_LIMITED_MESSAGE));
    },
  });
}
