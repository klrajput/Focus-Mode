// server/src/services/schedule-run.service.ts — the schedule-run lifecycle (T-063/DEC-021).
// Why: a scheduled focus run has to be recorded honestly at every step: dispatched (STARTED,
// `sessionId: null`), confirmed (the agent's `session.started.scheduleRunId` sets `sessionId`),
// cancelled by the user during the local heads-up (CANCELLED_BY_USER), or missed (offline device or
// no confirmed session within 2 minutes). Missing runs also produce a user notification (FR-025).
// The cloud never queues a `scheduleDue` for later and never forces focus (INV-2).
// Invariants: state transitions are atomic (`findOneAndUpdate` guarded by the current status), a
// MISSED run is never resurrected, and the stale sweep only touches STARTED runs without a session.

import { Types } from 'mongoose';
import { ScheduleRun, type ScheduleRunDocument } from '../models/ScheduleRun.js';
import { Schedule } from '../models/Schedule.js';
import { Notification } from '../models/Notification.js';
import { logger } from '../config/logger.js';

/** DEC-021 §4: a STARTED run with no linked session after this window becomes MISSED. */
export const SCHEDULE_RUN_CONFIRM_WINDOW_MS = 2 * 60 * 1000;
/** Upper bound for one stale sweep (keeps the minute tick bounded on a large install). */
const STALE_RUN_SWEEP_LIMIT = 100;
const MISSED_NOTIFICATION_TYPE = 'SCHEDULE_MISSED' as const;
const FALLBACK_SCHEDULE_NAME = 'Scheduled focus';

export interface ScheduleRunIdentity {
  scheduleId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
  firedAt: Date;
}

export interface DispatchedRunInput extends ScheduleRunIdentity {
  deviceId: string | Types.ObjectId;
}

/** Create the run record for a `scheduleDue` we are about to send (STARTED, unconfirmed). */
export async function createDispatchedRun(input: DispatchedRunInput): Promise<ScheduleRunDocument> {
  return ScheduleRun.create({
    scheduleId: input.scheduleId,
    userId: input.userId,
    deviceId: input.deviceId,
    firedAt: input.firedAt,
    status: 'STARTED',
    sessionId: null,
  });
}

/** Mark a run MISSED and notify the user; safe to call for a run that was already finalised. */
export async function markRunMissed(run: ScheduleRunDocument, reason: string): Promise<boolean> {
  const updated = await ScheduleRun.updateOne(
    { _id: run._id, status: 'STARTED', sessionId: null },
    { $set: { status: 'MISSED' } },
  );
  if (updated.modifiedCount !== 1) return false;
  await createMissedRunNotification(run.userId, run.scheduleId, reason);
  return true;
}

/** Create a MISSED run + notification for a due schedule that could not be dispatched (FR-025). */
export async function createMissedRun(
  input: ScheduleRunIdentity & { reason: string },
): Promise<ScheduleRunDocument> {
  const run = await ScheduleRun.create({
    scheduleId: input.scheduleId,
    userId: input.userId,
    deviceId: null,
    firedAt: input.firedAt,
    status: 'MISSED',
    sessionId: null,
  });
  await createMissedRunNotification(run.userId, run.scheduleId, input.reason);
  return run;
}

/**
 * DEC-021 §3: the agent's `session.started` carries `scheduleRunId`; store the confirming session.
 * Only the device the run was dispatched to may confirm it, and only while it is still STARTED.
 */
export async function markRunConfirmed(input: {
  runId: string | Types.ObjectId;
  deviceId: string | Types.ObjectId;
  sessionId: string | Types.ObjectId;
}): Promise<boolean> {
  const updated = await ScheduleRun.findOneAndUpdate(
    {
      _id: input.runId,
      deviceId: input.deviceId,
      status: 'STARTED',
      sessionId: null,
    },
    { $set: { sessionId: input.sessionId } },
    { new: true },
  );
  return updated !== null;
}

/** DEC-021 §3: the user cancelled the agent heads-up → CANCELLED_BY_USER (no session is created). */
export async function cancelScheduleRun(input: {
  runId: string | Types.ObjectId;
  deviceId: string | Types.ObjectId;
}): Promise<boolean> {
  const updated = await ScheduleRun.findOneAndUpdate(
    {
      _id: input.runId,
      deviceId: input.deviceId,
      status: 'STARTED',
    },
    { $set: { status: 'CANCELLED_BY_USER' } },
    { new: true },
  );
  return updated !== null;
}

/**
 * DEC-021 §4: dispatched runs with no confirming session 2 minutes after dispatch become MISSED.
 * Atomic per run so a confirmation racing this sweep either keeps the run STARTED (and linked) or
 * loses and is reported as missed — never both.
 */
export async function sweepStaleScheduleRuns(now: Date = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - SCHEDULE_RUN_CONFIRM_WINDOW_MS);
  const stale = await ScheduleRun.find({
    status: 'STARTED',
    sessionId: null,
    firedAt: { $lt: threshold },
  })
    .limit(STALE_RUN_SWEEP_LIMIT)
    .sort({ firedAt: 1 })
    .lean();

  let marked = 0;
  for (const run of stale) {
    const updated = await ScheduleRun.updateOne(
      { _id: run._id, status: 'STARTED', sessionId: null },
      { $set: { status: 'MISSED' } },
    );
    if (updated.modifiedCount !== 1) continue;
    marked += 1;
    await createMissedRunNotification(
      run.userId,
      run.scheduleId,
      'no scheduled focus started within 2 minutes',
    );
  }
  return marked;
}

/**
 * FR-025: one in-app notification per missed run. Notification types are a frozen enum
 * (`SCHEDULE_MISSED` is the only schedule-related option), and the message never contains window
 * titles or URLs (INV-6).
 */
export async function createMissedRunNotification(
  userId: string | Types.ObjectId,
  scheduleId: string | Types.ObjectId,
  reason: string,
): Promise<void> {
  const schedule = await Schedule.findById(scheduleId).select('name').lean();
  const name = schedule?.name ?? FALLBACK_SCHEDULE_NAME;
  try {
    await Notification.create({
      userId,
      type: MISSED_NOTIFICATION_TYPE,
      message: `${name} was missed — ${reason}.`,
      readAt: null,
    });
  } catch (error) {
    // A notification failure must never fail the scheduler/sweeper write path.
    logger.error({ err: error, userId: String(userId) }, 'missed-run notification failed');
  }
}
