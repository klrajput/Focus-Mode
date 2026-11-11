// server/src/middlewares/rateLimit.ts — per-IP / per-user limits for the whole API (SEC-4, W6).
// Why: rate limits are the only online-guessing defence for passwords, pairing codes and enrollment
// secrets, and they also bound scraping/CPU-abuse of the analytics endpoints. Every limiter here
// throws the shared RATE_LIMITED AppError so a 429 keeps the standard
// `{success:false,error:{code,message}}` envelope (INTEGRATION_CONTRACTS §1.9) instead of the
// library's plain-text default; messages never reveal whether an account/code exists.
// Invariants: the frozen contract limits are unchanged — auth 10/15 min/IP, `/agent/register`
// 5/min/IP, `/devices/pair` 10/min/user, `/devices/:id/attest` 30/min/user. W6 adds configurable
// general limits (all env knobs are validated in config/env.ts, defaults in parentheses):
//   RATE_LIMIT_API_MAX (600/min/IP, every /api/v1 request), RATE_LIMIT_INSIGHTS_MAX (60/min/user),
//   RATE_LIMIT_NOTIFICATIONS_MAX (120/min/user), RATE_LIMIT_USERS_MAX (60/min/user),
//   RATE_LIMIT_SESSIONS_MAX (120/min/user), RATE_LIMIT_ADMIN_MAX (120/min/user),
//   RATE_LIMIT_PUBLIC_MAX (60/min/IP for public endpoints). E2E/tests can lower those env values to
//   trigger a real 429 deterministically; the exported `createRateLimiter` lets unit tests build a
//   tiny deterministic limiter without timers or sleeps.
// Deployment note: per-IP keys are only correct when Express `trust proxy` matches the real proxy
// topology — `app.set('trust proxy', env.TRUST_PROXY)` (W6), TRUST_PROXY=1 on Render/Railway.

import type { RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { ERROR_CODES } from '@focus-mode/shared';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const MINUTE_MS = 60 * 1000;
/** SEC-4: 10 auth requests / 15 min / IP. */
const AUTH_WINDOW_MS = 15 * MINUTE_MS;
const AUTH_LIMITED_MESSAGE = 'Too many authentication attempts. Please try again in 15 minutes.';
const GENERAL_LIMITED_MESSAGE = 'Too many requests. Please try again in a minute.';
const ADMIN_LIMITED_MESSAGE = 'Too many admin requests. Please try again in a minute.';
const INSIGHTS_LIMITED_MESSAGE = 'Too many insights requests. Please try again in a minute.';

/** How a limiter counts requests: per client IP, or per authenticated user id. */
export type RateLimitKey = 'ip' | 'user';

export interface RateLimiterOptions {
  windowMs: number;
  limit: number;
  identifier: string;
  message: string;
  /** `user` requires the limiter to be mounted after `requireAuth` (which sets `req.user`). */
  keyBy: RateLimitKey;
}

/**
 * Build one limiter. Exported so tests can assert the 429 envelope and key isolation with a tiny
 * limit (no timers, no sleeping); production routers use the named factories below.
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: options.identifier,
    ...(options.keyBy === 'user'
      ? {
          // Authenticated routes only: `requireAuth` has already attached `req.user`.
          keyGenerator: (req): string => req.user?.id ?? ipKeyGenerator(req.ip ?? ''),
        }
      : {}),
    handler: (_req, _res, next) => {
      next(new AppError(ERROR_CODES.RATE_LIMITED, options.message));
    },
  });
}

function minuteLimiter(
  limit: number,
  identifier: string,
  keyBy: RateLimitKey,
  message: string = GENERAL_LIMITED_MESSAGE,
): RequestHandler {
  return createRateLimiter({ windowMs: MINUTE_MS, limit, identifier, message, keyBy });
}

/** SEC-4: `/auth/login`, `/auth/register` — limit configurable for tests (env RATE_LIMIT_AUTH_MAX). */
export function createAuthRateLimiter(limit: number): RequestHandler {
  return createRateLimiter({
    windowMs: AUTH_WINDOW_MS,
    limit,
    identifier: 'auth',
    message: AUTH_LIMITED_MESSAGE,
    keyBy: 'ip',
  });
}

/** SEC-4/§1.9: `POST /agent/register` — 5/min/IP by contract (env knob only for test harnesses). */
export function createAgentRegisterRateLimiter(): RequestHandler {
  return minuteLimiter(
    env.RATE_LIMIT_AGENT_REGISTER_MAX,
    'agent-register',
    'ip',
    'Too many pairing registrations from this address. Please try again in a minute.',
  );
}

/** SEC-4/§1.9: `POST /devices/pair` — 10/min/user (frozen contract value). */
export function createDevicePairRateLimiter(): RequestHandler {
  return minuteLimiter(
    10,
    'device-pair',
    'user',
    'Too many pairing attempts. Please try again in a minute.',
  );
}

/** SEC-4/§1.9: `POST /devices/:id/attest` — 30/min/user (frozen contract value). */
export function createDeviceAttestRateLimiter(): RequestHandler {
  return minuteLimiter(
    30,
    'device-attest',
    'user',
    'Too many attestation requests. Please try again in a minute.',
  );
}

/** W6/SEC-4: general `/api/v1` flood guard, per IP (default 600/min). */
export function createApiRateLimiter(): RequestHandler {
  return minuteLimiter(env.RATE_LIMIT_API_MAX, 'api', 'ip');
}

/** W6/SEC-4: public (unauthenticated) endpoints, per IP (default 60/min). */
export function createPublicRateLimiter(identifier = 'public'): RequestHandler {
  return minuteLimiter(env.RATE_LIMIT_PUBLIC_MAX, identifier, 'ip');
}

/** W6/SEC-4: analytics aggregation is CPU-heavy — per user (default 60/min). */
export function createInsightsRateLimiter(): RequestHandler {
  return minuteLimiter(env.RATE_LIMIT_INSIGHTS_MAX, 'insights', 'user', INSIGHTS_LIMITED_MESSAGE);
}

/** W6/SEC-4: notification polling/paging, per user (default 120/min). */
export function createNotificationsRateLimiter(): RequestHandler {
  return minuteLimiter(env.RATE_LIMIT_NOTIFICATIONS_MAX, 'notifications', 'user');
}

/** W6/SEC-4: profile/password surface — bcrypt-backed writes stay bounded, per user (60/min). */
export function createUserSettingsRateLimiter(): RequestHandler {
  return minuteLimiter(env.RATE_LIMIT_USERS_MAX, 'user-settings', 'user');
}

/** W6/SEC-4: session create/finalise/list, per user (default 120/min). */
export function createSessionsRateLimiter(): RequestHandler {
  return minuteLimiter(env.RATE_LIMIT_SESSIONS_MAX, 'sessions', 'user');
}

/** W6/SEC-4: admin surface, per user (default 120/min). */
export function createAdminRateLimiter(): RequestHandler {
  return minuteLimiter(env.RATE_LIMIT_ADMIN_MAX, 'admin', 'user', ADMIN_LIMITED_MESSAGE);
}
