// focus/controller.ts — the ONE focus interface the rest of the product talks to (T-030).
// enterFocus(allowList) → journal-first → driver.asideWindows → absolute endsAt timer;
// exitFocus() is idempotent and restores only what the journal says this agent changed
// (INV-4, INV-5). Re-entering while FOCUSING is rejected with ALREADY_FOCUSING (FR-024).
// The controller knows no OS details: everything platform-specific is behind FocusDriver.

import {
  appEntrySchema,
  appKeySchema,
  consentSchema,
  durationMinSchema,
  focusSourceSchema,
  objectIdSchema,
  uuidSchema,
  type AgentCapabilities,
  type AgentState,
  type AppEntry,
  type EndReason,
  type FocusSource,
  type OsName,
  type RunningApp,
  type SessionInfo,
} from '@focus-mode/shared';
import { z } from 'zod';
import { computeFocusCandidates, sanitizeAllowList, type WindowRef } from '../allowlist.js';
import { noopLogger, type Logger } from '../log.js';
import { AgentStateMachine } from '../state.js';
import type { ConsentGate } from './consent.js';
import type { FocusDriver, RestorePlan } from './driver.js';
import { EnforcementLoop, ENFORCEMENT_DEFAULT_INTERVAL_MS } from './enforce.js';
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
  /** REC-005 "keep distractions aside"; absent means ON (the product default). */
  reaside: z.boolean().optional(),
  /**
   * DEC-021: the `scheduleRuns._id` this session fulfils. Agent-internal only — it is never part
   * of the local-channel `enterFocus` schema, so a dashboard cannot set it; the scheduled flow
   * passes it so the lifecycle report can carry `scheduleRunId` to the cloud.
   */
  scheduleRunId: objectIdSchema.optional(),
});

export interface EnterFocusRequest {
  readonly durationMin: number;
  readonly allowList: readonly AppEntry[];
  readonly clientSessionId: string;
  readonly source?: FocusSource;
  /** Carried from the dashboard's consent modal (FR-009); never a substitute for REC-004. */
  readonly consent?: { readonly acceptedAt: string; readonly version: string };
  /** REC-005; default true. `false` makes the enforcement loop issue zero driver calls. */
  readonly reaside?: boolean;
  /** DEC-021: present only for a scheduler-started session; echoed in the lifecycle event. */
  readonly scheduleRunId?: string;
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
  /** Terminal session status for the cloud report (the local wire frame carries only reason). */
  readonly status: 'COMPLETED' | 'CANCELLED';
}

export type FocusLifecycleEvent =
  | {
      readonly type: 'focusStarted';
      readonly sessionId: string;
      readonly at: string;
      readonly endsAt: string;
      /** Planned duration of the session; the cloud report needs it explicitly (T-069). */
      readonly plannedMinutes: number;
      readonly source: FocusSource;
      /** DEC-021: set only when the scheduler started this session. */
      readonly scheduleRunId?: string;
    }
  | ({ readonly type: 'focusEnded' } & FocusEndedEvent);

export interface RecoveryResult {
  readonly sessionId: string;
  readonly actualMinutes: number;
  /** False when restore failed; the journal is kept so the next start can try again. */
  readonly restored: boolean;
}

export interface EnforcementOptions {
  /** 1–2 s per REC-005; out-of-range values are clamped by `enforce.ts`. */
  readonly intervalMs?: number;
}

export interface FocusControllerOptions {
  readonly driver: FocusDriver;
  readonly journal: FocusJournal;
  /** Static protected set for `os`, already merged with runtime additions (allowlist.ts). */
  readonly protectedEntries: readonly AppEntry[];
  readonly os: OsName;
  /**
   * Native first-run gate (REC-004). Required on purpose: every `enterFocus` path — dashboard,
   * scheduled and tray — must pass through the dialog once per device, and making it optional
   * would let a caller silently skip the only consent a web page cannot answer.
   */
  readonly consent: ConsentGate;
  readonly initialPaired?: boolean;
  /** REC-005 loop tuning; `false` disables re-asiding entirely (tests/QA, never the default). */
  readonly enforcement?: EnforcementOptions | false;
  readonly now?: () => Date;
  readonly logger?: Logger;
  readonly onEvent?: (event: FocusLifecycleEvent) => void;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Chunking ceiling for the absolute timer (Node clamps >2^31−1 ms); injectable for tests. */
  readonly maxTimerDelayMs?: number;
}

interface ActiveSession {
  entry: JournalEntry;
  readonly startedAtMs: number;
  readonly endsAtMs: number;
  readonly source: FocusSource;
  readonly reaside: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface ExitOverride {
  readonly actualMinutesMs?: number;
  readonly status?: 'COMPLETED' | 'CANCELLED';
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

/** Display label for an app key we have no catalogue entry for (`visual-studio-code`). */
function humanizeAppKey(key: string): string {
  return key
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .slice(0, 60);
}

export class FocusController {
  readonly #driver: FocusDriver;
  readonly #journal: FocusJournal;
  readonly #protectedEntries: readonly AppEntry[];
  readonly #os: OsName;
  readonly #machine: AgentStateMachine;
  readonly #consent: ConsentGate;
  readonly #now: () => Date;
  readonly #logger: Logger;
  readonly #onEvent: ((event: FocusLifecycleEvent) => void) | undefined;
  readonly #setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly #clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  readonly #maxTimerDelayMs: number;
  readonly #enforcement: EnforcementLoop | undefined;

  #allowList: readonly AppEntry[] = [];
  #active: ActiveSession | undefined;
  #enterInFlight: Promise<FocusSnapshot> | undefined;
  #exitInFlight: Promise<FocusEndedEvent | null> | undefined;
  /** Recorded on `powerMonitor 'suspend'`; drives the TD §7.4 sleep reconcile. */
  #suspendAt: Date | undefined;

  constructor(options: FocusControllerOptions) {
    this.#driver = options.driver;
    this.#journal = options.journal;
    this.#protectedEntries = options.protectedEntries;
    this.#os = options.os;
    this.#consent = options.consent;
    this.#machine = new AgentStateMachine(options.initialPaired === true ? 'PAIRED' : 'IDLE');
    this.#now = options.now ?? (() => new Date());
    this.#logger = options.logger ?? noopLogger;
    this.#onEvent = options.onEvent;
    this.#setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.#maxTimerDelayMs = options.maxTimerDelayMs ?? MAX_TIMER_DELAY_MS;
    this.#enforcement =
      options.enforcement === false
        ? undefined
        : new EnforcementLoop({
            driver: this.#driver,
            journal: this.#journal,
            protectedEntries: this.#protectedEntries,
            os: this.#os,
            isActive: () => this.isFocusing(),
            intervalMs: options.enforcement?.intervalMs ?? ENFORCEMENT_DEFAULT_INTERVAL_MS,
            logger: this.#logger,
            onJournalUpdated: (entry) => {
              // Keep the in-memory session in step with the journal so exit restores
              // everything this session moved, including windows re-asided later.
              if (this.#active !== undefined && this.#active.entry.sessionId === entry.sessionId) {
                this.#active.entry = entry;
              }
            },
          });
  }

  /** Honest capability flag from the active driver (FR-005). */
  capabilities(): AgentCapabilities {
    return this.#driver.capabilities();
  }

  /**
   * REC-007 `listApps` answer: app key + human label + running flag only. Derived from the same
   * window identifiers the driver already exposes, so no window title, URL or content is ever
   * read (INV-6). Allow-listed apps that are not currently running appear with `running: false`.
   */
  async listRunningApps(): Promise<readonly RunningApp[]> {
    const windows = await this.#driver.listWindows();
    const runningKeys = new Set(windows.map((window) => window.appKey));
    const labels = new Map<string, string>();
    for (const entry of [...this.#protectedEntries, ...this.#allowList]) {
      labels.set(entry.key, entry.label);
    }
    const keys = new Set<string>([...runningKeys, ...this.#allowList.map((entry) => entry.key)]);
    return [...keys]
      .filter((key) => appKeySchema.safeParse(key).success)
      .sort()
      .map((key) => ({
        key,
        label: labels.get(key) ?? humanizeAppKey(key),
        running: runningKeys.has(key),
      }));
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

  /** True when the native first-run permission for the current version is stored (REC-004). */
  nativeConsentGranted(): boolean {
    return this.#consent.isGranted();
  }

  /** Stored grant (or null) for the agent window/tray; never grants anything by being read. */
  nativeConsentRecord(): { readonly version: string; readonly acceptedAt: string } | null {
    return this.#consent.currentRecord();
  }

  /** Tray/agent-window "Reset focus permission": the next start asks the native dialog again. */
  revokeNativeConsent(): void {
    this.#consent.revoke();
  }

  /** Read-only allow-list shown in the agent window; never includes protected entries. */
  setAllowList(allowList: readonly AppEntry[]): void {
    this.#allowList = sanitizeAllowList(allowList, this.#protectedEntries, this.#os);
  }

  /** `powerMonitor 'suspend'` (TD §7.4): remember when the machine went to sleep. */
  recordSuspend(at: Date = this.#now()): void {
    this.#suspendAt = at;
    if (this.isFocusing()) {
      this.#logger.info('Focus session suspended; deadline stays absolute', {
        suspendAt: at.toISOString(),
      });
    }
  }

  /**
   * `powerMonitor 'resume'` reconcile (TD §7.4, FR-014):
   * - awake past `endsAt` → end with reason SLEEP; `actualMinutes = (suspendAt − startedAt)`;
   *   status COMPLETED only when the machine was awake at/after the deadline, else CANCELLED.
   * - still time left → re-arm the absolute timer and re-apply the aside set immediately.
   */
  async resumeFromSleep(): Promise<FocusEndedEvent | null> {
    const suspendAt = this.#suspendAt;
    this.#suspendAt = undefined;
    const active = this.#active;
    if (active === undefined) return null;

    const now = this.#now();
    const effectiveSuspend = suspendAt ?? now;
    if (now.getTime() >= active.endsAtMs) {
      return this.#exitOnce('SLEEP', {
        actualMinutesMs: effectiveSuspend.getTime() - active.startedAtMs,
        status: effectiveSuspend.getTime() >= active.endsAtMs ? 'COMPLETED' : 'CANCELLED',
      });
    }

    // Remaining time survived the sleep: the absolute deadline still governs the end.
    this.#clearActiveTimer(active);
    this.#armTimer(active);
    if (active.reaside) await this.#enforcement?.tick();
    this.#logger.info('Focus session resumed with time left', {
      sessionId: active.entry.sessionId,
      endsAt: active.entry.endsAt,
    });
    return null;
  }

  /**
   * ORDER MATTERS (INV-4): validate → capabilities → native consent (REC-004) → list windows →
   * compute candidates → journal write (fsync+rename) → driver.asideWindows → journal update →
   * timer → enforcement loop → event. A failure after the journal write restores what changed
   * and keeps the journal if restore failed, so the next start can recover.
   */
  enterFocus(request: EnterFocusRequest): Promise<FocusSnapshot> {
    // A slow native consent dialog or driver call must not let a second request slip past the
    // ALREADY_FOCUSING check while the first is still applying focus (FR-024).
    if (this.#enterInFlight !== undefined) {
      return Promise.reject(
        new FocusRejectedError('ALREADY_FOCUSING', 'A focus session is already starting.'),
      );
    }
    const run = this.#performEnterFocus(request).finally(() => {
      this.#enterInFlight = undefined;
    });
    this.#enterInFlight = run;
    return run;
  }

  async #performEnterFocus(request: EnterFocusRequest): Promise<FocusSnapshot> {
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
    const reaside = valid.reaside ?? true;

    // REC-004: the first focus on this device also needs the native agent dialog. The
    // dashboard's `consent` field is shown to the user but can never satisfy this gate.
    const consent = await this.#consent.ensure({
      durationMin: valid.durationMin,
      allowList,
      protectedApps: this.#protectedEntries,
      reaside,
    });
    if (!consent.granted) {
      throw new FocusRejectedError(
        'CONSENT_REQUIRED',
        'Allow Focus Mode to move other apps aside in the Focus Agent window, then try again.',
      );
    }

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
      reaside,
      timer: undefined,
    };
    this.#machine.markFocusing();
    this.#armTimer(this.#active);
    if (reaside) this.#enforcement?.start();
    this.#emit({
      type: 'focusStarted',
      sessionId: updatedEntry.sessionId,
      at: updatedEntry.startedAt,
      endsAt: updatedEntry.endsAt,
      plannedMinutes: updatedEntry.plannedMinutes,
      source,
      ...(valid.scheduleRunId === undefined ? {} : { scheduleRunId: valid.scheduleRunId }),
    });
    return this.getState();
  }

  /**
   * Idempotent restore. Called by the dashboard (authed socket, W2), the tray, timer expiry,
   * sleep reconcile (W3), crash recovery and quit. A second call while FOCUSING joins the
   * first restore instead of restoring twice.
   */
  exitFocus(reason: EndReason = 'USER'): Promise<FocusEndedEvent | null> {
    return this.#exitOnce(reason);
  }

  /** Single restore path for every trigger, so sleep reconcile and a timer end cannot double-run. */
  #exitOnce(reason: EndReason, override: ExitOverride = {}): Promise<FocusEndedEvent | null> {
    if (this.#exitInFlight !== undefined) return this.#exitInFlight;
    if (this.#active === undefined) return Promise.resolve(null);
    const run = this.#performExit(reason, override).finally(() => {
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

    // Honest accounting (FR-028): a crash means we only know the process died somewhere between
    // `startedAt` and `endsAt`; never count days of downtime as focus minutes.
    const startedAtMs = new Date(entry.startedAt).getTime();
    const endsAtMs = new Date(entry.endsAt).getTime();
    const now = this.#now();
    const actualMinutes = roundMinutes((Math.min(now.getTime(), endsAtMs) - startedAtMs) / 60_000);
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
        at: now.toISOString(),
        reason: 'CRASH_RECOVERY',
        actualMinutes,
        // The session only completed if the process was restored after its deadline.
        status: now.getTime() >= endsAtMs ? 'COMPLETED' : 'CANCELLED',
      });
    } else {
      this.#logger.error(
        'Crash-recovery restore failed; keeping the journal so the next start retries',
      );
    }
    return { sessionId: entry.sessionId, actualMinutes, restored };
  }

  /** Cancels a pending timer and the enforcement loop (tests and shutdown); never touches windows. */
  dispose(): void {
    const active = this.#active;
    if (active !== undefined) this.#clearActiveTimer(active);
    void this.#enforcement?.stop();
  }

  async #performExit(
    reason: EndReason,
    override: ExitOverride = {},
  ): Promise<FocusEndedEvent | null> {
    const active = this.#active;
    if (active === undefined) return null;

    this.#clearActiveTimer(active);
    // Stop (and await) the enforcement loop before restoring so no late aside can hide a window
    // after the session ended (INV-5).
    await this.#enforcement?.stop();

    // Restore exactly what the journal says this session changed. The enforcement loop may have
    // extended it after `#active.entry` was captured, so the journal is the authority (INV-4).
    const journaled = this.#journal.read();
    const entry =
      journaled !== null && journaled.sessionId === active.entry.sessionId
        ? journaled
        : active.entry;

    try {
      await this.#driver.restore(this.#planFor(entry));
    } catch (error) {
      // Restore failed: focus is still applied, so keep re-asiding newly opened apps too.
      if (active.reaside) this.#enforcement?.start();
      throw error;
    }

    try {
      this.#journal.clear();
    } catch (error) {
      this.#logger.error('Could not clear the focus journal after restore', error);
    }

    this.#active = undefined;
    this.#machine.markFocusEnded();
    const now = this.#now();
    const ended: FocusEndedEvent = {
      sessionId: entry.sessionId,
      at: now.toISOString(),
      reason,
      actualMinutes: roundMinutes(
        (override.actualMinutesMs ?? now.getTime() - active.startedAtMs) / 60_000,
      ),
      status: override.status ?? (reason === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED'),
    };
    this.#emit({ type: 'focusEnded', ...ended });
    return ended;
  }

  #clearActiveTimer(active: ActiveSession): void {
    if (active.timer !== undefined) {
      this.#clearTimer(active.timer);
      active.timer = undefined;
    }
  }

  /**
   * Absolute `endsAt` deadline, chunked below Node's 2^31−1 ms timer ceiling (TECHNICAL_DESIGN
   * §7.3): a long session re-arms until the wall clock really passed `endsAt`, so the end never
   * depends on one timer's maximum delay.
   */
  #armTimer(active: ActiveSession): void {
    const delayMs = Math.min(
      Math.max(0, active.endsAtMs - this.#now().getTime()),
      this.#maxTimerDelayMs,
    );
    active.timer = this.#setTimer(() => {
      if (this.#now().getTime() < active.endsAtMs) {
        this.#armTimer(active);
        return;
      }
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
