// focus/controller.ts — the ONE focus interface the rest of the product talks to (T-030).
// enterFocus(allowList) → journal-first → driver.asideWindows → absolute endsAt timer;
// exitFocus() is idempotent and restores only what the journal says this agent changed
// (INV-4, INV-5). Re-entering while FOCUSING is rejected with ALREADY_FOCUSING (FR-024).
// The controller knows no OS details: everything platform-specific is behind FocusDriver.

import {
  appEntrySchema,
  consentSchema,
  durationMinSchema,
  focusSourceSchema,
  uuidSchema,
  type AgentCapabilities,
  type AgentState,
  type AppEntry,
  type EndReason,
  type FocusSource,
  type OsName,
  type SessionInfo,
} from '@focus-mode/shared';
import { z } from 'zod';
import { computeFocusCandidates, sanitizeAllowList, type WindowRef } from '../allowlist.js';
import { noopLogger, type Logger } from '../log.js';
import { AgentStateMachine } from '../state.js';
import type { FocusDriver, RestorePlan } from './driver.js';
import { journalEntrySchema, type FocusJournal, type JournalEntry } from './journal.js';

/** Local-channel rejection codes this controller can raise (TECHNICAL_DESIGN §6.2). */
export class FocusRejectedError extends Error {
  readonly code: 'ALREADY_FOCUSING' | 'NOT_PAIRED' | 'UNSUPPORTED' | 'INVALID' | 'CONSENT_REQUIRED';

  constructor(code: FocusRejectedError['code'], message: string) {
    super(message);
    this.name = 'FocusRejectedError';
    this.code = code;
  }
}

const enterFocusRequestSchema = z.strictObject({
  durationMin: durationMinSchema,
  allowList: z.array(appEntrySchema).max(50),
  clientSessionId: uuidSchema,
  source: focusSourceSchema.optional(),
  consent: consentSchema.optional(),
});

export interface EnterFocusRequest {
  readonly durationMin: number;
  readonly allowList: readonly AppEntry[];
  readonly clientSessionId: string;
  readonly source?: FocusSource;
  /** Carried from the dashboard's consent modal; native first-run consent is REC-004/W3. */
  readonly consent?: { readonly acceptedAt: string; readonly version: string };
}

/** What the link server/UI may report; session is absent unless a focus session is active. */
export interface FocusSnapshot {
  readonly state: AgentState;
  readonly session?: SessionInfo;
  readonly protected: readonly AppEntry[];
  readonly allowList: readonly AppEntry[];
}

export interface FocusEndedEvent {
  readonly sessionId: string;
  readonly at: string;
  readonly reason: EndReason;
  readonly actualMinutes: number;
}

export type FocusLifecycleEvent =
  | {
      readonly type: 'focusStarted';
      readonly sessionId: string;
      readonly at: string;
      readonly endsAt: string;
      readonly source: FocusSource;
    }
  | ({ readonly type: 'focusEnded' } & FocusEndedEvent);

export interface RecoveryResult {
  readonly sessionId: string;
  readonly actualMinutes: number;
  /** False when restore failed; the journal is kept so the next start can try again. */
  readonly restored: boolean;
}

export interface FocusControllerOptions {
  readonly driver: FocusDriver;
  readonly journal: FocusJournal;
  /** Static protected set for `os`, already merged with runtime additions (allowlist.ts). */
  readonly protectedEntries: readonly AppEntry[];
  readonly os: OsName;
  readonly initialPaired?: boolean;
  readonly now?: () => Date;
  readonly logger?: Logger;
  readonly onEvent?: (event: FocusLifecycleEvent) => void;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

interface ActiveSession {
  entry: JournalEntry;
  readonly startedAtMs: number;
  readonly endsAtMs: number;
  readonly source: FocusSource;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function toJournalWindows(windows: readonly WindowRef[]): JournalEntry['candidates'] {
  return windows.map((window) => ({
    handle: window.handle,
    appKey: window.appKey,
    ...(window.identifier === undefined ? {} : { identifier: window.identifier }),
  }));
}

function roundMinutes(minutes: number): number {
  return Math.round(Math.min(1440, Math.max(0, minutes)) * 10) / 10;
}

export class FocusController {
  readonly #driver: FocusDriver;
  readonly #journal: FocusJournal;
  readonly #protectedEntries: readonly AppEntry[];
  readonly #os: OsName;
  readonly #machine: AgentStateMachine;
  readonly #now: () => Date;
  readonly #logger: Logger;
  readonly #onEvent: ((event: FocusLifecycleEvent) => void) | undefined;
  readonly #setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly #clearTimer: (handle: ReturnType<typeof setTimeout>) => void;

  #allowList: readonly AppEntry[] = [];
  #active: ActiveSession | undefined;
  #exitInFlight: Promise<FocusEndedEvent | null> | undefined;

  constructor(options: FocusControllerOptions) {
    this.#driver = options.driver;
    this.#journal = options.journal;
    this.#protectedEntries = options.protectedEntries;
    this.#os = options.os;
    this.#machine = new AgentStateMachine(options.initialPaired === true ? 'PAIRED' : 'IDLE');
    this.#now = options.now ?? (() => new Date());
    this.#logger = options.logger ?? noopLogger;
    this.#onEvent = options.onEvent;
    this.#setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  /** Honest capability flag from the active driver (FR-005). */
  capabilities(): AgentCapabilities {
    return this.#driver.capabilities();
  }

  getState(): FocusSnapshot {
    const snapshot: FocusSnapshot = {
      state: this.#machine.getState(),
      protected: this.#protectedEntries,
      allowList: this.#allowList,
      ...(this.#active === undefined ? {} : { session: this.#sessionInfo(this.#active) }),
    };
    return snapshot;
  }

  isFocusing(): boolean {
    return this.#active !== undefined;
  }

  /** Persisted pairing restored at startup or enroll poll succeeded (cloud client: W2/T-042). */
  markPaired(): void {
    if (this.#machine.getState() === 'FOCUSING') return;
    this.#machine.markPaired();
  }

  /** Revoked/unpair. The caller must restore first; refusing here protects INV-5. */
  markUnpaired(): void {
    if (this.#machine.getState() === 'FOCUSING') {
      throw new Error('Cannot unpair while FOCUSING — restore first (INV-5)');
    }
    this.#machine.reset();
  }

  /** Read-only allow-list shown in the agent window; never includes protected entries. */
  setAllowList(allowList: readonly AppEntry[]): void {
    this.#allowList = sanitizeAllowList(allowList, this.#protectedEntries, this.#os);
  }

  /**
   * ORDER MATTERS (INV-4): validate → capabilities → list windows → compute candidates →
   * journal write (fsync+rename) → driver.asideWindows → journal update → timer → event.
   * A failure after the journal write restores what changed and keeps the journal if restore
   * failed, so the next start can recover.
   */
  async enterFocus(request: EnterFocusRequest): Promise<FocusSnapshot> {
    const capabilities = this.#driver.capabilities();
    if (capabilities.focus === 'unsupported') {
      throw new FocusRejectedError(
        'UNSUPPORTED',
        capabilities.reasons?.[0] ?? 'Window control is not available on this system.',
      );
    }
    if (this.#active !== undefined || this.#machine.getState() === 'FOCUSING') {
      throw new FocusRejectedError('ALREADY_FOCUSING', 'A focus session is already running.');
    }
    if (this.#machine.getState() !== 'PAIRED') {
      throw new FocusRejectedError('NOT_PAIRED', 'Pair this Focus Agent before starting focus.');
    }

    const parsed = enterFocusRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new FocusRejectedError(
        'INVALID',
        `Invalid focus request: ${parsed.error.issues[0]?.message ?? 'schema validation failed'}`,
      );
    }
    const valid = parsed.data;
    const allowList = sanitizeAllowList(valid.allowList, this.#protectedEntries, this.#os);
    const source: FocusSource = valid.source ?? 'MANUAL';

    const startedAt = this.#now();
    const endsAtMs = startedAt.getTime() + valid.durationMin * 60_000;
    // Absolute deadline, never a countdown: sleep/clock drift cannot extend the session.
    const endsAt = new Date(endsAtMs);

    const windows = await this.#driver.listWindows();
    const partition = computeFocusCandidates(windows, allowList, this.#protectedEntries, this.#os);

    const entry: JournalEntry = {
      version: 1,
      kind: 'FOCUS_SESSION',
      sessionId: valid.clientSessionId,
      startedAt: startedAt.toISOString(),
      endsAt: endsAt.toISOString(),
      plannedMinutes: valid.durationMin,
      source,
      intent: 'FOCUSING',
      protected: this.#protectedEntries.map((protectedEntry) => ({ ...protectedEntry })),
      allowList: allowList.map((allowListEntry) => ({ ...allowListEntry })),
      candidates: toJournalWindows(partition.candidates),
      changed: [],
    };
    journalEntrySchema.parse(entry);

    // INV-4: durable intent BEFORE any window moves.
    this.#journal.write(entry);

    let changed: readonly WindowRef[];
    try {
      changed = await this.#driver.asideWindows(partition.candidates);
    } catch (error) {
      this.#logger.error('Driver failed to apply focus; restoring what it changed', error);
      const restored = await this.#restoreEntry(entry);
      if (restored) this.#journal.clear();
      throw error;
    }

    const updatedEntry: JournalEntry = { ...entry, changed: toJournalWindows(changed) };
    try {
      this.#journal.write(updatedEntry);
    } catch (error) {
      this.#logger.error('Could not update the journal with changed windows; restoring', error);
      const restored = await this.#restoreEntry({ ...entry, changed: updatedEntry.changed });
      if (restored) this.#journal.clear();
      throw error;
    }

    this.#allowList = allowList;
    this.#active = {
      entry: updatedEntry,
      startedAtMs: startedAt.getTime(),
      endsAtMs,
      source,
      timer: undefined,
    };
    this.#machine.markFocusing();
    this.#armTimer(this.#active);
    this.#emit({
      type: 'focusStarted',
      sessionId: updatedEntry.sessionId,
      at: updatedEntry.startedAt,
      endsAt: updatedEntry.endsAt,
      source,
    });
    return this.getState();
  }

  /**
   * Idempotent restore. Called by the dashboard (authed socket, W2), the tray, timer expiry,
   * sleep reconcile (W3), crash recovery and quit. A second call while FOCUSING joins the
   * first restore instead of restoring twice.
   */
  exitFocus(reason: EndReason = 'USER'): Promise<FocusEndedEvent | null> {
    if (this.#exitInFlight !== undefined) return this.#exitInFlight;
    if (this.#active === undefined) return Promise.resolve(null);
    const run = this.#performExit(reason).finally(() => {
      this.#exitInFlight = undefined;
    });
    this.#exitInFlight = run;
    return run;
  }

  /**
   * Startup recovery (FR-023): restore from the journal BEFORE the UI/window/link report
   * state. Never throws — a failure keeps the journal for the next attempt and is logged.
   */
  async recoverFromJournal(): Promise<RecoveryResult | null> {
    const entry = this.#journal.read();
    if (entry === null) return null;

    const actualMinutes = roundMinutes(
      (this.#now().getTime() - new Date(entry.startedAt).getTime()) / 60_000,
    );
    const restored = await this.#restoreEntry(entry);
    if (restored) {
      try {
        this.#journal.clear();
      } catch (error) {
        this.#logger.error('Could not clear the journal after crash recovery', error);
      }
      this.#emit({
        type: 'focusEnded',
        sessionId: entry.sessionId,
        at: this.#now().toISOString(),
        reason: 'CRASH_RECOVERY',
        actualMinutes,
      });
    } else {
      this.#logger.error(
        'Crash-recovery restore failed; keeping the journal so the next start retries',
      );
    }
    return { sessionId: entry.sessionId, actualMinutes, restored };
  }

  /** Cancels a pending timer (tests and shutdown); never touches windows. */
  dispose(): void {
    if (this.#active?.timer !== undefined) {
      this.#clearTimer(this.#active.timer);
      this.#active.timer = undefined;
    }
  }

  async #performExit(reason: EndReason): Promise<FocusEndedEvent | null> {
    const active = this.#active;
    if (active === undefined) return null;

    if (active.timer !== undefined) {
      this.#clearTimer(active.timer);
      active.timer = undefined;
    }

    // Restore BEFORE clearing the journal and before reporting the end (INV-5).
    await this.#driver.restore(this.#planFor(active.entry));
    try {
      this.#journal.clear();
    } catch (error) {
      this.#logger.error('Could not clear the focus journal after restore', error);
    }

    this.#active = undefined;
    this.#machine.markFocusEnded();
    const ended: FocusEndedEvent = {
      sessionId: active.entry.sessionId,
      at: this.#now().toISOString(),
      reason,
      actualMinutes: roundMinutes((this.#now().getTime() - active.startedAtMs) / 60_000),
    };
    this.#emit({ type: 'focusEnded', ...ended });
    return ended;
  }

  #armTimer(active: ActiveSession): void {
    const delayMs = Math.min(
      Math.max(0, active.endsAtMs - this.#now().getTime()),
      MAX_TIMER_DELAY_MS,
    );
    active.timer = this.#setTimer(() => {
      void this.exitFocus('COMPLETED').catch((error: unknown) => {
        this.#logger.error('Timer-driven restore failed; journal kept for recovery', error);
      });
    }, delayMs);
  }

  async #restoreEntry(entry: JournalEntry): Promise<boolean> {
    const plan = this.#planFor(entry);
    if (plan.windows.length === 0) return true;
    try {
      await this.#driver.restore(plan);
      return true;
    } catch (error) {
      this.#logger.error('Driver restore failed', error);
      return false;
    }
  }

  #planFor(entry: JournalEntry): RestorePlan {
    return {
      sessionId: entry.sessionId,
      // If the crash happened mid-apply we only have candidates; restoring a candidate that
      // was never changed is a no-op for real drivers (they check current state).
      windows: entry.changed.length > 0 ? entry.changed : entry.candidates,
    };
  }

  #sessionInfo(active: ActiveSession): SessionInfo {
    return {
      sessionId: active.entry.sessionId,
      startedAt: active.entry.startedAt,
      endsAt: active.entry.endsAt,
      plannedMinutes: active.entry.plannedMinutes,
      source: active.source,
    };
  }

  #emit(event: FocusLifecycleEvent): void {
    this.#onEvent?.(event);
  }
}
