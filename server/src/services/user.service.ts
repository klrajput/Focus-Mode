// server/src/services/user.service.ts — the ONLY mapper from a Mongo user document to the wire
// "public user" shape (INTEGRATION CONTRACTS §3.3). Why: FR-001/NFR-013 forbid `passwordHash` (or
// any future secret field) from ever reaching a client, so responses are built by whitelisting
// fields here instead of spreading a document. Also normalises `_id`/Date objects into the frozen
// wire types (24-hex string id, ISO-8601 strings, `null` lastLoginAt).
// Invariants: never returns passwordHash/updatedAt; role is always USER|ADMIN; dates are ISO strings.

import type { Role } from '@focus-mode/shared';

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
