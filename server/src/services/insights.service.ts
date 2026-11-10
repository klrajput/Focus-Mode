// server/src/services/insights.service.ts — analytics for `GET /api/v1/insights` (T-070, FR-013).
// Why: the dashboard's numbers must match REQUIREMENTS §6 exactly, in the user's IANA timezone and
// DST-correct. Definitions implemented here:
//   • focusMinutes  = Σ actualMinutes of COMPLETED sessions whose local start day is in the range,
//   • sessions      = COMPLETED + CANCELLED sessions in the range (ACTIVE never counts — FR-028),
//   • completionRate= COMPLETED ÷ (COMPLETED + CANCELLED), 0 when nothing terminal is in range,
//   • daily         = the last 7 local days (the REQUIREMENTS "weekly chart"), zero-filled,
//   • weekly        = Monday-start calendar-week buckets covering a 30d/90d range (additive W5 field),
//   • streaks       = consecutive local days with ≥10 COMPLETED minutes (today or yesterday anchor),
//   • bestHours     = top-3 local hours by COMPLETED minutes in the range.
// Only real elapsed sessions count: ACTIVE sessions are ignored entirely, and everything is bucketed
// by the session's LOCAL start day/hour via Intl (never by fixed offsets).

import { ERROR_CODES, type InsightsQuery, type InsightsRange } from '@focus-mode/shared';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import {
  addLocalDays,
  listLocalDateKeys,
  localDateKey,
  localDayHour,
  safeTimeZone,
  weekStartOf,
} from '../utils/timezone.js';

/** Sessions reaching these states are the only ones with real elapsed focus time (FR-028). */
const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED'] as const;
/** REQUIREMENTS §6: a "day with focus" needs at least 10 focus minutes. */
export const FOCUS_DAY_MINUTES = 10;
/** REQUIREMENTS §6: the weekly chart is always the last 7 local days. */
export const DAILY_SERIES_DAYS = 7;
const RANGE_DAYS: Readonly<Record<InsightsRange, number>> = Object.freeze({
  '7d': 7,
  '30d': 30,
  '90d': 90,
});
const BEST_HOURS_LIMIT = 3;
const MINUTE_PRECISION = 10;

export interface InsightsTotals {
  focusMinutes: number;
  sessions: number;
  completed: number;
  cancelled: number;
  completionRate: number;
  currentStreak: number;
  longestStreak: number;
}

export interface InsightsDailyPoint {
  date: string;
  minutes: number;
}

/** Additive W5 field: Monday-start weekly buckets for the 30d/90d ranges (contract delta C-24). */
export interface InsightsWeeklyBucket {
  weekStart: string;
  minutes: number;
}

export interface InsightsBestHour {
  hour: number;
  minutes: number;
}

/** `insights` wire shape (INTEGRATION_CONTRACTS §3.3 + additive `weekly`). */
export interface Insights {
  range: InsightsRange;
  timezone: string;
  totals: InsightsTotals;
  daily: InsightsDailyPoint[];
  weekly?: InsightsWeeklyBucket[];
  bestHours: InsightsBestHour[];
}

/** Injectable clock so tests can pin "now" and hand-compute fixtures. */
export interface InsightsDeps {
  now?: () => Date;
}

interface SessionFact {
  startedAt: Date;
  actualMinutes: number;
  status: 'COMPLETED' | 'CANCELLED';
}

function roundMinutes(value: number): number {
  return Math.round(value * MINUTE_PRECISION) / MINUTE_PRECISION;
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Current streak of focus days ending today, or yesterday when today has no focus yet (§6). */
function currentStreak(focusDays: ReadonlySet<string>, todayKey: string): number {
  let cursor = focusDays.has(todayKey) ? todayKey : addLocalDays(todayKey, -1);
  let streak = 0;
  while (focusDays.has(cursor)) {
    streak += 1;
    cursor = addLocalDays(cursor, -1);
  }
  return streak;
}

/** Longest run of consecutive focus days in the user's history. */
function longestStreak(focusDays: ReadonlySet<string>): number {
  const sorted = [...focusDays].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    run = previous !== null && addLocalDays(previous, 1) === day ? run + 1 : 1;
    previous = day;
    longest = Math.max(longest, run);
  }
  return longest;
}

/**
 * Compute the insights payload for one user.
 * `deps.now` exists only for deterministic tests; the HTTP controller always uses the real clock.
 */
export async function getInsights(
  userId: string,
  query: InsightsQuery,
  deps: InsightsDeps = {},
): Promise<Insights> {
  const now = deps.now?.() ?? new Date();
  const user = await User.findById(userId).select('timezone').lean();
  if (user === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found.');
  }

  // Query override wins (the client may preview another zone); otherwise the stored zone is used.
  const timezone = safeTimeZone(query.timezone ?? user.timezone);
  const todayKey = localDateKey(now, timezone);
  const rangeDays = RANGE_DAYS[query.range];
  const rangeStartKey = addLocalDays(todayKey, -(rangeDays - 1));

  const sessions = (await Session.find({
    userId,
    status: { $in: [...TERMINAL_STATUSES] },
  })
    .select('startedAt actualMinutes status')
    .lean()) as unknown as SessionFact[];

  // All-time COMPLETED minutes per local day → streaks (an ongoing streak may predate the range).
  const completedMinutesByDay = new Map<string, number>();
  // Range-scoped aggregates.
  let focusMinutes = 0;
  let completedInRange = 0;
  let cancelledInRange = 0;
  const minutesByLocalHour = new Map<number, number>();

  for (const session of sessions) {
    const { dateKey, hour } = localDayHour(session.startedAt, timezone);
    if (session.status === 'COMPLETED') {
      completedMinutesByDay.set(
        dateKey,
        (completedMinutesByDay.get(dateKey) ?? 0) + session.actualMinutes,
      );
    }
    const inRange = dateKey >= rangeStartKey && dateKey <= todayKey;
    if (!inRange) continue;
    if (session.status === 'COMPLETED') {
      completedInRange += 1;
      focusMinutes += session.actualMinutes;
      minutesByLocalHour.set(hour, (minutesByLocalHour.get(hour) ?? 0) + session.actualMinutes);
    } else {
      cancelledInRange += 1;
    }
  }

  const focusDayKeys = new Set(
    [...completedMinutesByDay.entries()]
      .filter(([, minutes]) => minutes >= FOCUS_DAY_MINUTES)
      .map(([dateKey]) => dateKey),
  );

  const daily = listLocalDateKeys(todayKey, DAILY_SERIES_DAYS).map((dateKey) => ({
    date: dateKey,
    minutes: roundMinutes(completedMinutesByDay.get(dateKey) ?? 0),
  }));

  const bestHours = [...minutesByLocalHour.entries()]
    .filter(([, minutes]) => minutes > 0)
    .map(([hour, minutes]) => ({ hour, minutes: roundMinutes(minutes) }))
    .sort((left, right) => right.minutes - left.minutes || left.hour - right.hour)
    .slice(0, BEST_HOURS_LIMIT);

  const terminalInRange = completedInRange + cancelledInRange;
  const insights: Insights = {
    range: query.range,
    timezone,
    totals: {
      focusMinutes: roundMinutes(focusMinutes),
      sessions: terminalInRange,
      completed: completedInRange,
      cancelled: cancelledInRange,
      completionRate: terminalInRange === 0 ? 0 : roundRate(completedInRange / terminalInRange),
      currentStreak: currentStreak(focusDayKeys, todayKey),
      longestStreak: longestStreak(focusDayKeys),
    },
    daily,
    bestHours,
  };

  // Weekly buckets are meaningful for longer ranges only (the 7d chart is already daily).
  if (query.range !== '7d') {
    const bucketMinutes = new Map<string, number>();
    for (const dateKey of listLocalDateKeys(todayKey, rangeDays)) {
      const weekStart = weekStartOf(dateKey);
      bucketMinutes.set(
        weekStart,
        (bucketMinutes.get(weekStart) ?? 0) + (completedMinutesByDay.get(dateKey) ?? 0),
      );
    }
    insights.weekly = [...bucketMinutes.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([weekStart, minutes]) => ({ weekStart, minutes: roundMinutes(minutes) }));
  }

  return insights;
}
