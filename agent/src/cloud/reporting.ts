// cloud/reporting.ts — agent → cloud session reports (T-069, REC-006, FR-027).
// The FocusController's lifecycle is the single source of truth: one `session.started` per
// `focusStarted` and one `session.ended` per `focusEnded`, for MANUAL **and** SCHEDULE sessions.
// That is what persists a session when the dashboard tab was closed (dashboard POST never runs).
// REC-006: `clientSessionId` is the idempotency key, so a duplicate report must be impossible from
// this side too — every message is built with the frozen strict schema, de-duplicated on
// `type:clientSessionId`, and never sent twice for the same key.
// If the cloud link is down the message is queued (bounded) and flushed on the next `open`, so a
// short disconnect cannot swallow the report; the server upsert also tolerates a late duplicate.

import {
  sessionEndedMessageSchema,
  sessionStartedMessageSchema,
  type CloudMessage,
  type EndReason,
  type FocusSource,
  type SessionEndedMessage,
  type SessionStartedMessage,
} from '@focus-mode/shared';
import type { FocusLifecycleEvent } from '../focus/controller.js';
import { noopLogger, type Logger } from '../log.js';
import { nextCloudMessageId } from './message-id.js';

/** Maximum reports held while the cloud link is down; older ones are dropped with a warning. */
export const MAX_QUEUED_REPORTS = 16;

/** The transport is the cloud socket; `false` means "not connected, keep it queued". */
export interface SessionReportTransport {
  send(message: CloudMessage): boolean;
}

export interface SessionStartedReport {
  readonly clientSessionId: string;
  readonly startedAt: string;
  readonly plannedMinutes: number;
  readonly source: FocusSource;
  /** DEC-021: present only for a session started from `scheduleDue`; links the run. */
  readonly scheduleRunId?: string;
}

export interface SessionEndedReport {
  readonly clientSessionId: string;
  readonly endedAt: string;
  readonly actualMinutes: number;
  readonly status: 'COMPLETED' | 'CANCELLED';
  readonly endReason: EndReason;
}

/** What happened to one report; `duplicate` is a normal, expected outcome (REC-006). */
export type ReportOutcome = 'sent' | 'queued' | 'duplicate';

export interface SessionReporterOptions {
  readonly transport: SessionReportTransport;
  readonly logger?: Logger;
  readonly maxQueued?: number;
}

function reportKey(message: CloudMessage): string {
  switch (message.type) {
    case 'session.started':
      return `session.started:${message.clientSessionId}`;
    case 'session.ended':
      return `session.ended:${message.clientSessionId}`;
    default:
      // Only session reports flow through here; anything else is a programming error.
      return `${message.type}:unknown`;
  }
}

/**
 * Builds and sends the two session reports. Stateless with respect to focus: it never changes
 * agent state, so it can be wired straight to the controller lifecycle with no ordering risk.
 */
export class SessionReporter {
  readonly #transport: SessionReportTransport;
  readonly #logger: Logger;
  readonly #maxQueued: number;
  /** Key → canonical JSON of the payload already accepted for sending (dedupe + conflict detect). */
  readonly #seen = new Map<string, string>();
  readonly #queue: CloudMessage[] = [];

  constructor(options: SessionReporterOptions) {
    this.#transport = options.transport;
    this.#logger = options.logger ?? noopLogger;
    this.#maxQueued = options.maxQueued ?? MAX_QUEUED_REPORTS;
  }

  /** Number of reports waiting for the cloud link to reopen (exposed for tests/status). */
  get queued(): number {
    return this.#queue.length;
  }

  reportStarted(report: SessionStartedReport): ReportOutcome {
    const message = sessionStartedMessageSchema.parse({
      v: 1,
      id: nextCloudMessageId(),
      type: 'session.started',
      clientSessionId: report.clientSessionId,
      startedAt: report.startedAt,
      plannedMinutes: report.plannedMinutes,
      source: report.source,
      ...(report.scheduleRunId === undefined ? {} : { scheduleRunId: report.scheduleRunId }),
    } satisfies SessionStartedMessage);
    return this.#deliver(message, 'started');
  }

  reportEnded(report: SessionEndedReport): ReportOutcome {
    const message = sessionEndedMessageSchema.parse({
      v: 1,
      id: nextCloudMessageId(),
      type: 'session.ended',
      clientSessionId: report.clientSessionId,
      endedAt: report.endedAt,
      actualMinutes: report.actualMinutes,
      status: report.status,
      endReason: report.endReason,
    } satisfies SessionEndedMessage);
    return this.#deliver(message, 'ended');
  }

  /** Called when the cloud link (re)opens: sends everything that was queued while it was down. */
  flush(): number {
    if (this.#queue.length === 0) return 0;
    let sent = 0;
    // Copy first: `send` may synchronously trigger a reconnect/close in a hostile test double.
    for (const message of [...this.#queue]) {
      if (!this.#transport.send(message)) break;
      this.#queue.splice(this.#queue.indexOf(message), 1);
      sent += 1;
    }
    if (sent > 0) this.#logger.info('Flushed queued session reports to the cloud', { sent });
    return sent;
  }

  #deliver(message: CloudMessage, kind: 'started' | 'ended'): ReportOutcome {
    const key = reportKey(message);
    // The envelope id is unique per send, so it never takes part in the identity comparison.
    const canonical = JSON.stringify({ ...message, id: '' });
    const previous = this.#seen.get(key);
    if (previous !== undefined) {
      if (previous !== canonical) {
        // Two different payloads for one idempotency key would be a 409 at the server; keep the
        // first one (the session that actually ran) and record the conflict loudly.
        this.#logger.error('Ignored a conflicting duplicate session report (REC-006)', { key });
      }
      this.#logger.debug('Skipped a duplicate session report (REC-006)', { key });
      return 'duplicate';
    }

    this.#seen.set(key, canonical);
    if (this.#transport.send(message)) return 'sent';

    // Offline: keep it for the next `open` so a brief disconnect cannot lose the report.
    if (this.#queue.length >= this.#maxQueued) {
      const dropped = this.#queue.shift();
      this.#logger.warn('Session report queue is full; dropped the oldest report', {
        kind,
        dropped: dropped?.type ?? 'none',
      });
    }
    this.#queue.push(message);
    this.#logger.warn(`Cloud link is down; queued the session ${kind} report`, { key });
    return 'queued';
  }
}

/**
 * The ONE mapping from controller lifecycle to cloud reports (T-069). main.ts wires it to the
 * `FocusController`'s `onEvent`, and the integration test uses it with the FakeDriver, so the
 * payload mapping itself is exercised end-to-end instead of being re-implemented per caller.
 */
export function createLifecycleReporter(
  reporter: SessionReporter,
): (event: FocusLifecycleEvent) => void {
  return (event) => {
    if (event.type === 'focusStarted') {
      reporter.reportStarted({
        clientSessionId: event.sessionId,
        startedAt: event.at,
        plannedMinutes: event.plannedMinutes,
        source: event.source,
        ...(event.scheduleRunId === undefined ? {} : { scheduleRunId: event.scheduleRunId }),
      });
      return;
    }
    reporter.reportEnded({
      clientSessionId: event.sessionId,
      endedAt: event.at,
      actualMinutes: event.actualMinutes,
      status: event.status,
      endReason: event.reason,
    });
  };
}
