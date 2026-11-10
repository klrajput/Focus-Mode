/*
 * Wall-clock schedule maths for `/dashboard` and `/schedules` (FR-012, UX_SPEC §4.3/§4.7).
 *
 * A schedule is stored as `days` (0–6, 0 = Sunday), `startTime` (`HH:mm`) and `durationMin`, and
 * those values are interpreted in the user's IANA timezone by the server. The dashboard must not
 * guess: it converts the local wall time to an instant with `Intl`, so a 09:00 block stays 09:00
 * across a DST change and the "next run" label is honest in every zone. Nothing here starts a
 * session — scheduler execution is server-side (FR-012); this module only describes the next time
 * the server could fire.
 */

import type { Schedule } from '../api/types';

/** One calendar day as seen in `timeZone`. `weekday` matches the schedule contract (0 = Sunday). */
export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

/** The next occurrence of an enabled schedule, plus how many local days away it is. */
export interface NextScheduleRun {
  schedule: Schedule;
  startsAt: Date;
  /** 0 = today, 1 = tomorrow, … in the user's timezone. */
  dayOffset: number;
}

const DAY_MS = 86_400_000;
/** A week is always enough to find the next enabled occurrence. */
const SEARCH_DAYS = 7;

const PARTS_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = PARTS_FORMAT_CACHE.get(timeZone);
  if (cached !== undefined) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  PARTS_FORMAT_CACHE.set(timeZone, formatter);
  return formatter;
}

function readParts(date: Date, timeZone: string): Record<string, number> {
  const values: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return values;
}

/** The user's local calendar day and weekday for an instant. */
export function localDateParts(date: Date, timeZone: string): LocalDateParts {
  const parts = readParts(date, timeZone);
  const year = parts.year ?? 1970;
  const month = parts.month ?? 1;
  const day = parts.day ?? 1;
  // The weekday of a calendar date is independent of the zone, so UTC is safe here.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return { year, month, day, weekday };
}

/** `localWallTime - utc` in milliseconds for the instant `date` in `timeZone`. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = readParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Convert a wall-clock time in `timeZone` to the matching instant.
 * Two passes settle DST edges: the first guess fixes the offset, the second confirms it.
 */
export function zonedWallTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = zoneOffsetMs(new Date(utcGuess), timeZone);
  let timestamp = utcGuess - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(timestamp), timeZone);
  if (secondOffset !== firstOffset) timestamp = utcGuess - secondOffset;
  return new Date(timestamp);
}

/**
 * The inclusive UTC window of one local calendar day (`startedAt` filter for GET /sessions).
 * `to` is the last millisecond of the local day, matching the server's `$lte` range.
 */
export function localDayRangeIso(
  timeZone: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const { year, month, day } = localDateParts(now, timeZone);
  const start = zonedWallTimeToDate(year, month, day, 0, 0, timeZone);
  const nextDayUtc = new Date(Date.UTC(year, month - 1, day) + DAY_MS);
  const nextStart = zonedWallTimeToDate(
    nextDayUtc.getUTCFullYear(),
    nextDayUtc.getUTCMonth() + 1,
    nextDayUtc.getUTCDate(),
    0,
    0,
    timeZone,
  );

  return {
    from: start.toISOString(),
    to: new Date(nextStart.getTime() - 1).toISOString(),
  };
}

function parseStartTime(startTime: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(startTime);
  if (match === null) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Earliest enabled schedule occurrence after `now`, scanning the next seven local days.
 * Returns `null` when nothing is enabled (the dashboard's honest empty state).
 */
export function nextScheduleRun(
  schedules: readonly Schedule[],
  timeZone: string,
  now: Date = new Date(),
): NextScheduleRun | null {
  const today = localDateParts(now, timeZone);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  let best: NextScheduleRun | null = null;

  for (let dayOffset = 0; dayOffset < SEARCH_DAYS; dayOffset += 1) {
    const calendarDay = new Date(todayUtc + dayOffset * DAY_MS);
    const year = calendarDay.getUTCFullYear();
    const month = calendarDay.getUTCMonth() + 1;
    const day = calendarDay.getUTCDate();
    const weekday = calendarDay.getUTCDay();

    for (const schedule of schedules) {
      if (!schedule.enabled) continue;
      if (!schedule.days.includes(weekday)) continue;

      const time = parseStartTime(schedule.startTime);
      if (time === null) continue;

      const startsAt = zonedWallTimeToDate(year, month, day, time.hour, time.minute, timeZone);
      if (startsAt.getTime() <= now.getTime()) continue;
      if (best !== null && startsAt.getTime() >= best.startsAt.getTime()) continue;

      best = { schedule, startsAt, dayOffset };
    }
  }

  return best;
}

/**
 * "today" / "tomorrow" / "Monday" for the next run, from the user's local perspective.
 * The wall-clock time itself is rendered from `startTime`, so a DST shift never rewrites it.
 */
export function describeNextRunDay(run: NextScheduleRun, timeZone: string): string {
  if (run.dayOffset === 0) return 'today';
  if (run.dayOffset === 1) return 'tomorrow';

  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(run.startsAt);
}
