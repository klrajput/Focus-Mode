// server/src/services/allowlist.service.ts — owns the single per-user allow-list row (FR-008/INV-3).
// Why: pairing a device creates the user's allow-list exactly once, seeded with the canonical
// protected set from `shared/src/protected.ts` (via models/protected-apps.ts) so no device can ever
// start a focus session without the locked entries. Later allow-list endpoints (T-061) reuse
// `ensureAllowlistForUser` instead of duplicating the upsert. Invariants: `protectedApps` is always
// the complete canonical set and is never user-controlled here; one row per user (unique index);
// `version` starts at 1 and is what `/agent/enroll/poll` reports to the Focus Agent.

import type { Types } from 'mongoose';
import { Allowlist, type AllowlistDocument } from '../models/Allowlist.js';
import { buildProtectedAppEntries } from '../models/protected-apps.js';
import { isDuplicateKeyError } from '../utils/mongo-errors.js';

/** Initial allow-list version sent to a freshly paired Focus Agent (INV-3 cache versioning). */
export const INITIAL_ALLOWLIST_VERSION = 1;

/**
 * Find or create the user's allow-list. Creation is race-safe: two devices pairing at the same
 * moment race on the unique `userId` index, and the loser re-reads the winner's row.
 */
export async function ensureAllowlistForUser(
  userId: string | Types.ObjectId,
): Promise<AllowlistDocument> {
  const existing = await Allowlist.findOne({ userId });
  if (existing !== null) return existing;

  try {
    return await Allowlist.create({
      userId,
      protectedApps: buildProtectedAppEntries(),
      userApps: [],
      version: INITIAL_ALLOWLIST_VERSION,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const raced = await Allowlist.findOne({ userId });
      if (raced !== null) return raced;
    }
    throw error;
  }
}

/** Current allow-list version for the agent (`/agent/enroll/poll`), creating the row if absent. */
export async function getAllowlistVersion(userId: string | Types.ObjectId): Promise<number> {
  const allowlist = await ensureAllowlistForUser(userId);
  return allowlist.version;
}
