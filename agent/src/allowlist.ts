// allowlist.ts — protected-set resolution and user-app matching for the Focus Agent (T-033).
// The protected set from `@focus-mode/shared` is hard-coded and never removable (INV-3); user
// allow-listed apps are matched only by executable name, bundle id or WM_CLASS. Focus
// candidates are the visible top-level windows that are neither protected nor allow-listed.
// INV-6: this module only ever sees `WindowRef` identifiers — no window titles or URLs exist
// in its input type, so it cannot leak them.

import {
  PROTECTED_BY_OS,
  isProtectedEntry,
  protectedKeysForOs,
  type AppEntry,
  type OsName,
} from '@focus-mode/shared';

/** Field on an `AppEntry` that carries this OS's executable / bundle / WM_CLASS identifiers. */
export type IdentifierField = 'win' | 'mac' | 'linux';

export const OS_IDENTIFIER_FIELD: Readonly<Record<OsName, IdentifierField>> = Object.freeze({
  macOS: 'mac',
  windows: 'win',
  linux: 'linux',
});

/**
 * One visible top-level window, identified only by an opaque OS handle plus the owning app's
 * identifier (`Code.exe`, `com.microsoft.VSCode`, `code`). No titles, no URLs (INV-6).
 */
export interface WindowRef {
  /** Opaque OS handle (HWND as string, PID+bundle id, X11 window id) used for restore. */
  readonly handle: string;
  /** Stable lower-case slug identifying the owning app, e.g. `vscode`. */
  readonly appKey: string;
  /** exe / bundle id / WM_CLASS for the owning process, when the OS exposes it. */
  readonly identifier?: string;
}

export function identifierFieldForOs(os: OsName): IdentifierField {
  return OS_IDENTIFIER_FIELD[os];
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueIdentifiers(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeIdentifier(value);
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value.trim());
  }
  return result;
}

/**
 * Merges runtime additions (e.g. the OS default browser resolved at start, DEC-006) into the
 * hard-coded protected set. Static entries always win their key and never lose identifiers, so
 * a runtime addition can extend the protected set but never shrink it (INV-3).
 */
export function resolveProtectedEntries(
  os: OsName,
  runtimeAdditions: readonly AppEntry[] = [],
): readonly AppEntry[] {
  const merged = new Map<string, AppEntry>();
  for (const entry of PROTECTED_BY_OS[os]) {
    merged.set(entry.key, entry);
  }
  for (const addition of runtimeAdditions) {
    const existing = merged.get(addition.key);
    if (existing === undefined) {
      merged.set(addition.key, addition);
      continue;
    }
    const field = identifierFieldForOs(os);
    merged.set(existing.key, {
      ...existing,
      [field]: uniqueIdentifiers([...(existing[field] ?? []), ...(addition[field] ?? [])]),
    });
  }
  return Object.freeze([...merged.values()]);
}

/** Every protected key for `os`, static plus runtime additions — used by the read-only UI. */
export function protectedKeysWithRuntime(
  os: OsName,
  runtimeAdditions: readonly AppEntry[] = [],
): readonly string[] {
  return Object.freeze([
    ...new Set([...protectedKeysForOs(os), ...runtimeAdditions.map((entry) => entry.key)]),
  ]);
}

/** True when `entry` matches `window` by app key or by one of its per-OS identifiers. */
export function appEntryMatchesWindow(entry: AppEntry, window: WindowRef, os: OsName): boolean {
  if (entry.key === window.appKey) return true;
  const identifiers = entry[identifierFieldForOs(os)] ?? [];
  if (identifiers.length === 0) return false;
  if (window.identifier === undefined) return false;
  const candidate = normalizeIdentifier(window.identifier);
  return identifiers.some((identifier) => normalizeIdentifier(identifier) === candidate);
}

/** Finds the protected app (if any) that owns this window. */
export function findProtectedMatch(
  window: WindowRef,
  protectedEntries: readonly AppEntry[],
  os: OsName,
): AppEntry | undefined {
  return protectedEntries.find((entry) => appEntryMatchesWindow(entry, window, os));
}

/** Finds the allow-listed app (if any) that owns this window. */
export function findAllowListMatch(
  window: WindowRef,
  allowList: readonly AppEntry[],
  os: OsName,
): AppEntry | undefined {
  return allowList.find((entry) => appEntryMatchesWindow(entry, window, os));
}

export interface SkippedWindow {
  readonly window: WindowRef;
  /** Protected app that caused the skip (INV-3) or the allow-list entry that keeps it open. */
  readonly matchedEntry: AppEntry;
}

export interface CandidatePartition {
  /** Windows the driver may move aside: visible, not protected, not allow-listed. */
  readonly candidates: readonly WindowRef[];
  /** Deliberately untouched because they belong to the protected set. */
  readonly skippedProtected: readonly SkippedWindow[];
  /** Deliberately untouched because the user allow-listed that app. */
  readonly skippedAllowListed: readonly SkippedWindow[];
}

/**
 * The core INV-3 rule: a protected window is never a candidate, even when a (hostile or
 * mistaken) allow-list entry names it. Protected checks run *before* allow-list checks so a
 * browser can never be re-added under a new key or identifier.
 */
export function computeFocusCandidates(
  windows: readonly WindowRef[],
  allowList: readonly AppEntry[],
  protectedEntries: readonly AppEntry[],
  os: OsName,
): CandidatePartition {
  const candidates: WindowRef[] = [];
  const skippedProtected: SkippedWindow[] = [];
  const skippedAllowListed: SkippedWindow[] = [];

  for (const window of windows) {
    const protectedEntry = findProtectedMatch(window, protectedEntries, os);
    if (protectedEntry !== undefined) {
      skippedProtected.push({ window, matchedEntry: protectedEntry });
      continue;
    }
    const allowListedEntry = findAllowListMatch(window, allowList, os);
    if (allowListedEntry !== undefined) {
      skippedAllowListed.push({ window, matchedEntry: allowListedEntry });
      continue;
    }
    candidates.push(window);
  }

  return { candidates, skippedProtected, skippedAllowListed };
}

/**
 * Drops protected or duplicate entries from a user allow-list before it is stored/reported.
 * The dashboard should already enforce this, but the agent never trusts a remote allow-list
 * (INV-3, SEC-9).
 */
export function sanitizeAllowList(
  allowList: readonly AppEntry[],
  protectedEntries: readonly AppEntry[],
  os: OsName,
): readonly AppEntry[] {
  const seenKeys = new Set<string>();
  const result: AppEntry[] = [];
  for (const entry of allowList) {
    if (seenKeys.has(entry.key)) continue;
    if (isProtectedEntry(entry, os)) continue;
    if (protectedEntries.some((protectedEntry) => protectedEntry.key === entry.key)) continue;
    seenKeys.add(entry.key);
    result.push(entry);
  }
  return Object.freeze(result);
}
