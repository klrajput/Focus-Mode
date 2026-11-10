// server/src/cron/scheduler.ts — the once-a-minute scheduled-focus tick (T-063, FR-012/FR-025,
// DEC-021). Why: a recurring schedule is a *local-time* plan (days 0–6 + `HH:mm` in the user's IANA
// timezone) and the cloud may only *announce* a due run to a connected Focus Agent (INV-2) — the
// agent then shows a cancellable ≥10 s heads-up and starts focus itself. This module therefore:
//   1. computes "due now" with `Intl.DateTimeFormat` (DST-correct by construction),
//   2. claims the local minute idempotently through `Schedule.lastRunAt` (no hand-rolled offsets),
//   3. dispatches `scheduleDue` only to a connected, not-already-focusing device (creating a
//      STARTED `scheduleRun`), and
//   4. records MISSED + a notification when no eligible device exists — it never queues a command
//      for later and never forces focus.
// Invariants: one run per (schedule, local minute) even across a DST fall-back; a missed run is
// recorded honestly (FR-025); all timezone math goes through `Intl` only.

import { schedule, type ScheduledTask } from 'node-cron';
import { Types } from 'mongoose';
import type { ScheduleDuePayload } from '../realtime/agentHub.js';
import { isDeviceConnected, sendScheduleDue } from '../realtime/agentHub.js';
import { Device } from '../models/Device.js';
import { Schedule } from '../models/Schedule.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { logger } from '../config/logger.js';
import { getAllowlistVersion } from '../services/allowlist.service.js';
import {
  createDispatchedRun,
  createMissedRun,
  markRunMissed,
  sweepStaleScheduleRuns,
} from '../services/schedule-run.service.js';

/** TECHNICAL_DESIGN §8: one cron job per minute (UTC expression; due-ness is per-user local time). */
export const SCHEDULER_CRON_EXPRESSION = '* * * * *';
/** The stale-run sweeper cadence (DEC-021 §4 window is 2 minutes; sweep more often). */
export const STALE_RUN_SWEEP_INTERVAL_MS = 60 * 1000;
const FALLBACK_TIME_ZONE = 'UTC';

const WEEKDAY_INDEX: Readonly<Record<string, number>> = Object.freeze({
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
});

/** Local wall-clock view of an instant in one IANA timezone. */
export interface LocalClock {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  /** `HH:mm`, 24-hour. */
  time: string;
  /** Local calendar date, `YYYY-MM-DD`. */
  dateKey: string;
}

/** A schedule row as the tick needs it (lean projection). */
export interface SchedulerSchedule {
  _id: unknown;
  userId: Types.ObjectId;
  name: string;
  days: number[];
  startTime: string;
  durationMin: number;
  lastRunAt: Date | null;
}

/** Dependencies are injectable so tests can freeze the clock and stub agent presence. */
export interface SchedulerDeps {
  now?: () => Date;
  isDeviceConnected?: (deviceId: string) => boolean;
  sendScheduleDue?: (deviceId: string, payload: ScheduleDuePayload) => boolean;
  getAllowlistVersion?: (userId: string) => Promise<number>;
}

export interface SchedulerTickResult {
  /** Due schedules whose local minute was claimed this tick. */
  due: number;
  dispatched: number;
  missed: number;
}

function intlPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? '';
}

/** Resolve an IANA timezone, falling back to UTC for a corrupt/unknown stored value. */
function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/**
 * The user's local day + `HH:mm` + date for an instant, computed with `Intl` (never by adding a
 * fixed offset), so DST transitions are handled by the runtime's timezone database.
 */
export function localClock(instant: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZone),
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const weekday = intlPart(parts, 'weekday');
  return {
    day: WEEKDAY_INDEX[weekday] ?? 0,
    time: `${intlPart(parts, 'hour')}:${intlPart(parts, 'minute')}`,
    dateKey: `${intlPart(parts, 'year')}-${intlPart(parts, 'month')}-${intlPart(parts, 'day')}`,
  };
}

/** Stable key for "the same local minute", used for DST-safe idempotency. */
export function localMinuteKey(instant: Date, timeZone: string): string {
  const clock = localClock(instant, timeZone);
  return `${clock.dateKey}T${clock.time}`;
}

/** True when the schedule's local day and `HH:mm` match this instant (REQUIREMENTS §7). */
export function isScheduleDue(
  scheduleRow: Pick<SchedulerSchedule, 'days' | 'startTime'>,
  timeZone: string,
  now: Date,
): boolean {
  const clock = localClock(now, timeZone);
  return scheduleRow.days.includes(clock.day) && clock.time === scheduleRow.startTime;
}

/**
 * `lastRunAt` must not be in the same *local* minute: a DST fall-back makes one wall-clock minute
 * occur twice, and comparing UTC minutes would fire the schedule twice that day.
 */
function alreadyRunThisLocalMinute(lastRunAt: Date | null, timeZone: string, now: Date): boolean {
  if (lastRunAt === null) return false;
  return localMinuteKey(lastRunAt, timeZone) === localMinuteKey(now, timeZone);
}

/** Compare-and-set the schedule's idempotency stamp so two concurrent ticks cannot both fire. */
async function claimScheduleMinute(scheduleRow: SchedulerSchedule, now: Date): Promise<boolean> {
  const result = await Schedule.updateOne(
    { _id: scheduleRow._id, lastRunAt: scheduleRow.lastRunAt },
    { $set: { lastRunAt: now } },
  );
  return result.modifiedCount === 1;
}

async function connectionsForUser(userId: Types.ObjectId): Promise<string[]> {
  const devices = await Device.find({ ownerId: userId }).select('_id').lean();
  return devices.map((device) => String(device._id));
}

/**
 * One scheduler tick: find due schedules, claim their local minute and either dispatch a
 * `scheduleDue` (connected, idle device) or record a missed run + notification. Never throws for a
 * single schedule failure — logs and continues so one bad row cannot stop the minute.
 */
export async function runSchedulerTick(deps: SchedulerDeps = {}): Promise<SchedulerTickResult> {
  const now = deps.now?.() ?? new Date();
  const isConnected = deps.isDeviceConnected ?? isDeviceConnected;
  const dispatch = deps.sendScheduleDue ?? sendScheduleDue;
  const allowListVersionFor = deps.getAllowlistVersion ?? getAllowlistVersion;

  const dueSchedules = (await Schedule.find({ enabled: true })
    .select('_id userId name days startTime durationMin lastRunAt')
    .lean()) as unknown as SchedulerSchedule[];

  const result: SchedulerTickResult = { due: 0, dispatched: 0, missed: 0 };
  if (dueSchedules.length === 0) return result;

  const userIds = [...new Set(dueSchedules.map((row) => String(row.userId)))].map(
    (id) => new Types.ObjectId(id),
  );
  const users = await User.find({ _id: { $in: userIds } })
    .select('_id timezone isActive')
    .lean();
  const usersById = new Map(
    users.map((user) => [String(user._id), { timeZone: user.timezone, isActive: user.isActive }]),
  );

  for (const scheduleRow of dueSchedules) {
    try {
      const owner = usersById.get(String(scheduleRow.userId));
      // W6 follow-up F-03c (A9): a deactivated account must not get scheduled focus announced.
      // Skipping here (before `lastRunAt` is claimed) also means no MISSED row/notification spam;
      // reactivation simply resumes at the next matching local minute. A deleted owner row is
      // skipped the same way. This is never a "missed" run — nothing was promised to the user.
      if (owner === undefined || owner.isActive !== true) continue;
      const timeZone = owner.timeZone ?? FALLBACK_TIME_ZONE;
      if (!isScheduleDue(scheduleRow, timeZone, now)) continue;
      if (alreadyRunThisLocalMinute(scheduleRow.lastRunAt, timeZone, now)) continue;
      if (!(await claimScheduleMinute(scheduleRow, now))) continue;
      result.due += 1;

      const connections = await connectionsForUser(scheduleRow.userId);
      const connectedDeviceId = connections.find((deviceId) => isConnected(deviceId));

      if (connectedDeviceId === undefined) {
        await createMissedRun({
          scheduleId: scheduleRow._id as Types.ObjectId,
          userId: scheduleRow.userId,
          firedAt: now,
          reason: 'no Focus Agent was connected',
        });
        result.missed += 1;
        logger.info(
          { scheduleId: String(scheduleRow._id) },
          'scheduled run missed — no connected Focus Agent (INV-2: no command queued)',
        );
        continue;
      }

      // Never dispatch a second start while the device is already focusing (FR-024).
      const busy = await Session.exists({
        deviceId: new Types.ObjectId(connectedDeviceId),
        status: 'ACTIVE',
      });
      if (busy !== null) {
        await createMissedRun({
          scheduleId: scheduleRow._id as Types.ObjectId,
          userId: scheduleRow.userId,
          firedAt: now,
          reason: 'the Focus Agent was already in a focus session',
        });
        result.missed += 1;
        continue;
      }

      const run = await createDispatchedRun({
        scheduleId: scheduleRow._id as Types.ObjectId,
        userId: scheduleRow.userId,
        deviceId: new Types.ObjectId(connectedDeviceId),
        firedAt: now,
      });
      const payload: ScheduleDuePayload = {
        runId: String(run._id),
        scheduleId: String(scheduleRow._id),
        durationMin: scheduleRow.durationMin,
        allowListVersion: await allowListVersionFor(String(scheduleRow.userId)),
      };
      if (dispatch(connectedDeviceId, payload)) {
        result.dispatched += 1;
        logger.info(
          {
            scheduleId: String(scheduleRow._id),
            runId: payload.runId,
            deviceId: connectedDeviceId,
          },
          'scheduled run dispatched (announcement only — the agent decides locally)',
        );
      } else {
        await markRunMissed(run, 'the Focus Agent connection dropped before dispatch');
        result.missed += 1;
      }
    } catch (error) {
      logger.error(
        { err: error, scheduleId: String(scheduleRow._id) },
        'scheduler tick failed for one schedule',
      );
    }
  }

  return result;
}

export interface StartSchedulerOptions {
  cronExpression?: string;
  deps?: SchedulerDeps;
  /** Test seam: disable the timer inside `schedule()` (the returned task is not started). */
  startImmediately?: boolean;
}

/**
 * Start the minute cron job (node-cron, UTC tick expression). Overlap-safe: if a tick is still
 * running when the next minute fires, that tick is skipped rather than queued.
 */
export function startScheduler(options: StartSchedulerOptions = {}): ScheduledTask {
  let running = false;
  const task = schedule(
    options.cronExpression ?? SCHEDULER_CRON_EXPRESSION,
    async (): Promise<void> => {
      if (running) {
        logger.warn('scheduler tick still running — skipping this minute');
        return;
      }
      running = true;
      try {
        const result = await runSchedulerTick(options.deps);
        if (result.due > 0) logger.info(result, 'scheduler tick completed');
      } catch (error) {
        logger.error({ err: error }, 'scheduler tick failed');
      } finally {
        running = false;
      }
    },
    { timezone: 'UTC', name: 'focus-mode-scheduler' },
  );
  if (options.startImmediately === false) task.stop();
  return task;
}

/** Periodic DEC-021 §4 sweep: STARTED runs with no confirming session after 2 minutes → MISSED. */
export function startStaleRunSweeper(
  options: { intervalMs?: number; now?: () => Date } = {},
): NodeJS.Timeout {
  const timer = setInterval(() => {
    void sweepStaleScheduleRuns(options.now?.() ?? new Date())
      .then((marked) => {
        if (marked > 0) logger.info({ marked }, 'stale schedule runs marked MISSED');
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'stale schedule-run sweep failed');
      });
  }, options.intervalMs ?? STALE_RUN_SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
