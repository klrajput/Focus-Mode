// server/src/middlewares/auth.ts — Bearer-JWT authentication and role authorisation (T-012).
// Why: every protected endpoint needs the same rules, so they live in two composable middlewares:
// `requireAuth` verifies the HS256 token, reloads the user (fresh `isActive`/role — a deactivated
// account loses access immediately) and attaches the public user to `req.user`; `requireRole`
// answers 403 FORBIDDEN for a signed-in user with the wrong role (FR-001/FR-019).
// Invariants: missing/garbled/expired token → 401 UNAUTHENTICATED; inactive user → 403
// ACCOUNT_DISABLED (contract §1.2); the DB role is authoritative, never the token claim.

import type { RequestHandler } from 'express';
import { ERROR_CODES, type Role } from '@focus-mode/shared';
import { User } from '../models/User.js';
import { toSafeUser, type PublicUser } from '../services/user.service.js';
import { AppError } from '../utils/AppError.js';
import { verifyAccessToken } from '../utils/jwt.js';

// Adds `req.user` to Express's Request type — the only request augmentation in the server.
declare module 'express-serve-static-core' {
  interface Request {
    user?: PublicUser;
  }
}

const BEARER_PREFIX = 'Bearer ';

/** 401 unless a valid Bearer token for an active user is present; sets `req.user`. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length).trim() : '';
  if (token.length === 0) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, 'Authentication required.');
  }

  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub);
  if (user === null) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, 'Authentication required.');
  }

  const publicUser = toSafeUser(user);
  if (!publicUser.isActive) {
    throw new AppError(ERROR_CODES.ACCOUNT_DISABLED, 'This account has been disabled.');
  }

  req.user = publicUser;
  next();
};

/** 403 unless `req.user.role` is one of `roles` (must be mounted after `requireAuth`). */
export function requireRole(...roles: readonly Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError(ERROR_CODES.UNAUTHENTICATED, 'Authentication required.'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(
        new AppError(ERROR_CODES.FORBIDDEN, 'You do not have permission to perform this action.'),
      );
      return;
    }
    next();
  };
}
