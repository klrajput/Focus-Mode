// server/src/services/user.service.ts — the ONLY mapper from a Mongo user document to the wire
// "public user" shape (INTEGRATION CONTRACTS §3.3). Why: FR-001/NFR-013 forbid `passwordHash` (or
// any future secret field) from ever reaching a client, so responses are built by whitelisting
// fields here instead of spreading a document. Also normalises `_id`/Date objects into the frozen
// wire types (24-hex string id, ISO-8601 strings, `null` lastLoginAt).
// Invariants: never returns passwordHash/updatedAt; role is always USER|ADMIN; dates are ISO strings.
// Also owns the T-072 profile/password writes so /users/me and /auth/* share one mapper.

import bcrypt from 'bcryptjs';
import {
  ERROR_CODES,
  type ChangePasswordInput,
  type ProfilePatchInput,
  type Role,
} from '@focus-mode/shared';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';

/** Public user shape returned by /auth/register, /auth/login and /auth/me (contract §3.3). */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  timezone: string;
  defaultDurationMin: number;
  isActive: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
}

/**
 * Structural view of the user document shared by A6's `IUser` and lean queries.
 * Deliberately not importing Mongoose types here: the mapper only needs these fields, and a
 * narrower contract keeps it usable from tests with plain objects.
 */
export interface UserLike {
  _id: unknown;
  name: string;
  email: string;
  role: string;
  timezone: string;
  defaultDurationMin: number;
  isActive: boolean;
  createdAt?: unknown;
  lastLoginAt?: unknown;
}

/** SEC-1: bcrypt cost 12 (same constant auth.service uses; kept local to avoid a service cycle). */
const BCRYPT_COST = 12;

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

/** Whitelist + serialise a user document for API responses. */
export function toSafeUser(user: UserLike): PublicUser {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    // The DB enum is the source of truth (models/enums.ts `ROLES`); anything unknown is not admin.
    role: user.role === 'ADMIN' ? 'ADMIN' : 'USER',
    timezone: user.timezone,
    defaultDurationMin: user.defaultDurationMin,
    isActive: user.isActive,
    createdAt: toIsoString(user.createdAt),
    lastLoginAt: toIsoString(user.lastLoginAt),
  };
}

/** Success payload of `POST /users/me/password` (contract §3.1 #7). */
export interface PasswordChanged {
  changed: true;
}

/**
 * PATCH /users/me — apply a validated non-empty profile subset and return the fresh public user.
 * Email/role/activation are deliberately not patchable here (admin-only concerns, FR-019).
 */
export async function updateProfile(userId: string, patch: ProfilePatchInput): Promise<PublicUser> {
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: patch },
    {
      new: true,
      runValidators: true,
    },
  );
  if (user === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found.');
  }
  return toSafeUser(user);
}

/**
 * POST /users/me/password — verify the current password, then store a fresh bcrypt(cost 12) hash.
 * A wrong current password is 401 UNAUTHENTICATED (never a validation error, so a caller cannot use
 * the response to test password guesses); access tokens are stateless and are intentionally not
 * revoked by this endpoint (contract §3.1 #7: no `RATE_LIMITED`-only semantics beyond verification).
 */
export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
): Promise<PasswordChanged> {
  const user = await User.findById(userId).select('+passwordHash');
  if (user === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found.');
  }
  const storedHash = user.passwordHash;
  if (typeof storedHash !== 'string') {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, 'Current password is incorrect.');
  }
  const matches = await bcrypt.compare(input.currentPassword, storedHash);
  if (!matches) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, 'Current password is incorrect.');
  }

  user.passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_COST);
  await user.save();
  return { changed: true };
}
