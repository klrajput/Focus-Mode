// schedule/heads-up.test.ts — the ≥10 s cancellable heads-up semantics (T-064, FR-012, DEC-021).
// Fake timers make the cancel/timeout matrix deterministic: the window is injected, so the suite
// never waits a real 10 seconds. The tests pin the two guarantees the user relies on — the
// heads-up is visible before anything happens, and cancelling inside the window means no start
// callback ever fires.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleDueMessage } from '@focus-mode/shared';
import type { Logger } from '../log.js';
import { ScheduleHeadsUp, type PendingRun } from './heads-up.js';

const RUN_ID = '507f1f77bcf86cd799439014';
const SCHEDULE_ID = '507f1f77bcf86cd799439013';
const NOW = new Date('2026-11-10T10:00:00.000Z');
const HEADS_UP_MS = 10_000;

type LogFn = (message: string, ...meta: readonly unknown[]) => void;

function quietLogger(): Logger {
  return {
    error: vi.fn<LogFn>(),
    warn: vi.fn<LogFn>(),
    info: vi.fn<LogFn>(),
    debug: vi.fn<LogFn>(),
  };
}

function due(overrides: Partial<ScheduleDueMessage> = {}): ScheduleDueMessage {
  return {
    v: 1,
    id: 'c-004',
    type: 'scheduleDue',
    runId: RUN_ID,
    scheduleId: SCHEDULE_ID,
    durationMin: 25,
    allowListVersion: 3,
    ...overrides,
  };
}

interface Harness {
  readonly headsUp: ScheduleHeadsUp;
  readonly shown: PendingRun[];
  readonly elapsed: PendingRun[];
  /** Moves the injected clock (fake timers do not move a fixed `now`). */
  readonly setNow: (date: Date) => void;
}

function makeHeadsUp(headsUpMs = HEADS_UP_MS): Harness {
  const shown: PendingRun[] = [];
  const elapsed: PendingRun[] = [];
  let clock = NOW;
  const headsUp = new ScheduleHeadsUp({
    headsUpMs,
    now: () => clock,
    logger: quietLogger(),
    onHeadsUp: (pending) => shown.push(pending),
    onWindowElapsed: (pending) => elapsed.push(pending),
  });
  return {
    headsUp,
    shown,
    elapsed,
    setNow: (date) => {
      clock = date;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('announce', () => {
  it('shows one heads-up with an absolute start time and starts nothing', () => {
    const { headsUp, shown, elapsed } = makeHeadsUp();
    expect(headsUp.announce(due())).toBe('PENDING');

    expect(shown).toHaveLength(1);
    expect(shown[0]).toEqual({
      runId: RUN_ID,
      scheduleId: SCHEDULE_ID,
      durationMin: 25,
      allowListVersion: 3,
      announcedAt: NOW.toISOString(),
      startsAt: '2026-11-10T10:00:10.000Z',
    });
    expect(headsUp.pending()).toEqual(shown[0]);
    // Nothing started yet: the window has not elapsed.
    expect(elapsed).toHaveLength(0);
  });

  it('ignores a repeated scheduleDue for the same run (idempotent per runId)', () => {
    const { headsUp, shown } = makeHeadsUp();
    headsUp.announce(due());
    expect(headsUp.announce(due())).toBe('DUPLICATE');
    expect(shown).toHaveLength(1);
  });

  it('refuses a second, different run while one is already pending (one heads-up at a time)', () => {
    const { headsUp, shown } = makeHeadsUp();
    headsUp.announce(due());
    expect(headsUp.announce(due({ runId: '507f1f77bcf86cd799439099' }))).toBe('BUSY');
    expect(shown).toHaveLength(1);
    expect(headsUp.pending()?.runId).toBe(RUN_ID);
  });

  it('rejects a non-positive window instead of silently starting without a heads-up', () => {
    expect(() => new ScheduleHeadsUp({ headsUpMs: 0, onWindowElapsed: () => undefined })).toThrow(
      /positive heads-up window/,
    );
    expect(
      () => new ScheduleHeadsUp({ headsUpMs: Number.NaN, onWindowElapsed: () => undefined }),
    ).toThrow(/positive/);
  });
});

describe('cancel inside the window', () => {
  it('clears the pending run and never fires the start callback', () => {
    const { headsUp, elapsed } = makeHeadsUp();
    headsUp.announce(due());

    expect(headsUp.cancel()).toMatchObject({ runId: RUN_ID });
    expect(headsUp.pending()).toBeNull();

    vi.advanceTimersByTime(HEADS_UP_MS * 3);
    expect(elapsed).toHaveLength(0);
  });

  it('refuses to cancel twice (one cancel, one cloud message)', () => {
    const { headsUp } = makeHeadsUp();
    headsUp.announce(due());
    expect(headsUp.cancel()).not.toBeNull();
    expect(headsUp.cancel()).toBeNull();
  });

  it('returns null when nothing was ever announced', () => {
    const { headsUp } = makeHeadsUp();
    expect(headsUp.cancel()).toBeNull();
  });
});

describe('window elapses', () => {
  it('hands the pending run to the start path exactly once', () => {
    const { headsUp, elapsed } = makeHeadsUp();
    headsUp.announce(due());

    vi.advanceTimersByTime(HEADS_UP_MS - 1);
    expect(elapsed).toHaveLength(0);
    expect(headsUp.pending()).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(elapsed).toHaveLength(1);
    expect(elapsed[0]?.runId).toBe(RUN_ID);
    // The window is closed: a late cancel must not race a start that is already applying focus.
    expect(headsUp.pending()).toBeNull();
    expect(headsUp.cancel()).toBeNull();

    vi.advanceTimersByTime(HEADS_UP_MS * 2);
    expect(elapsed).toHaveLength(1);
  });

  it('can announce a later run after the previous window elapsed', () => {
    const { headsUp, shown } = makeHeadsUp();
    headsUp.announce(due());
    vi.advanceTimersByTime(HEADS_UP_MS);
    expect(headsUp.announce(due({ runId: '507f1f77bcf86cd799439099' }))).toBe('PENDING');
    expect(shown).toHaveLength(2);
  });
});

describe('remaining time and dispose', () => {
  it('reports the remaining window from the absolute start time', () => {
    const { headsUp, setNow } = makeHeadsUp();
    expect(headsUp.remainingMs()).toBeNull();
    headsUp.announce(due());
    expect(headsUp.remainingMs()).toBe(HEADS_UP_MS);

    setNow(new Date(NOW.getTime() + 4_000));
    expect(headsUp.remainingMs()).toBe(6_000);

    // Past the deadline it clamps to zero rather than going negative.
    setNow(new Date(NOW.getTime() + HEADS_UP_MS + 5_000));
    expect(headsUp.remainingMs()).toBe(0);
  });

  it('dispose drops the pending run without cancelling or starting anything', () => {
    const { headsUp, elapsed } = makeHeadsUp();
    headsUp.announce(due());
    headsUp.dispose();
    expect(headsUp.pending()).toBeNull();
    vi.advanceTimersByTime(HEADS_UP_MS * 2);
    expect(elapsed).toHaveLength(0);
    // After dispose the flow is gone: a late scheduleDue is refused rather than shown.
    expect(headsUp.announce(due())).toBe('INVALID');
  });
});
