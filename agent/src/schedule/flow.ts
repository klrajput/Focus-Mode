// schedule/flow.ts — the scheduled-session flow behind `scheduleDue` (T-064, DEC-021, FR-012).
// cloud `scheduleDue` → local ≥10 s cancellable heads-up → (cancel | window elapsed) →
// `GET /agent/allowlist` → `controller.enterFocus({source:'SCHEDULE', …})`. Cancel sends the
// agent→cloud `scheduleRunCancelled {runId, at}` and never touches focus. Every failure is logged
// with a reason and applies NO focus (never a fake session): unpaired, cloud unreachable,
// unsupported window control, refused/consent-declined start.
// The `session.started` report is NOT sent here: the controller lifecycle is the single reporting
// path (main wires it), which keeps MANUAL and SCHEDULE reports identical and duplicate-free.

import {
  focusSourceSchema,
  scheduleRunCancelledMessageSchema,
  type AgentCapabilities,
  type CloudMessage,
  type ScheduleDueMessage,
} from '@focus-mode/shared';
import { randomUUID } from 'node:crypto';
import { fetchAgentAllowList, type AllowListFetchResult } from '../cloud/allowlist.js';
import { nextCloudMessageId } from '../cloud/message-id.js';
import { FocusRejectedError, type EnterFocusRequest, type FocusSnapshot } from '../focus/controller.js';
import { noopLogger, type Logger } from '../log.js';
import { ScheduleHeadsUp, type AnnounceOutcome, type PendingRun } from './heads-up.js';

/**
 * Consent record attached to a scheduled `enterFocus` (FR-009 shape). The user consented to the
 * schedule when they created it; REC-004's native dialog is still enforced inside the controller
 * for the first focus on this device, so this record can never bypass the agent-native gate.
 */
export const SCHEDULE_CONSENT_VERSION = 'schedule-v1';

export type CancelOutcome =
  /** The pending heads-up was cancelled and `scheduleRunCancelled` was sent. */
  | 'CANCELLED'
  /** Nothing was pending (window already elapsed, cancelled twice, or never announced). */
  | 'NOTHING_PENDING';

/** Why a run could not start; always logged and surfaced, never silently swallowed. */
export type ScheduleFailureReason =
  | 'NOT_PAIRED'
  | 'UNSUPPORTED'
  | 'ALLOWLIST_UNAVAILABLE'
  | 'REJECTED'
  | 'ALREADY_FOCUSING';

export interface ScheduleFlowOptions {
  /** Full API base including `/api/v1` (DEC-013). */
  readonly baseUrl: string;
  /** The cancellable window (FR-012 ≥10 s; `AGENT_SCHEDULE_HEADSUP_MS`, tests inject short). */
  readonly headsUpMs: number;
  /** Device token for the allow-list fetch; null while unpaired → no session is ever started. */
  readonly getDeviceToken: () => string | null;
  readonly getCapabilities: () => AgentCapabilities;
  readonly isFocusing: () => boolean;
  readonly enterFocus: (request: EnterFocusRequest) => Promise<FocusSnapshot>;
  /** Cloud transport (`CloudClient.sendCloudMessage`); returns false while offline. */
  readonly sendCloud: (message: CloudMessage) => boolean;
  /** UUID for the scheduled session; injectable so tests get a stable `clientSessionId`. */
  readonly uuid?: () => string;
  readonly now?: () => Date;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly logger?: Logger;
  /** Heads-up became visible: native notification + tray/window refresh + local frame. */
  readonly onHeadsUp?: (pending: PendingRun) => void;
  /** The session is running: the controller has already journalled it (INV-4) and reported it. */
  readonly onStarted?: (pending: PendingRun, sessionId: string) => void;
  /** The user cancelled: the cloud has been told (or the send failed and is logged). */
  readonly onCancelled?: (pending: PendingRun, at: string) => void;
  /** The run did not start; `reason` is user-safe, `detail` is for the log. */
  readonly onFailed?: (
    pending: PendingRun,
    reason: ScheduleFailureReason,
    detail: string,
  ) => void;
}

/**
 * One scheduled run at a time. The flow owns no Electron and no sockets: everything it needs is
 * injected, so the cancel/timeout/failure matrix runs in plain Node against the FakeDriver.
 */
export class ScheduleFlow {
  readonly #options: ScheduleFlowOptions;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #uuid: () => string;
  readonly #headsUp: ScheduleHeadsUp;
  /** Set while a start attempt is applying focus; a second due is ignored meanwhile. */
  #starting: PendingRun | undefined;

  constructor(options: ScheduleFlowOptions) {
    this.#options = options;
    this.#logger = options.logger ?? noopLogger;
    this.#now = options.now ?? (() => new Date());
    this.#uuid = options.uuid ?? (() => randomUUID());
    this.#headsUp = new ScheduleHeadsUp({
      headsUpMs: options.headsUpMs,
      now: this.#now,
      ...(options.setTimer === undefined ? {} : { setTimer: options.setTimer }),
      ...(options.clearTimer === undefined ? {} : { clearTimer: options.clearTimer }),
      logger: this.#logger,
      onHeadsUp: (pending) => options.onHeadsUp?.(pending),
      onWindowElapsed: (pending) => {
        void this.#start(pending);
      },
    });
  }

  /** The run in its heads-up window (tray/window view-model source). */
  pending(): PendingRun | null {
    return this.#headsUp.pending();
  }

  /** Milliseconds left in the heads-up window, or null. */
  remainingMs(): number | null {
    return this.#headsUp.remainingMs();
  }

  /**
   * Handles one cloud `scheduleDue`. Announces a heads-up unless the agent is FOCUSING, a start is
   * already applying focus, or another run is pending — in those cases nothing starts and the
   * server's reaper records the run as MISSED (never force a start, INV-2/FR-012).
   */
  handleScheduleDue(message: ScheduleDueMessage): AnnounceOutcome | 'IGNORED_FOCUSING' | 'IGNORED_STARTING' {
    if (this.#options.isFocusing()) {
      this.#logger.warn('Ignored scheduleDue while a focus session is already running', {
        runId: message.runId,
      });
      return 'IGNORED_FOCUSING';
    }
    if (this.#starting !== undefined) {
      this.#logger.warn('Ignored scheduleDue while another scheduled run is starting', {
        runId: message.runId,
        startingRunId: this.#starting.runId,
      });
      return 'IGNORED_STARTING';
    }
    return this.#headsUp.announce(message);
  }

  /**
   * User cancelled the heads-up (window button or tray). Sends `scheduleRunCancelled {runId, at}`
   * and applies no focus. A cancel after the window elapsed returns `NOTHING_PENDING` and sends
   * nothing, so the cloud never sees a cancel for a run that may already have started.
   */
  cancel(): CancelOutcome {
    const pending = this.#headsUp.cancel();
    if (pending === null) {
      this.#logger.info('Cancel requested but no scheduled run is in its heads-up window');
      return 'NOTHING_PENDING';
    }

    const at = this.#now().toISOString();
    const message = scheduleRunCancelledMessageSchema.parse({
      v: 1,
      id: nextCloudMessageId(),
      type: 'scheduleRunCancelled',
      runId: pending.runId,
      at,
    });
    const sent = this.#options.sendCloud(message);
    if (!sent) {
      // Honest: the local cancel stands (no focus), but the cloud may still record the run as
      // MISSED instead of CANCELLED_BY_USER because the report could not be delivered.
      this.#logger.warn(
        'Scheduled run cancelled locally but the cloud link is down; ' +
          'the cloud will record this run as MISSED, not CANCELLED_BY_USER',
        { runId: pending.runId },
      );
    } else {
      this.#logger.info('Reported the scheduled-run cancellation to the cloud', {
        runId: pending.runId,
        at,
      });
    }
    this.#options.onCancelled?.(pending, at);
    return 'CANCELLED';
  }

  /** Quit/shutdown: drop the heads-up timer. A pending run is left to the cloud reaper (MISSED). */
  dispose(): void {
    this.#headsUp.dispose();
  }

  // -------------------------------------------------------------------------
  // Start path (inside the flow only)
  // -------------------------------------------------------------------------

  async #start(pending: PendingRun): Promise<void> {
    this.#starting = pending;
    try {
      await this.#attemptStart(pending);
    } finally {
      this.#starting = undefined;
    }
  }

  async #attemptStart(pending: PendingRun): Promise<'STARTED' | 'FAILED'> {
    // 1. Never start unpaired: there is no device token to fetch the allow-list with (and no
    //    honest way to report the session).
    const deviceToken = this.#options.getDeviceToken();
    if (deviceToken === null) {
      return this.#fail(pending, 'NOT_PAIRED', 'the Focus Agent is not paired with the cloud');
    }

    // 2. Never start when window control is unsupported (FR-005) — the dashboard cannot either.
    const capabilities = this.#options.getCapabilities();
    if (capabilities.focus === 'unsupported') {
      return this.#fail(
        pending,
        'UNSUPPORTED',
        capabilities.reasons?.[0] ?? 'window control is unsupported on this system',
      );
    }

    // 3. The user's current allow-list (C-20). Unavailable → no focus, logged reason (DEC-021).
    const fetched: AllowListFetchResult = await fetchAgentAllowList({
      baseUrl: this.#options.baseUrl,
      deviceToken,
      ...(this.#options.fetchImpl === undefined ? {} : { fetchImpl: this.#options.fetchImpl }),
      ...(this.#options.timeoutMs === undefined ? {} : { timeoutMs: this.#options.timeoutMs }),
      logger: this.#logger,
    });
    if (!fetched.ok) {
      return this.#fail(
        pending,
        'ALLOWLIST_UNAVAILABLE',
        `could not fetch the allow-list: ${fetched.reason}`,
      );
    }
    if (fetched.allowList.version !== pending.allowListVersion) {
      // Not fatal: use the list the cloud just returned, which is the freshest truth.
      this.#logger.info('Scheduled run allow-list version differs from the announcement', {
        runId: pending.runId,
        dispatchedVersion: pending.allowListVersion,
        fetchedVersion: fetched.allowList.version,
      });
    }

    // 4. Apply focus through the ONE interface, with the SCHEDULE source and the run id so the
    //    lifecycle report links the session to the run (REC-004 consent gate still applies).
    const clientSessionId = this.#uuid();
    const request: EnterFocusRequest = {
      durationMin: pending.durationMin,
      allowList: fetched.allowList.userApps,
      clientSessionId,
      source: focusSourceSchema.parse('SCHEDULE'),
      reaside: true,
      consent: { acceptedAt: pending.announcedAt, version: SCHEDULE_CONSENT_VERSION },
      scheduleRunId: pending.runId,
    };

    try {
      await this.#options.enterFocus(request);
    } catch (error) {
      if (error instanceof FocusRejectedError) {
        if (error.code === 'ALREADY_FOCUSING') {
          return this.#fail(pending, 'ALREADY_FOCUSING', error.message);
        }
        return this.#fail(pending, 'REJECTED', `${error.code}: ${error.message}`);
      }
      return this.#fail(
        pending,
        'REJECTED',
        error instanceof Error ? error.message : 'the focus request failed',
      );
    }

    this.#logger.info('Scheduled focus session started', {
      runId: pending.runId,
      clientSessionId,
      durationMin: pending.durationMin,
      allowListApps: fetched.allowList.userApps.length,
    });
    this.#options.onStarted?.(pending, clientSessionId);
    return 'STARTED';
  }

  #fail(pending: PendingRun, reason: ScheduleFailureReason, detail: string): 'FAILED' {
    this.#logger.error('Scheduled session did not start; no focus was applied', {
      runId: pending.runId,
      scheduleId: pending.scheduleId,
      reason,
      detail,
    });
    this.#options.onFailed?.(pending, reason, detail);
    return 'FAILED';
  }
}
