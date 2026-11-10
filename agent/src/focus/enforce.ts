// focus/enforce.ts — REC-005 "keep distractions aside" enforcement loop (T-055).
// One-shot aside is not "lockdown": apps the user launches during a session would stay in front.
// While a session runs, this loop polls the driver every 1–2 s, filters the *current* visible
// windows through the same INV-3 rules as `enterFocus` (protected first, then allow-list, then
// windows already handled this session), journals the intent and re-asides only the remainder.
// It never touches a protected app, never runs after `stop()`, and a disabled loop makes zero
// driver calls (the interval is never armed).

import type { AppEntry, OsName } from '@focus-mode/shared';
import { computeFocusCandidates, type WindowRef } from '../allowlist.js';
import { noopLogger, type Logger } from '../log.js';
import type { FocusDriver } from './driver.js';
import type { FocusJournal, JournalEntry, JournalWindowRef } from './journal.js';

/** REC-005 window: poll every 1–2 s; anything outside is clamped (never a busy loop). */
export const ENFORCEMENT_MIN_INTERVAL_MS = 1_000;
export const ENFORCEMENT_MAX_INTERVAL_MS = 2_000;
export const ENFORCEMENT_DEFAULT_INTERVAL_MS = 1_500;

export interface ReasidePlan {
  /** Windows this pass may move aside: visible, not protected, not allow-listed, not handled. */
  readonly toAside: readonly WindowRef[];
  /** Left untouched because the protected set owns them (INV-3). */
  readonly protectedCount: number;
  /** Left untouched because the user allow-listed that app. */
  readonly allowListedCount: number;
  /** Already moved aside earlier in this session (journal candidates/changed). */
  readonly handledCount: number;
}

/**
 * Pure candidate filter for one enforcement pass. Protected checks run before allow-list checks,
 * and windows already recorded in the journal are skipped, so a pass is idempotent and can only
 * ever shrink the set of untouched apps.
 */
export function planReaside(input: {
  readonly windows: readonly WindowRef[];
  readonly allowList: readonly AppEntry[];
  readonly protectedEntries: readonly AppEntry[];
  readonly os: OsName;
  readonly handledHandles: ReadonlySet<string>;
}): ReasidePlan {
  const partition = computeFocusCandidates(
    input.windows,
    input.allowList,
    input.protectedEntries,
    input.os,
  );
  const toAside = partition.candidates.filter((window) => !input.handledHandles.has(window.handle));
  return {
    toAside,
    protectedCount: partition.skippedProtected.length,
    allowListedCount: partition.skippedAllowListed.length,
    handledCount: partition.candidates.length - toAside.length,
  };
}

function toJournalWindows(windows: readonly WindowRef[]): readonly JournalWindowRef[] {
  return windows.map((window) => ({
    handle: window.handle,
    appKey: window.appKey,
    ...(window.identifier === undefined ? {} : { identifier: window.identifier }),
  }));
}

/** Merges journal refs by handle, preserving the original order and dropping duplicates. */
function mergeWindows(
  existing: readonly JournalWindowRef[],
  additions: readonly WindowRef[],
): JournalWindowRef[] {
  const seen = new Set(existing.map((window) => window.handle));
  const merged = [...existing];
  for (const addition of additions) {
    if (seen.has(addition.handle)) continue;
    seen.add(addition.handle);
    merged.push(...toJournalWindows([addition]));
  }
  return merged;
}

export interface EnforcementLoopOptions {
  readonly driver: FocusDriver;
  readonly journal: FocusJournal;
  /** Static protected set for `os`, runtime additions included (INV-3). */
  readonly protectedEntries: readonly AppEntry[];
  readonly os: OsName;
  /** The session is still running; checked before and after every await so exit wins races. */
  readonly isActive: () => boolean;
  readonly intervalMs?: number;
  readonly logger?: Logger;
  /** Lets the controller keep its in-memory journal copy in step (restore plan). */
  readonly onJournalUpdated?: (entry: JournalEntry) => void;
  readonly onReasided?: (windows: readonly WindowRef[]) => void;
  readonly setInterval?: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>;
  readonly clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

/**
 * The loop itself. `start()` is a no-op while already running, `stop()` clears the interval and
 * waits for an in-flight pass — the controller awaits it before restoring, so a late apart() can
 * never hide a window after the session ended (INV-5).
 */
export class EnforcementLoop {
  readonly #driver: FocusDriver;
  readonly #journal: FocusJournal;
  readonly #protectedEntries: readonly AppEntry[];
  readonly #os: OsName;
  readonly #isActive: () => boolean;
  readonly #intervalMs: number;
  readonly #logger: Logger;
  readonly #onJournalUpdated: ((entry: JournalEntry) => void) | undefined;
  readonly #onReasided: ((windows: readonly WindowRef[]) => void) | undefined;
  readonly #setInterval: NonNullable<EnforcementLoopOptions['setInterval']>;
  readonly #clearInterval: NonNullable<EnforcementLoopOptions['clearInterval']>;

  #handle: ReturnType<typeof setInterval> | undefined;
  #running = false;
  #inFlight: Promise<readonly WindowRef[]> | undefined;

  constructor(options: EnforcementLoopOptions) {
    this.#driver = options.driver;
    this.#journal = options.journal;
    this.#protectedEntries = options.protectedEntries;
    this.#os = options.os;
    this.#isActive = options.isActive;
    this.#intervalMs = clampInterval(options.intervalMs ?? ENFORCEMENT_DEFAULT_INTERVAL_MS);
    this.#logger = options.logger ?? noopLogger;
    this.#onJournalUpdated = options.onJournalUpdated;
    this.#onReasided = options.onReasided;
    this.#setInterval =
      options.setInterval ?? ((callback, delayMs) => setInterval(callback, delayMs));
    this.#clearInterval = options.clearInterval ?? ((handle) => clearInterval(handle));
  }

  get intervalMs(): number {
    return this.#intervalMs;
  }

  isRunning(): boolean {
    return this.#running;
  }

  /** Arms the poll. The first pass runs after one interval, never synchronously. */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#handle = this.#setInterval(() => {
      void this.tick();
    }, this.#intervalMs);
  }

  /**
   * Stops polling immediately (exit, quit, unpair) and waits for a pass that already started.
   * After this resolves no further driver call can be made by this loop.
   */
  async stop(): Promise<void> {
    this.#running = false;
    const handle = this.#handle;
    this.#handle = undefined;
    if (handle !== undefined) this.#clearInterval(handle);
    const inFlight = this.#inFlight;
    if (inFlight !== undefined) await inFlight;
  }

  /** One enforcement pass; public so tests can drive it deterministically. Never throws. */
  tick(): Promise<readonly WindowRef[]> {
    if (this.#inFlight !== undefined) return this.#inFlight;
    const run = this.#runTick().finally(() => {
      this.#inFlight = undefined;
    });
    this.#inFlight = run;
    return run;
  }

  async #runTick(): Promise<readonly WindowRef[]> {
    if (!this.#running || !this.#isActive()) return [];

    const entry = this.#journal.read();
    if (entry === null) return [];

    let windows: readonly WindowRef[];
    try {
      windows = await this.#driver.listWindows();
    } catch (error) {
      this.#logger.error('Enforcement pass could not list windows', describe(error));
      return [];
    }
    // An exit/quit may have happened while the driver was listing: never apply after that.
    if (!this.#running || !this.#isActive()) return [];

    const handled = new Set(entry.changed.map((window) => window.handle));
    const plan = planReaside({
      windows,
      allowList: entry.allowList,
      protectedEntries: this.#protectedEntries,
      os: this.#os,
      handledHandles: handled,
    });
    if (plan.toAside.length === 0) return [];

    // INV-4: the new candidates are journaled before any window moves.
    const candidates = mergeWindows(entry.candidates, plan.toAside);
    try {
      this.#journal.write({ ...entry, candidates });
    } catch (error) {
      this.#logger.error(
        'Enforcement pass could not journal its candidates; not moving any window',
        describe(error),
      );
      return [];
    }

    let changed: readonly WindowRef[];
    try {
      changed = await this.#driver.asideWindows(plan.toAside);
    } catch (error) {
      // The journal already lists these candidates, so exit/crash recovery still restores them.
      this.#logger.error('Enforcement pass could not move windows aside', describe(error));
      return [];
    }
    if (changed.length === 0) return [];

    const updated: JournalEntry = {
      ...entry,
      candidates,
      changed: mergeWindows(entry.changed, changed),
    };
    try {
      this.#journal.write(updated);
    } catch (error) {
      this.#logger.error(
        'Enforcement pass moved windows but could not journal them; next recovery retries',
        describe(error),
      );
    }
    this.#onJournalUpdated?.(updated);
    this.#onReasided?.(changed);
    this.#logger.info('Re-asided newly opened apps during focus', { count: changed.length });
    return changed;
  }
}

export function clampInterval(intervalMs: number): number {
  if (!Number.isFinite(intervalMs)) return ENFORCEMENT_DEFAULT_INTERVAL_MS;
  return Math.min(
    ENFORCEMENT_MAX_INTERVAL_MS,
    Math.max(ENFORCEMENT_MIN_INTERVAL_MS, Math.trunc(intervalMs)),
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
