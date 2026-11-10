// server/src/services/allowlist.service.ts — owns the single per-user allow-list row (FR-008/FR-020,
// INV-3). Why: pairing creates the row seeded with the canonical protected set; the dashboard may
// only ever change `userApps`. Every write therefore re-checks three invariants: protected entries
// are byte-for-byte unchanged, no user app shadows a protected app (by key OR by executable/bundle
// identifier, so the browser cannot be re-added under a new key), and a successful change bumps
// `version` so the Focus Agent knows its cached list is stale. Applying an admin preset merges its
// safe apps into `userApps` (default) or replaces them, never touching `protectedApps`.
// Invariants: one row per user (unique index); `version` starts at 1 and only increases; value
// objects returned to controllers are plain clones (Mongoose documents never leak).

import type { Types } from 'mongoose';
import {
  ERROR_CODES,
  MAX_USER_APPS,
  isProtectedEntry,
  isProtectedKey,
  type AllowlistPutInput,
  type AppEntry,
} from '@focus-mode/shared';
import { Allowlist, type AllowlistDocument } from '../models/Allowlist.js';
import { OS_NAMES } from '../models/enums.js';
import { cloneAppEntry, hasDuplicateAppKeys } from '../models/app-entry.js';
import { buildProtectedAppEntries } from '../models/protected-apps.js';
import { Preset } from '../models/Preset.js';
import { AppError } from '../utils/AppError.js';
import { isDuplicateKeyError } from '../utils/mongo-errors.js';
import { toObjectIdOrNotFound } from '../utils/object-id.js';

/** Initial allow-list version sent to a freshly paired Focus Agent (INV-3 cache versioning). */
export const INITIAL_ALLOWLIST_VERSION = 1;

/** `allow-list` wire shape (INTEGRATION_CONTRACTS §3.3). */
export interface PublicAllowlist {
  protectedApps: AppEntry[];
  userApps: AppEntry[];
  version: number;
}

interface AllowlistLike {
  protectedApps: AppEntry[];
  userApps: AppEntry[];
  version: number;
}

/** How `POST /allowlist/preset/:id` combines the preset with the current user apps. */
export type PresetApplyMode = 'merge' | 'replace';

function toPlainApps(apps: readonly AppEntry[]): AppEntry[] {
  return apps.map((app) => cloneAppEntry(app));
}

/** Whitelist + clone a document into the wire shape (no Mongoose metadata, no shared references). */
export function toPublicAllowlist(allowlist: AllowlistLike): PublicAllowlist {
  return {
    protectedApps: toPlainApps(allowlist.protectedApps),
    userApps: toPlainApps(allowlist.userApps),
    version: allowlist.version,
  };
}

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

/** GET /allowlist — lazily creates the row so the dashboard always has something to render. */
export async function getAllowlist(userId: string): Promise<PublicAllowlist> {
  return toPublicAllowlist(await ensureAllowlistForUser(userId));
}

/**
 * Stable comparison key for an app entry (property order independent).
 * The entry is cloned first: a Mongoose embedded-document exposes its values through getters
 * and its own enumerable properties are internal, so comparing `Object.entries(doc)` directly
 * would mark every stored entry as "changed".
 */
function appEntryKey(app: AppEntry): string {
  const plain = cloneAppEntry(app);
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(plain)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

/** True when no protected app resolves from `app` on any supported OS (INV-3 shadowing guard). */
function shadowsProtectedApp(app: AppEntry): boolean {
  return OS_NAMES.some((os) => isProtectedEntry(app, os));
}

/**
 * INV-3: the request's `protectedApps` (when sent at all) must be an exact echo of the stored set.
 * Removals → PROTECTED_ENTRY; edited/re-keyed/additional entries → PROTECTED_ENTRY as well.
 */
function assertProtectedAppsUnchanged(
  currentProtected: readonly AppEntry[],
  requestedProtected: readonly AppEntry[] | undefined,
): void {
  if (requestedProtected === undefined) return;

  const currentByKey = new Map(currentProtected.map((app) => [app.key, appEntryKey(app)]));
  const requestedByKey = new Map(requestedProtected.map((app) => [app.key, appEntryKey(app)]));

  const changedKeys = [...currentByKey.keys(), ...requestedByKey.keys()].filter(
    (key) => currentByKey.get(key) !== requestedByKey.get(key),
  );

  if (changedKeys.length > 0) {
    throw new AppError(
      ERROR_CODES.PROTECTED_ENTRY,
      `Protected apps cannot be removed or changed: ${[...new Set(changedKeys)].sort().join(', ')}`,
    );
  }
}

/** A user app may never be (or impersonate) a protected app on any OS (INV-3). */
function assertUserAppsAreSafe(userApps: readonly AppEntry[]): void {
  if (hasDuplicateAppKeys(userApps)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'App keys must be unique');
  }
  for (const app of userApps) {
    if (isProtectedKey(app.key) || shadowsProtectedApp(app)) {
      throw new AppError(
        ERROR_CODES.PROTECTED_ENTRY,
        `"${app.key}" is a protected app and cannot be added to the allow-list`,
      );
    }
  }
}

/** Compare two user-app lists independent of ordering (order is not semantically meaningful). */
function sameUserApps(left: readonly AppEntry[], right: readonly AppEntry[]): boolean {
  if (left.length !== right.length) return false;
  const rightKeys = new Set(right.map(appEntryKey));
  return left.every((app) => rightKeys.has(appEntryKey(app)));
}

async function persistUserApps(
  userId: string,
  current: AllowlistDocument,
  nextUserApps: readonly AppEntry[],
): Promise<PublicAllowlist> {
  if (sameUserApps(current.userApps, nextUserApps)) {
    return toPublicAllowlist(current);
  }
  const updated = await Allowlist.findOneAndUpdate(
    { userId: current.userId },
    { $set: { userApps: toPlainApps(nextUserApps) }, $inc: { version: 1 } },
    { new: true, runValidators: true },
  );
  return toPublicAllowlist(updated ?? current);
}

/**
 * PUT /allowlist — replace `userApps`, reject any protected change, bump `version` on a real change.
 * An unchanged list is idempotent (no version bump, 200).
 */
export async function updateAllowlist(
  userId: string,
  input: AllowlistPutInput,
): Promise<PublicAllowlist> {
  const current = await ensureAllowlistForUser(userId);
  assertProtectedAppsUnchanged(current.protectedApps, input.protectedApps);
  assertUserAppsAreSafe(input.userApps);
  return persistUserApps(userId, current, input.userApps);
}

/**
 * POST /allowlist/preset/:id — apply an admin preset's apps to `userApps`.
 * `replace` swaps the user list for the preset's; `merge` (default) adds preset apps whose keys are
 * not already present, keeping the user's existing entries. Protected entries are always filtered
 * out of the preset (they are already locked) and `protectedApps` is never modified (INV-3).
 */
export async function applyPresetToAllowlist(
  userId: string,
  presetId: string,
  mode: PresetApplyMode,
): Promise<PublicAllowlist> {
  const preset = await Preset.findById(toObjectIdOrNotFound(presetId, 'Preset not found.'));
  if (preset === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Preset not found.');
  }

  const current = await ensureAllowlistForUser(userId);
  const safePresetApps = preset.apps
    .map((app) => cloneAppEntry(app))
    .filter((app) => !isProtectedKey(app.key) && !shadowsProtectedApp(app));

  const nextUserApps =
    mode === 'replace'
      ? safePresetApps
      : [
          ...toPlainApps(current.userApps),
          ...safePresetApps.filter(
            (app) => !current.userApps.some((existing) => existing.key === app.key),
          ),
        ];

  if (nextUserApps.length > MAX_USER_APPS) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `Applying this preset would exceed ${MAX_USER_APPS} user apps — remove some first.`,
    );
  }

  return persistUserApps(userId, current, nextUserApps);
}
