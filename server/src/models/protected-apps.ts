// server/src/models/protected-apps.ts — canonical protected app entries stored in every new
// allow-list (TECHNICAL_DESIGN §4, INV-3). The source of truth is `shared/src/protected.ts`; this
// module only unions its per-OS views into one deduplicated, deep-copied list so Mongo stores the
// same locked rows the Focus Agent resolves per OS. Nothing user-provided flows through here, and
// the list can never be empty — an allow-list without the protected set would violate INV-3.

import { ALL_PROTECTED_KEYS, PROTECTED_BY_OS, type AppEntry } from '@focus-mode/shared';
import { cloneAppEntry } from './app-entry.js';
import { OS_NAMES } from './enums.js';

/**
 * Union of the protected entries across every supported OS, deduplicated by `key` (order follows
 * the frozen shared order). Each entry keeps all of its per-OS identifiers, so the stored row is
 * complete no matter which device the user pairs later.
 */
export function buildProtectedAppEntries(): AppEntry[] {
  const byKey = new Map<string, AppEntry>();
  for (const os of OS_NAMES) {
    for (const entry of PROTECTED_BY_OS[os]) {
      if (!byKey.has(entry.key)) byKey.set(entry.key, cloneAppEntry(entry));
    }
  }
  return [...byKey.values()];
}

/** Frozen canonical copy for read-only consumers (seed, tests, API allow-list creation). */
export const PROTECTED_APP_ENTRIES: readonly AppEntry[] = Object.freeze(
  buildProtectedAppEntries().map((entry) => Object.freeze(cloneAppEntry(entry))),
);

/** Keys that must exist in `protectedApps`; a mismatch is an INV-3 bug, not a user error. */
export function missingProtectedKeys(entries: readonly AppEntry[]): string[] {
  const present = new Set(entries.map((entry) => entry.key));
  return ALL_PROTECTED_KEYS.filter((key) => !present.has(key));
}

/** True when `entries` contains the complete shared protected set. */
export function hasCompleteProtectedSet(entries: readonly AppEntry[]): boolean {
  return missingProtectedKeys(entries).length === 0;
}
