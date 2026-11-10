// server/src/middlewares/rateLimit.ts — per-IP / per-user limits on the credential-bearing routes
// (SEC-4, T-012/T-040/T-043). Why: rate limits are the only online-guessing defence for passwords,
// pairing codes and enrollment secrets, so each contract limit lives here next to the route that
// uses it. The handler throws the shared RATE_LIMITED AppError so a 429 keeps the standard
// `{success:false,error:{code,message}}` envelope (INTEGRATION_CONTRACTS §1.9) instead of the
// library's plain-text default; the message never reveals whether a code/account exists.
// Invariants: limits are the frozen contract values — auth 10/15 min/IP, /agent/register 5/min/IP,
// /devices/pair 10/min/user, /devices/:id/attest 30/min/user; in-memory store = single API instance
// (TECHNICAL_DESIGN §8); tests build a fresh app per test so stores are per-test deterministic.
//
// Deployment note: behind a reverse proxy (Render/Railway) Express must trust exactly one proxy hop
// (`app.set('trust proxy', 1)`) for req.ip to be the client address; the deployment task (W8) sets
// that when the hosting topology is confirmed (BL-07) so per-IP limits stay correct.

import type { RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { ERROR_CODES } from '@focus-mode/shared';
import { AppError } from '../utils/AppError.js';

const MINUTE_MS = 60 * 1000;
/** SEC-4: 10 auth requests / 15 min / IP. */
const AUTH_WINDOW_MS = 15 * MINUTE_MS;
const AUTH_LIMITED_MESSAGE = 'Too many authentication attempts. Please try again in 15 minutes.';

interface LimiterOptions {
  windowMs: number;
  limit: number;
  identifier: string;
  message: string;
  /** `user`: key by authenticated user id (must be mounted after requireAuth); `ip`: default. */
  keyBy: 'ip' | 'user';
}

function createLimiter(options: LimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: options.identifier,
    ...(options.keyBy === 'user'
      ? {
          // Authenticated routes only: requireAuth has already attached `req.user`.
          keyGenerator: (req): string => req.user?.id ?? ipKeyGenerator(req.ip ?? ''),
        }
      : {}),
    handler: (_req, _res, next) => {
      next(new AppError(ERROR_CODES.RATE_LIMITED, options.message));
    },
  });
}

/** SEC-4: `/auth/login`, `/auth/register` — limit configurable for tests (env RATE_LIMIT_AUTH_MAX). */
export function createAuthRateLimiter(limit: number): RequestHandler {
  return createLimiter({
    windowMs: AUTH_WINDOW_MS,
    limit,
    identifier: 'auth',
    message: AUTH_LIMITED_MESSAGE,
    keyBy: 'ip',
  });
}

/** SEC-4/§1.9: `POST /agent/register` — 5/min/IP. */
export function createAgentRegisterRateLimiter(): RequestHandler {
  return createLimiter({
    windowMs: MINUTE_MS,
    limit: 5,
    identifier: 'agent-register',
    message: 'Too many pairing registrations from this address. Please try again in a minute.',
    keyBy: 'ip',
  });
}

/** SEC-4/§1.9: `POST /devices/pair` — 10/min/user. */
export function createDevicePairRateLimiter(): RequestHandler {
  return createLimiter({
    windowMs: MINUTE_MS,
    limit: 10,
    identifier: 'device-pair',
    message: 'Too many pairing attempts. Please try again in a minute.',
    keyBy: 'user',
  });
}

/** SEC-4/§1.9: `POST /devices/:id/attest` — 30/min/user. */
export function createDeviceAttestRateLimiter(): RequestHandler {
  return createLimiter({
    windowMs: MINUTE_MS,
    limit: 30,
    identifier: 'device-attest',
    message: 'Too many attestation requests. Please try again in a minute.',
    keyBy: 'user',
  });
}
