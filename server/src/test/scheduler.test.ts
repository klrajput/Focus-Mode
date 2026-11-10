// server/src/test/scheduler.test.ts — T-063 acceptance (FR-012/FR-025, DEC-021).
// Why: the once-a-minute scheduler decides *when* a scheduled focus may be announced. A wrong
// timezone/DST calculation would start sessions at the wrong local time, and a missing idempotency
// guard would announce twice. These tests therefore (a) prove the pure due-check against real IANA
// timezones including both DST transitions, using an INDEPENDENT Intl formatter in the test (not the
// implementation helper), and (b) drive `runSchedulerTick` against a real MongoDB with injected
// presence/dispatch dependencies, asserting the scheduleRun lifecycle + FR-025 notifications.
// Invariants asserted: local-day+HH:mm matching only; one run per local minute (DST fall-back safe);
// `lastRunAt` set on dispatch or miss; offline/busy → MISSED + notification and NEVER a queued
// command; connected+idle → STARTED run + one `scheduleDue`; disabled/non-due schedules untouched.

import { randomUUID } from 'node:crypto';
import type { ScheduledTask } from 'node-cron';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ScheduleDuePayload } from '../realtime/agentHub.js';
import { areCronJobsRunning, startCronJobs, stopCronJobs } from '../cron/index.js';
import {
  isScheduleDue,
  localClock,
  localMinuteKey,
  runSchedulerTick,
  startScheduler,
  startStaleRunSweeper,
  type SchedulerDeps,
} from '../cron/scheduler.js';
import { Notification } from '../models/Notification.js';
import { Schedule } from '../models/Schedule.js';
import { Session } from '../models/Session.js';
import { ScheduleRun } from '../models/ScheduleRun.js';
import {
  clearTestDatabase,
  createDirectUser,
  createTestDevice,
  createTestSchedule,
  startTestDatabase,
  stopTestDatabase,
} from './helpers.js';

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Independent local-time formatter (deliberately not the scheduler's own `localClock`). */
function localParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    day: WEEKDAY_INDEX[get('weekday')] ?? 0,
    time: `${get('hour')}:${get('minute')}`,
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
});

describe('isScheduleDue — timezone and DST correctness (FR-012)', () => {
  it('matches the local day + HH:mm in a non-UTC timezone (Asia/Kolkata, +05:30)', () => {
    const now = new Date('2026-11-10T03:30:00.000Z'); // Tuesday 09:00 IST
    const local = localParts(now, 'Asia/Kolkata');
    expect(local).toMatchObject({ day: 2, time: '09:00' });

    expect(isScheduleDue({ days: [2], startTime: '09:00' }, 'Asia/Kolkata', now)).toBe(true);
    expect(isScheduleDue({ days: [2], startTime: '09:01' }, 'Asia/Kolkata', now)).toBe(false);
    expect(isScheduleDue({ days: [1], startTime: '09:00' }, 'Asia/Kolkata', now)).toBe(false);
  });

  it('handles the DST spring-forward day with Intl (2026-03-08, America/New_York)', () => {
    const beforeJump = new Date('2026-03-08T06:30:00.000Z'); // 01:30 EST
    const afterJump = new Date('2026-03-08T07:30:00.000Z'); // 03:30 EDT
    expect(localParts(beforeJump, 'America/New_York')).toMatchObject({ day: 0, time: '01:30' });
    expect(localParts(afterJump, 'America/New_York')).toMatchObject({ day: 0, time: '03:30' });

    expect(isScheduleDue({ days: [0], startTime: '01:30' }, 'America/New_York', beforeJump)).toBe(
      true,
    );
    expect(isScheduleDue({ days: [0], startTime: '03:30' }, 'America/New_York', afterJump)).toBe(
      true,
    );
    // 02:30 does not exist on that local day, so neither instant can match it.
    expect(isScheduleDue({ days: [0], startTime: '02:30' }, 'America/New_York', beforeJump)).toBe(
      false,
    );
    expect(isScheduleDue({ days: [0], startTime: '02:30' }, 'America/New_York', afterJump)).toBe(
      false,
    );
  });

  it('detects the repeated local minute across the DST fall-back (2026-11-01)', () => {
    const first = new Date('2026-11-01T05:30:00.000Z'); // 01:30 EDT
    const second = new Date('2026-11-01T06:30:00.000Z'); // 01:30 EST
    expect(localParts(first, 'America/New_York').time).toBe('01:30');
    expect(localParts(second, 'America/New_York').time).toBe('01:30');
    // Same wall-clock minute → the idempotency key is identical, so the schedule cannot fire twice.
    expect(localMinuteKey(first, 'America/New_York')).toBe(
      localMinuteKey(second, 'America/New_York'),
    );
    expect(isScheduleDue({ days: [0], startTime: '01:30' }, 'America/New_York', first)).toBe(true);
    expect(isScheduleDue({ days: [0], startTime: '01:30' }, 'America/New_York', second)).toBe(true);
  });

  it('falls back to UTC for an invalid stored timezone instead of throwing', () => {
    const now = new Date('2026-11-10T09:00:00.000Z');
    const clock = localClock(now, 'Not/A_Real_Zone');
    expect(clock.time).toBe('09:00');
    expect(isScheduleDue({ days: [2], startTime: '09:00' }, 'Not/A_Real_Zone', now)).toBe(true);
  });
});

describe('runSchedulerTick — dispatch, idempotency and missed runs (T-063)', () => {
  const NOW = new Date('2026-11-10T03:30:00.000Z'); // Tuesday 09:00 Asia/Kolkata

  interface TickHarness {
    deps: SchedulerDeps;
    sends: { deviceId: string; payload: ScheduleDuePayload }[];
    setConnected(connected: boolean): void;
    setDelivered(delivered: boolean): void;
  }

  function harness(): TickHarness {
    let connected = true;
    let delivered = true;
    const sends: { deviceId: string; payload: ScheduleDuePayload }[] = [];
    return {
      sends,
      deps: {
        now: () => NOW,
        isDeviceConnected: () => connected,
        sendScheduleDue: (deviceId, payload) => {
          if (!delivered) return false;
          sends.push({ deviceId, payload });
          return true;
        },
        getAllowlistVersion: async () => 1,
      },
      setConnected: (next) => {
        connected = next;
      },
      setDelivered: (next) => {
        delivered = next;
      },
    };
  }

  it('dispatches one scheduleDue to a connected idle device and records a STARTED run', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata' });
    const local = localParts(NOW, 'Asia/Kolkata');
    const schedule = await createTestSchedule({
      userId: user._id,
      days: [local.day],
      startTime: local.time,
      durationMin: 25,
    });
    const { deviceId } = await createTestDevice({ ownerId: user._id });
    const tick = harness();

    const result = await runSchedulerTick(tick.deps);

    expect(result).toEqual({ due: 1, dispatched: 1, missed: 0 });
    expect(tick.sends).toHaveLength(1);
    expect(tick.sends[0]?.deviceId).toBe(deviceId);
    expect(tick.sends[0]?.payload).toMatchObject({
      scheduleId: String(schedule._id),
      durationMin: 25,
      allowListVersion: 1,
    });

    const runs = await ScheduleRun.find().lean();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      scheduleId: schedule._id,
      status: 'STARTED',
      sessionId: null,
    });
    expect(String(runs[0]?.deviceId)).toBe(deviceId);
    expect(runs[0]?.firedAt).toEqual(NOW);

    const updatedSchedule = await Schedule.findById(schedule._id).lean();
    expect(updatedSchedule?.lastRunAt).toEqual(NOW);
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('is idempotent for the same local minute (second tick dispatches nothing)', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata' });
    const local = localParts(NOW, 'Asia/Kolkata');
    await createTestSchedule({ userId: user._id, days: [local.day], startTime: local.time });
    await createTestDevice({ ownerId: user._id });
    const first = harness();
    const second = harness();

    const firstResult = await runSchedulerTick(first.deps);
    const secondResult = await runSchedulerTick(second.deps);

    expect(firstResult.dispatched).toBe(1);
    expect(secondResult).toEqual({ due: 0, dispatched: 0, missed: 0 });
    expect(first.sends).toHaveLength(1);
    expect(second.sends).toHaveLength(0);
    expect(await ScheduleRun.countDocuments()).toBe(1);
  });

  it('ignores a schedule whose local time/day does not match (no run, no notification)', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata' });
    const local = localParts(NOW, 'Asia/Kolkata');
    await createTestSchedule({
      userId: user._id,
      days: [(local.day + 1) % 7],
      startTime: local.time,
    });
    await createTestSchedule({ userId: user._id, days: [local.day], startTime: '23:59' });
    await createTestDevice({ ownerId: user._id });
    const tick = harness();

    const result = await runSchedulerTick(tick.deps);

    expect(result).toEqual({ due: 0, dispatched: 0, missed: 0 });
    expect(await ScheduleRun.countDocuments()).toBe(0);
    expect(tick.sends).toHaveLength(0);
  });

  it('skips disabled schedules', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata' });
    const local = localParts(NOW, 'Asia/Kolkata');
    await createTestSchedule({
      userId: user._id,
      days: [local.day],
      startTime: local.time,
      enabled: false,
    });
    await createTestDevice({ ownerId: user._id });

    const result = await runSchedulerTick(harness().deps);

    expect(result.due).toBe(0);
    expect(await ScheduleRun.countDocuments()).toBe(0);
  });

  it('records MISSED + a notification (never a queued command) when no device is connected', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata' });
    const local = localParts(NOW, 'Asia/Kolkata');
    const schedule = await createTestSchedule({
      userId: user._id,
      days: [local.day],
      startTime: local.time,
      name: 'Morning deep work',
    });
    await createTestDevice({ ownerId: user._id });
    const tick = harness();
    tick.setConnected(false);

    const result = await runSchedulerTick(tick.deps);

    expect(result).toEqual({ due: 1, dispatched: 0, missed: 1 });
    expect(tick.sends).toHaveLength(0);

    const runs = await ScheduleRun.find().lean();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'MISSED', deviceId: null, sessionId: null });

    const notifications = await Notification.find().lean();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ userId: user._id, type: 'SCHEDULE_MISSED' });
    expect(notifications[0]?.message).toContain('Morning deep work');
    expect(notifications[0]?.message).toContain('no Focus Agent was connected');
    // lastRunAt is still stamped so the same minute cannot fire twice.
    expect((await Schedule.findById(schedule._id).lean())?.lastRunAt).toEqual(NOW);
  });

  it('records MISSED when the device is already in an ACTIVE focus session (FR-024)', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata' });
    const local = localParts(NOW, 'Asia/Kolkata');
    await createTestSchedule({ userId: user._id, days: [local.day], startTime: local.time });
    const { deviceId } = await createTestDevice({ ownerId: user._id });
    await Session.create({
      userId: user._id,
      deviceId,
      startedAt: new Date(NOW.getTime() - 5 * 60_000),
      plannedMinutes: 25,
      actualMinutes: 0,
      status: 'ACTIVE',
      source: 'MANUAL',
      clientSessionId: randomUUID(),
      endReason: null,
      lastHeartbeatAt: NOW,
    });
    const tick = harness();

    const result = await runSchedulerTick(tick.deps);

    expect(result).toEqual({ due: 1, dispatched: 0, missed: 1 });
    expect(tick.sends).toHaveLength(0);
    expect((await ScheduleRun.findOne().lean())?.status).toBe('MISSED');
    expect((await Notification.findOne().lean())?.message).toContain('already in a focus session');
  });

  it('records MISSED when the send loses the presence race (delivered=false)', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata' });
    const local = localParts(NOW, 'Asia/Kolkata');
    await createTestSchedule({ userId: user._id, days: [local.day], startTime: local.time });
    await createTestDevice({ ownerId: user._id });
    const tick = harness();
    tick.setDelivered(false);

    const result = await runSchedulerTick(tick.deps);

    expect(result).toEqual({ due: 1, dispatched: 0, missed: 1 });
    expect((await ScheduleRun.findOne().lean())?.status).toBe('MISSED');
    expect(await Notification.countDocuments()).toBe(1);
  });

  it('uses each user’s own IANA timezone in the same tick', async () => {
    const kolkataUser = await createDirectUser({ timezone: 'Asia/Kolkata' });
    const newYorkUser = await createDirectUser({ timezone: 'America/New_York' });
    const kolkataLocal = localParts(NOW, 'Asia/Kolkata');
    const newYorkLocal = localParts(NOW, 'America/New_York');
    await createTestSchedule({
      userId: kolkataUser._id,
      days: [kolkataLocal.day],
      startTime: kolkataLocal.time,
    });
    await createTestSchedule({
      userId: newYorkUser._id,
      days: [newYorkLocal.day],
      startTime: newYorkLocal.time,
    });
    await createTestDevice({ ownerId: kolkataUser._id });
    await createTestDevice({ ownerId: newYorkUser._id });

    const result = await runSchedulerTick(harness().deps);

    expect(result).toEqual({ due: 2, dispatched: 2, missed: 0 });
    expect(await ScheduleRun.countDocuments()).toBe(2);
  });
});

describe('scheduler/reaper timers and cron bootstrap', () => {
  it('startScheduler returns a node-cron task that can be destroyed without firing', async () => {
    const task: ScheduledTask = startScheduler({ startImmediately: false });
    expect(task.getPattern()).toBe('* * * * *');
    await task.destroy();
  });

  it('startStaleRunSweeper returns an unref’ed interval that can be cleared', () => {
    const timer = startStaleRunSweeper({ intervalMs: 60_000 });
    expect(timer.hasRef()).toBe(false);
    clearInterval(timer);
  });

  it('startCronJobs is idempotent and stopCronJobs cleans up (idempotent too)', async () => {
    expect(areCronJobsRunning()).toBe(false);
    expect(startCronJobs()).toBe(true);
    expect(areCronJobsRunning()).toBe(true);
    expect(startCronJobs()).toBe(false);
    await stopCronJobs();
    expect(areCronJobsRunning()).toBe(false);
    await stopCronJobs(); // no-op
  });
});
