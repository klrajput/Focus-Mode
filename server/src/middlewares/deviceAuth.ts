// server/src/middlewares/deviceAuth.ts — device-token authentication for agent-facing REST routes
// (T-029/C-20, SEC-6). Why: the Focus Agent has no user JWT; it authenticates with the 256-bit device
// token minted once at `/agent/enroll/poll`. The server stores only its SHA-256 hash and compares in
// constant time, so a database leak cannot be replayed as a credential.
// Invariants: only `Authorization: Bearer <token>` is accepted (no query/cookie fallbacks); a
// revoked/unknown token answers 401 UNAUTHENTICATED; a device without an owner (should not exist
// once a token was issued) is also rejected; a token whose owner is deactivated answers
// 403 ACCOUNT_DISABLED (F-03a); the middleware attaches `req.device` = {id, ownerId}.

import type { Request, RequestHandler } from 'express';
import { ERROR_CODES } from '@focus-mode/shared';
import { Device } from '../models/Device.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { safeEqualHex } from '../utils/crypto.js';
import { hashDeviceToken } from '../utils/device-token.js';

/** The authenticated Focus Agent behind a device-token request. */
export interface AuthenticatedDevice {
  id: string;
  ownerId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    device?: AuthenticatedDevice;
  }
}

const BEARER_PREFIX = 'Bearer ';
const UNAUTHENTICATED_MESSAGE = 'A valid device token is required.';

/** Narrow `req.device` for handlers mounted after `requireDeviceToken`. */
export function getAuthenticatedDevice(req: Request): AuthenticatedDevice {
  if (!req.device) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, UNAUTHENTICATED_MESSAGE);
  }
  return req.device;
}

/** 401 unless a valid, owner-bound device token is present; sets `req.device`. */
export const requireDeviceToken: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length).trim() : '';
  if (token.length === 0) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, UNAUTHENTICATED_MESSAGE);
  }

  const presentedHash = hashDeviceToken(token);
  const device = await Device.findOne({ deviceTokenHash: presentedHash }).select(
    '_id ownerId deviceTokenHash',
  );
  if (
    device === null ||
    typeof device.deviceTokenHash !== 'string' ||
    !safeEqualHex(presentedHash, device.deviceTokenHash) ||
    device.ownerId === null
  ) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, UNAUTHENTICATED_MESSAGE);
  }

  // W6 follow-up F-03a: a deactivated account must lose its device credentials immediately —
  // the dashboard already gets 403 ACCOUNT_DISABLED; the Focus Agent must not keep cloud access.
  const owner = await User.findById(device.ownerId).select('isActive').lean();
  if (owner === null || owner.isActive !== true) {
    throw new AppError(ERROR_CODES.ACCOUNT_DISABLED, 'This account has been disabled.');
  }

  req.device = { id: String(device._id), ownerId: String(device.ownerId) };
  next();
};
