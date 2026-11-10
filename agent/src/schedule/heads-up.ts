// schedule/heads-up.ts — the local ≥10 s cancellable heads-up before a scheduled session
// (T-064, FR-012, DEC-021 step 3). `scheduleDue` only *announces* a run (INV-2): it becomes a
// pending heads-up here, the user can cancel it, and only when the window elapses (or the user
// accepts) does the flow try to start focus. Pure timers + injected clock, so the cancel/timeout
// matrix is unit-tested without Electron or a display.

import type { ScheduleDueMessage } from '@focus-mode/shared';
import { noopLogger, type Logger } from '../log.js';

/** One announced run, as shown in the tray/window during the heads-up. */
export interface PendingRun {
  readonly runId: string;
  readonly scheduleId: string;
  readonly durationMin: number;
  readonly allowListVersion: number;
  /** When `scheduleDue` arrived (ISO), i.e. when the heads-up was shown. */
  readonly announcedAt: string;
  /** When the session will start if not cancelled (ISO) — announcedAt + heads-up window. */
  readonly startsAt: string;
}

export type AnnounceOutcome =
  /** The run is now pending and the heads-up is visible. */
  | 'PENDING'
  /** The same run was already announced; ignored (idempotent per runId). */
  | 'DUPLICATE'
  /** Another run's heads-up is already pending; this one is ignored (one heads-up at a time). */
  | 'BUSY'
  /** The window is too short/long or the run id is unusable; nothing was shown. */
  | 'INVALID';

export interface ScheduleHeadsUpOptions {
  /**
   * The cancellable window in milliseconds. Production is `AGENT_SCHEDULE_HEADSUP_MS` (≥10 000,
   * FR-012); tests inject a few milliseconds to exercise the timeout path deterministically.
   */
  readonly headsUpMs: number;
  readonly now?: () => Date;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  readonly logger?: Logger;
  /** Called once when the heads-up becomes visible (native notification / tray / local frame). */
  readonly onHeadsUp?: (pending: PendingRun) => void;
  /** Called when the window elapsed without a cancel: the caller may now try to start focus. */
  readonly onWindowElapsed: (pending: PendingRun) => void;
}

/**
 * Owns exactly one pending heads-up. It deliberately does not import the cloud client or the
 * controller: the flow composes it, which keeps the timer/cancel semantics testable in isolation.
 */
export class ScheduleHeadsUp {
  readonly #options: ScheduleHeadsUpOptions;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly #clearTimer: (handle: ReturnType<typeof setTimeout>) => void;

  #pending: PendingRun | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;

  constructor(options: ScheduleHeadsUpOptions) {
    if (!Number.isFinite(options.headsUpMs) || options.headsUpMs <= 0) {
      throw new Error('ScheduleHeadsUp needs a positive heads-up window');
    }
    this.#options = options;
    this.#logger = options.logger ?? noopLogger;
    this.#now = options.now ?? (() => new Date());
    this.#setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  /** The run currently waiting for its window to elapse (or being started); null otherwise. */
  pending(): PendingRun | null {
    return this.#pending ?? null;
  }

  /** Milliseconds left in the window; null when nothing is pending. */
  remainingMs(): number | null {
    if (this.#pending === undefined) return null;
    const startMs = new Date(this.#pending.startsAt).getTime();
    return Math.max(0, startMs - this.#now().getTime());
  }

  /** Shows a heads-up for a due run. Idempotent per `runId`; never starts focus by itself. */
  announce(due: ScheduleDueMessage): AnnounceOutcome {
    if (this.#disposed) return 'INVALID';
    const current = this.#pending;
    if (current !== undefined) {
      if (current.runId === due.runId) {
        this.#logger.info('Ignored a repeated scheduleDue for the pending run', {
          runId: due.runId,
        });
        return 'DUPLICATE';
      }
      this.#logger.warn(
        'Ignored a scheduleDue while another run is in its heads-up (one heads-up at a time)',
        { runId: due.runId, pendingRunId: current.runId },
      );
      return 'BUSY';
    }

    const announcedAt = this.#now();
    const startsAt = new Date(announcedAt.getTime() + this.#options.headsUpMs);
    const pending: PendingRun = {
      runId: due.runId,
      scheduleId: due.scheduleId,
      durationMin: due.durationMin,
      allowListVersion: due.allowListVersion,
      announcedAt: announcedAt.toISOString(),
      startsAt: startsAt.toISOString(),
    };

    this.#pending = pending;
    this.#timer = this.#setTimer(() => {
      this.#timer = undefined;
      // Clear before handing over: from here on a cancel is too late and must not race the start.
      if (this.#pending !== pending) return;
      this.#pending = undefined;
      this.#options.onWindowElapsed(pending);
    }, this.#options.headsUpMs);

    this.#logger.info('Scheduled run announced; showing the cancellable heads-up', {
      runId: pending.runId,
      scheduleId: pending.scheduleId,
      durationMin: pending.durationMin,
      headsUpMs: this.#options.headsUpMs,
      startsAt: pending.startsAt,
    });
    this.#options.onHeadsUp?.(pending);
    return 'PENDING';
  }

  /**
   * Cancels the pending heads-up. Returns the run that was cancelled, or null when nothing was
   * pending (already elapsed, cancelled twice, or never announced) — the caller then sends no
   * cloud message, so a cancel can never refer to a run that is not ours.
   */
  cancel(): PendingRun | null {
    const pending = this.#pending;
    if (pending === undefined) return null;
    if (this.#timer !== undefined) {
      this.#clearTimer(this.#timer);
      this.#timer = undefined;
    }
    this.#pending = undefined;
    this.#logger.info('Scheduled run cancelled during the heads-up; no focus will be applied', {
      runId: pending.runId,
    });
    return pending;
  }

  /** Drops the pending heads-up without cancelling anything on the cloud (quit/shutdown). */
  dispose(): void {
    this.#disposed = true;
    if (this.#timer !== undefined) {
      this.#clearTimer(this.#timer);
      this.#timer = undefined;
    }
    this.#pending = undefined;
  }
}
