// server/src/test/schedule-run.test.ts — DEC-021 schedule-run lifecycle at the service level.
// Why: the scheduler creates runs, the agent confirms or cancels them, and a sweeper must record the
// honest MISSED state when no scheduled focus ever started. These are the atomic, race-safe
// transitions behind T-063: each one is guarded by the current run status so a late message cannot
// rewrite history (confirmed runs are never marked missed, cancelled runs are never confirmed).
// Invariants asserted: STARTED+sessionId=null→MISSED only after the 2-minute window; a confirmed run
// (sessionId set) is untouched by the sweep; wrong-device confirms/cancels are rejected; MISSED runs
// also produce exactly one SCHEDULE_MISSED notification (FR-025).

import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Notification } from '../models/Notification.js';
import { ScheduleRun } from '../models/ScheduleRun.js';
import {
  SCHEDULE_RUN_CONFIRM_WINDOW_MS,
  cancelScheduleRun,
  createDispatchedRun,
  createMissedRun,
  markRunConfirmed,
  markRunMissed,
  sweepStaleScheduleRuns,
} from '../services/schedule-run.service.js';
import {
  clearTestDatabase,
  createDirectUser,
  createTestDevice,
  createTestSchedule,
  startTestDatabase,
  stopTestDatabase,
} from './helpers.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const OTHER_DEVICE_HASH = new Types.ObjectId().toHexString();

interface RunFixture {
  userId: Types.ObjectId;
  deviceId: string;
  scheduleId: Types.ObjectId;
}

async function fixture(): Promise<RunFixture> {
  const user = await createDirectUser({ timezone: 'UTC' });
  const { deviceId } = await createTestDevice({ ownerId: user._id });
  const schedule = await createTestSchedule({
    userId: user._id,
    days: [2],
    startTime: '09:00',
    name: 'Morning deep work',
  });
  return { userId: user._id, deviceId, scheduleId: schedule._id };
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

describe('schedule-run lifecycle (DEC-021)', () => {
  it('creates a dispatched run as STARTED with no confirming session', async () => {
    const { userId, deviceId, scheduleId } = await fixture();

    const run = await createDispatchedRun({ scheduleId, userId, deviceId, firedAt: NOW });

    expect(run.status).toBe('STARTED');
    expect(run.sessionId).toBeNull();
    expect(String(run.deviceId)).toBe(deviceId);
  });

  it('links the confirming session exactly once for the dispatched device', async () => {
    const { userId, deviceId, scheduleId } = await fixture();
    const run = await createDispatchedRun({ scheduleId, userId, deviceId, firedAt: NOW });
    const sessionId = new Types.ObjectId();

    await expect(markRunConfirmed({ runId: run._id, deviceId, sessionId })).resolves.toBe(true);
    expect((await ScheduleRun.findById(run._id).lean())?.sessionId).toEqual(sessionId);

    // A repeated (late) confirmation must not rewrite the link.
    await expect(
      markRunConfirmed({ runId: run._id, deviceId, sessionId: new Types.ObjectId() }),
    ).resolves.toBe(false);

    // Another device cannot confirm someone else's run.
    await expect(
      markRunConfirmed({ runId: run._id, deviceId: OTHER_DEVICE_HASH, sessionId }),
    ).resolves.toBe(false);
  });

  it('cancels a STARTED run as CANCELLED_BY_USER for the dispatched device only', async () => {
    const { userId, deviceId, scheduleId } = await fixture();
    const run = await createDispatchedRun({ scheduleId, userId, deviceId, firedAt: NOW });

    await expect(cancelScheduleRun({ runId: run._id, deviceId: OTHER_DEVICE_HASH })).resolves.toBe(
      false,
    );
    await expect(cancelScheduleRun({ runId: run._id, deviceId })).resolves.toBe(true);
    expect((await ScheduleRun.findById(run._id).lean())?.status).toBe('CANCELLED_BY_USER');

    // A cancelled run can never be confirmed afterwards.
    await expect(
      markRunConfirmed({ runId: run._id, deviceId, sessionId: new Types.ObjectId() }),
    ).resolves.toBe(false);
  });

  it('records a missed run with exactly one FR-025 notification', async () => {
    const { userId, scheduleId } = await fixture();

    const run = await createMissedRun({
      scheduleId,
      userId,
      firedAt: NOW,
      reason: 'no Focus Agent was connected',
    });

    expect(run.status).toBe('MISSED');
    expect(run.deviceId).toBeNull();
    const notifications = await Notification.find().lean();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ userId, type: 'SCHEDULE_MISSED' });
    expect(notifications[0]?.message).toContain('Morning deep work');
  });

  it('markRunMissed transitions a dispatched run and notifies once (idempotent)', async () => {
    const { userId, deviceId, scheduleId } = await fixture();
    const run = await createDispatchedRun({ scheduleId, userId, deviceId, firedAt: NOW });

    await expect(
      markRunMissed(run, 'the Focus Agent connection dropped before dispatch'),
    ).resolves.toBe(true);
    await expect(markRunMissed(run, 'late duplicate')).resolves.toBe(false);

    expect((await ScheduleRun.findById(run._id).lean())?.status).toBe('MISSED');
    expect(await Notification.countDocuments()).toBe(1);
  });
});

describe('sweepStaleScheduleRuns (DEC-021 §4)', () => {
  it('marks STARTED runs without a session MISSED after the 2-minute window', async () => {
    const { userId, deviceId, scheduleId } = await fixture();
    const stale = await createDispatchedRun({
      scheduleId,
      userId,
      deviceId,
      firedAt: new Date(NOW.getTime() - SCHEDULE_RUN_CONFIRM_WINDOW_MS - 60_000),
    });

    const marked = await sweepStaleScheduleRuns(NOW);

    expect(marked).toBe(1);
    expect((await ScheduleRun.findById(stale._id).lean())?.status).toBe('MISSED');
    expect(await Notification.countDocuments()).toBe(1);
  });

  it('never touches a confirmed run or a still-fresh dispatch', async () => {
    const { userId, deviceId, scheduleId } = await fixture();
    const confirmed = await createDispatchedRun({
      scheduleId,
      userId,
      deviceId,
      firedAt: new Date(NOW.getTime() - SCHEDULE_RUN_CONFIRM_WINDOW_MS - 60_000),
    });
    await markRunConfirmed({ runId: confirmed._id, deviceId, sessionId: new Types.ObjectId() });
    const fresh = await createDispatchedRun({
      scheduleId,
      userId,
      deviceId,
      firedAt: new Date(NOW.getTime() - 30_000),
    });

    const marked = await sweepStaleScheduleRuns(NOW);

    expect(marked).toBe(0);
    expect((await ScheduleRun.findById(confirmed._id).lean())?.status).toBe('STARTED');
    expect((await ScheduleRun.findById(fresh._id).lean())?.status).toBe('STARTED');
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('leaves already-MISSED / CANCELLED_BY_USER runs untouched', async () => {
    const { userId, deviceId, scheduleId } = await fixture();
    const missed = await createDispatchedRun({
      scheduleId,
      userId,
      deviceId,
      firedAt: new Date(NOW.getTime() - 10 * 60_000),
    });
    await ScheduleRun.updateOne({ _id: missed._id }, { $set: { status: 'MISSED' } });
    const cancelled = await createDispatchedRun({
      scheduleId,
      userId,
      deviceId,
      firedAt: new Date(NOW.getTime() - 10 * 60_000),
    });
    await cancelScheduleRun({ runId: cancelled._id, deviceId });

    const marked = await sweepStaleScheduleRuns(NOW);

    expect(marked).toBe(0);
    expect((await ScheduleRun.findById(missed._id).lean())?.status).toBe('MISSED');
    expect((await ScheduleRun.findById(cancelled._id).lean())?.status).toBe('CANCELLED_BY_USER');
  });
});
