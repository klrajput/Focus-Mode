// server/src/services/schedule.service.ts — recurring schedule CRUD (T-062, FR-012).
// Why: a schedule is a user-owned local-time plan (days 0–6, `HH:mm` in the user's IANA timezone);
// the scheduler that fires it lands in W4 (T-063), so this module deliberately only persists and
// returns schedules — it never creates runs or touches the agent (no fake execution).
// Invariants: every query is owner-scoped, so a foreign schedule id behaves exactly like a missing
// one (404, NFR-003); `lastRunAt` is scheduler-owned and never writable through PATCH; validation
// comes exclusively from the frozen shared schedule schemas (NFR-001).

import { Types } from 'mongoose';
import {
  ERROR_CODES,
  type Paginated,
  type ScheduleCreateInput,
  type ScheduleUpdateInput,
} from '@focus-mode/shared';
import { Schedule } from '../models/Schedule.js';
import { AppError } from '../utils/AppError.js';
import { toObjectIdOrNotFound } from '../utils/object-id.js';
import { buildPaginated, pageSkip, type PageLimitQuery } from '../utils/pagination.js';
import { toIsoString } from '../utils/serialize.js';

/** `schedule` wire shape (INTEGRATION_CONTRACTS §3.3). */
export interface PublicSchedule {
  id: string;
  name: string;
  days: number[];
  startTime: string;
  durationMin: number;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string | null;
}

interface ScheduleLike {
  _id: unknown;
  name: string;
  days: number[];
  startTime: string;
  durationMin: number;
  enabled: boolean;
  lastRunAt: Date | null;
  createdAt?: unknown;
}

/** Whitelist + serialise a schedule document for API responses. */
export function toPublicSchedule(schedule: ScheduleLike): PublicSchedule {
  return {
    id: String(schedule._id),
    name: schedule.name,
    days: [...schedule.days].sort((left, right) => left - right),
    startTime: schedule.startTime,
    durationMin: schedule.durationMin,
    enabled: schedule.enabled,
    lastRunAt: toIsoString(schedule.lastRunAt),
    createdAt: toIsoString(schedule.createdAt),
  };
}

function toObjectId(value: string): Types.ObjectId {
  // W6/SEC-9: a malformed schedule id is a missing schedule (404), never a 500.
  return toObjectIdOrNotFound(value, 'Schedule not found.');
}

/** GET /schedules — the user's schedules ordered by start time (then id for determinism). */
export async function listSchedules(
  userId: string,
  query: PageLimitQuery,
): Promise<Paginated<PublicSchedule>> {
  const filter = { userId: toObjectId(userId) };
  const [total, schedules] = await Promise.all([
    Schedule.countDocuments(filter),
    Schedule.find(filter)
      .sort({ startTime: 1, _id: 1 })
      .skip(pageSkip(query.page, query.limit))
      .limit(query.limit)
      .lean(),
  ]);

  return buildPaginated(
    schedules.map((schedule) => toPublicSchedule(schedule)),
    query.page,
    query.limit,
    total,
  );
}

/** POST /schedules — create a user-owned plan (201). */
export async function createSchedule(
  userId: string,
  input: ScheduleCreateInput,
): Promise<PublicSchedule> {
  const schedule = await Schedule.create({
    userId: toObjectId(userId),
    name: input.name,
    days: input.days,
    startTime: input.startTime,
    durationMin: input.durationMin,
    enabled: input.enabled,
    lastRunAt: null,
  });
  return toPublicSchedule(schedule);
}

/** PATCH /schedules/:id — owner-only partial update; 404 for a foreign/missing id. */
export async function updateSchedule(
  userId: string,
  scheduleId: string,
  input: ScheduleUpdateInput,
): Promise<PublicSchedule> {
  const updated = await Schedule.findOneAndUpdate(
    { _id: toObjectId(scheduleId), userId: toObjectId(userId) },
    { $set: input },
    { new: true, runValidators: true },
  );
  if (updated === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Schedule not found.');
  }
  return toPublicSchedule(updated);
}

/** DELETE /schedules/:id — owner-only; returns the frozen `{id}` delete shape. */
export async function deleteSchedule(userId: string, scheduleId: string): Promise<{ id: string }> {
  const deleted = await Schedule.findOneAndDelete({
    _id: toObjectId(scheduleId),
    userId: toObjectId(userId),
  });
  if (deleted === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Schedule not found.');
  }
  return { id: scheduleId };
}
