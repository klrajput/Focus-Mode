// cloud/reporting.test.ts — agent → cloud session reports (T-069, REC-006, FR-027).
// `clientSessionId` is the idempotency key, so the tests here are mostly about *not* sending:
// a duplicate lifecycle callback, a conflicting payload, or a queued report flushed twice must
// never produce a second frame. Payload assertions list every key, which is exactly what the
// strict shared schema enforces on the wire.

import { describe, expect, it, vi } from 'vitest';
import type { CloudMessage, SessionEndedMessage, SessionStartedMessage } from '@focus-mode/shared';
import type { Logger } from '../log.js';
import { MAX_QUEUED_REPORTS, SessionReporter, type SessionReportTransport } from './reporting.js';

const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';
const OTHER_SESSION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const RUN_ID = '507f1f77bcf86cd799439014';
const STARTED_AT = '2026-11-10T10:05:00.000Z';
const ENDED_AT = '2026-11-10T11:05:00.000Z';

type LogFn = (message: string, ...meta: readonly unknown[]) => void;

function quietLogger(): Logger {
  return {
    error: vi.fn<LogFn>(),
    warn: vi.fn<LogFn>(),
    info: vi.fn<LogFn>(),
    debug: vi.fn<LogFn>(),
  };
}

/** Records messages and can pretend the cloud link is down (`online = false`). */
class RecordingTransport implements SessionReportTransport {
  readonly sent: CloudMessage[] = [];
  online = true;

  send(message: CloudMessage): boolean {
    if (!this.online) return false;
    this.sent.push(message);
    return true;
  }
}

function makeReporter(options: { online?: boolean; maxQueued?: number } = {}): {
  reporter: SessionReporter;
  transport: RecordingTransport;
  logger: Logger;
} {
  const transport = new RecordingTransport();
  transport.online = options.online ?? true;
  const logger = quietLogger();
  const reporter = new SessionReporter({
    transport,
    logger,
    ...(options.maxQueued === undefined ? {} : { maxQueued: options.maxQueued }),
  });
  return { reporter, transport, logger };
}

function startedReport(overrides: Partial<Parameters<SessionReporter['reportStarted']>[0]> = {}) {
  return {
    clientSessionId: SESSION_ID,
    startedAt: STARTED_AT,
    plannedMinutes: 25,
    source: 'MANUAL' as const,
    ...overrides,
  };
}

describe('session.started (REC-006, T-069)', () => {
  it('sends the frozen payload for a manual session', () => {
    const { reporter, transport } = makeReporter();
    expect(reporter.reportStarted(startedReport())).toBe('sent');

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toEqual({
      v: 1,
      id: expect.any(String) as unknown as string,
      type: 'session.started',
      clientSessionId: SESSION_ID,
      startedAt: STARTED_AT,
      plannedMinutes: 25,
      source: 'MANUAL',
    });
    const message = transport.sent[0] as SessionStartedMessage;
    expect(Object.keys(message).sort()).toEqual([
      'clientSessionId',
      'id',
      'plannedMinutes',
      'source',
      'startedAt',
      'type',
      'v',
    ]);
  });

  it('adds scheduleRunId for a session started by the scheduler (DEC-021)', () => {
    const { reporter, transport } = makeReporter();
    expect(
      reporter.reportStarted(startedReport({ source: 'SCHEDULE', scheduleRunId: RUN_ID })),
    ).toBe('sent');

    const message = transport.sent[0] as SessionStartedMessage & { scheduleRunId?: string };
    expect(message).toMatchObject({
      type: 'session.started',
      source: 'SCHEDULE',
      scheduleRunId: RUN_ID,
    });
    // The run link is additive: the MANUAL shape above is unchanged (backward compatible).
    expect(Object.keys(message).sort()).toEqual([
      'clientSessionId',
      'id',
      'plannedMinutes',
      'scheduleRunId',
      'source',
      'startedAt',
      'type',
      'v',
    ]);
  });

  it('never sends the same session twice (duplicate lifecycle callback)', () => {
    const { reporter, transport } = makeReporter();
    expect(reporter.reportStarted(startedReport())).toBe('sent');
    expect(reporter.reportStarted(startedReport())).toBe('duplicate');
    expect(reporter.reportStarted(startedReport())).toBe('duplicate');
    expect(transport.sent).toHaveLength(1);
  });

  it('ignores a conflicting payload for an already-reported session key and logs it', () => {
    const { reporter, transport, logger } = makeReporter();
    reporter.reportStarted(startedReport());
    expect(reporter.reportStarted(startedReport({ plannedMinutes: 60 }))).toBe('duplicate');
    expect(transport.sent).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('conflicting duplicate'),
      expect.anything(),
    );
  });

  it('treats the same clientSessionId as distinct per report type', () => {
    const { reporter, transport } = makeReporter();
    reporter.reportStarted(startedReport());
    reporter.reportEnded({
      clientSessionId: SESSION_ID,
      endedAt: ENDED_AT,
      actualMinutes: 60,
      status: 'COMPLETED',
      endReason: 'COMPLETED',
    });
    expect(transport.sent.map((message) => message.type)).toEqual([
      'session.started',
      'session.ended',
    ]);
  });
});

describe('session.ended (REC-006, FR-027)', () => {
  it('sends the frozen payload for a completed session', () => {
    const { reporter, transport } = makeReporter();
    expect(
      reporter.reportEnded({
        clientSessionId: SESSION_ID,
        endedAt: ENDED_AT,
        actualMinutes: 60,
        status: 'COMPLETED',
        endReason: 'COMPLETED',
      }),
    ).toBe('sent');

    const message = transport.sent[0] as SessionEndedMessage;
    expect(message).toEqual({
      v: 1,
      id: expect.any(String) as unknown as string,
      type: 'session.ended',
      clientSessionId: SESSION_ID,
      endedAt: ENDED_AT,
      actualMinutes: 60,
      status: 'COMPLETED',
      endReason: 'COMPLETED',
    });
  });

  it('covers a user-ended session and reports CANCELLED honestly', () => {
    const { reporter, transport } = makeReporter();
    reporter.reportEnded({
      clientSessionId: SESSION_ID,
      endedAt: ENDED_AT,
      actualMinutes: 12.5,
      status: 'CANCELLED',
      endReason: 'USER',
    });
    expect(transport.sent[0]).toMatchObject({
      status: 'CANCELLED',
      endReason: 'USER',
      actualMinutes: 12.5,
    });
  });

  it('is idempotent: a repeated ended report is dropped', () => {
    const { reporter, transport } = makeReporter();
    const report = {
      clientSessionId: SESSION_ID,
      endedAt: ENDED_AT,
      actualMinutes: 60,
      status: 'COMPLETED' as const,
      endReason: 'COMPLETED' as const,
    };
    expect(reporter.reportEnded(report)).toBe('sent');
    expect(reporter.reportEnded(report)).toBe('duplicate');
    expect(transport.sent).toHaveLength(1);
  });
});

describe('offline queue (a short disconnect must not lose the session report)', () => {
  it('queues while the link is down and sends exactly once after it reopens', () => {
    const { reporter, transport } = makeReporter({ online: false });
    expect(reporter.reportStarted(startedReport())).toBe('queued');
    expect(reporter.queued).toBe(1);
    expect(transport.sent).toHaveLength(0);

    // Still down: flush keeps it queued and does not duplicate anything.
    expect(reporter.flush()).toBe(0);
    expect(reporter.queued).toBe(1);

    transport.online = true;
    expect(reporter.flush()).toBe(1);
    expect(reporter.queued).toBe(0);
    expect(transport.sent).toHaveLength(1);

    // A second flush (e.g. a reconnect storm) sends nothing at all.
    expect(reporter.flush()).toBe(0);
    expect(transport.sent).toHaveLength(1);
  });

  it('flushes started + ended in order for the same session', () => {
    const { reporter, transport } = makeReporter({ online: false });
    reporter.reportStarted(startedReport());
    reporter.reportEnded({
      clientSessionId: SESSION_ID,
      endedAt: ENDED_AT,
      actualMinutes: 30,
      status: 'CANCELLED',
      endReason: 'SLEEP',
    });
    expect(reporter.queued).toBe(2);

    transport.online = true;
    expect(reporter.flush()).toBe(2);
    expect(transport.sent.map((message) => message.type)).toEqual([
      'session.started',
      'session.ended',
    ]);
  });

  it('does not re-queue a report that the transport accepted', () => {
    const { reporter, transport } = makeReporter();
    reporter.reportStarted(startedReport({ clientSessionId: OTHER_SESSION_ID }));
    expect(reporter.queued).toBe(0);
    expect(reporter.flush()).toBe(0);
    expect(transport.sent).toHaveLength(1);
  });

  it('drops the oldest queued report when the queue is full, with a warning', () => {
    const { reporter, transport, logger } = makeReporter({ online: false, maxQueued: 1 });
    reporter.reportStarted(startedReport({ clientSessionId: SESSION_ID }));
    reporter.reportStarted(startedReport({ clientSessionId: OTHER_SESSION_ID }));

    expect(reporter.queued).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('queue is full'),
      expect.anything(),
    );

    transport.online = true;
    reporter.flush();
    expect(transport.sent).toHaveLength(1);
    expect((transport.sent[0] as SessionStartedMessage).clientSessionId).toBe(OTHER_SESSION_ID);
    expect(MAX_QUEUED_REPORTS).toBeGreaterThan(1);
  });
});
