/*
 * Weekly goal — a device-local target for `/insights` (W10 / T-133 partial, DEC-027).
 *
 * The target is a preference, not server data: it lives in `localStorage` under a key that includes
 * the signed-in user id, so two accounts on the same browser never share a goal, and the UI says
 * "Goal is stored on this device" in plain words. Nothing about the goal is written to the API.
 *
 * Progress is always real:
 *   · 7-day payload → sum the seven daily points the API returned.
 *   · 30/90-day payload → reuse the same Monday-based weekly buckets as the chart and read the
 *     most recent (current) week; there is no second aggregation definition in this file.
 * If a range has no minutes, the card stays honest: 0 m of the target with an empty caption and no
 * invented history. The bar is capped visually at 100 % but the text keeps the uncapped percentage.
 */

import { useEffect, useState, type ChangeEvent } from 'react';
import { HardDrive } from 'lucide-react';
import type { InsightsRange } from '@focus-mode/shared';

import type { InsightsDailyPoint } from '../../api/types';
import { formatMinutes } from '../../lib/format';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Select } from '../ui/select';
import { buildChartSeries } from './focus-chart';

export const WEEKLY_GOAL_TARGETS = [120, 300, 600] as const;
export type WeeklyGoalTarget = (typeof WEEKLY_GOAL_TARGETS)[number];

export const DEFAULT_WEEKLY_GOAL: WeeklyGoalTarget = 300;

/** Per-user key prefix; the full key is `focus-mode.weekly-goal.<userId>`. */
export const WEEKLY_GOAL_STORAGE_PREFIX = 'focus-mode.weekly-goal.';

export function weeklyGoalStorageKey(userId: string): string {
  return `${WEEKLY_GOAL_STORAGE_PREFIX}${userId}`;
}

/** localStorage is not guaranteed (private mode / disabled storage); never throw for a preference. */
function localStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Only the three frozen targets are accepted; anything else falls back to the default. */
export function parseWeeklyGoal(value: string | null): WeeklyGoalTarget | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return WEEKLY_GOAL_TARGETS.find((target) => target === parsed) ?? null;
}

export function readWeeklyGoal(
  userId: string | null,
  store: Storage | null = localStore(),
): WeeklyGoalTarget {
  if (userId === null || store === null) return DEFAULT_WEEKLY_GOAL;
  try {
    return parseWeeklyGoal(store.getItem(weeklyGoalStorageKey(userId))) ?? DEFAULT_WEEKLY_GOAL;
  } catch {
    return DEFAULT_WEEKLY_GOAL;
  }
}

export function writeWeeklyGoal(
  userId: string,
  target: WeeklyGoalTarget,
  store: Storage | null = localStore(),
): void {
  if (store === null) return;
  try {
    store.setItem(weeklyGoalStorageKey(userId), String(target));
  } catch {
    // A blocked write must not break the page; the in-memory target still applies this session.
  }
}

export interface WeeklyGoalProgress {
  /** Focused minutes in the measured period, from the API payload only. */
  minutes: number;
  target: WeeklyGoalTarget;
  /** Bar width, 0–100 (capped so the fill never overflows its track). */
  percent: number;
  /** Uncapped percentage for the text; overachieving is shown, never hidden. */
  rawPercent: number;
  /** Which real period the minutes cover, e.g. "Last 7 local days". */
  periodLabel: string;
  /** True when the payload actually contains focused minutes. */
  hasData: boolean;
}

/**
 * Progress for the selected range. The 30/90-day responses only carry daily points, so the same
 * weekly bucketing as the chart is reused and the latest week is treated as "this week".
 */
export function computeWeeklyGoalProgress(
  daily: readonly InsightsDailyPoint[],
  range: InsightsRange,
  target: WeeklyGoalTarget,
): WeeklyGoalProgress {
  let minutes: number;
  let periodLabel: string;

  if (range === '7d') {
    minutes = daily.reduce((sum, point) => sum + point.minutes, 0);
    periodLabel = 'Last 7 local days';
  } else {
    const series = buildChartSeries(daily, range);
    const currentWeek = series.points.at(-1);
    minutes = currentWeek?.minutes ?? 0;
    periodLabel = currentWeek === undefined ? 'Current week' : currentWeek.longLabel;
  }

  const safeMinutes = Math.max(0, Math.round(minutes));
  const rawPercent = Math.round((safeMinutes / target) * 100);

  return {
    minutes: safeMinutes,
    target,
    percent: Math.min(100, rawPercent),
    rawPercent,
    periodLabel,
    hasData: safeMinutes > 0,
  };
}

export interface WeeklyGoalCardProps {
  daily: readonly InsightsDailyPoint[];
  range: InsightsRange;
  /** Signed-in user id; `null` means the goal is not persisted (no account to scope it to). */
  userId: string | null;
}

export function WeeklyGoalCard({ daily, range, userId }: WeeklyGoalCardProps) {
  const [target, setTarget] = useState<WeeklyGoalTarget>(() => readWeeklyGoal(userId));
  const progress = computeWeeklyGoalProgress(daily, range, target);
  const reached = progress.minutes >= target;

  // Re-read when the signed-in user changes so a goal never follows the previous account.
  useEffect(() => {
    setTarget(readWeeklyGoal(userId));
  }, [userId]);

  function handleTargetChange(event: ChangeEvent<HTMLSelectElement>): void {
    const next = parseWeeklyGoal(event.target.value);
    if (next === null) return;
    setTarget(next);
    if (userId !== null) writeWeeklyGoal(userId, next);
  }

  return (
    <Card ariaLabelledBy="weekly-goal-heading">
      <CardHeader
        title="Weekly goal"
        titleId="weekly-goal-heading"
        description={`${progress.periodLabel} · finished sessions only`}
      />
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[24px] leading-[1.2] font-semibold tabular-nums text-ink">
              {progress.minutes} of {target} min
            </p>
            <p className="mt-1 text-[13px] text-muted">
              {formatMinutes(progress.minutes)} of {formatMinutes(target)} · {progress.rawPercent} %
              of goal
            </p>
          </div>
          <div className="w-full sm:w-60">
            <Select
              label="Weekly goal target"
              value={String(target)}
              onChange={handleTargetChange}
              hint="Only this browser remembers it."
            >
              {WEEKLY_GOAL_TARGETS.map((option) => (
                <option key={option} value={option}>
                  {formatMinutes(option)} a week ({option} min)
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div
          role="progressbar"
          aria-labelledby="weekly-goal-heading"
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={Math.min(progress.minutes, target)}
          aria-valuetext={`${progress.minutes} of ${target} minutes this week`}
          className="mt-4 h-2 w-full overflow-hidden rounded-[var(--radius-pill)] bg-skeleton"
        >
          <div
            aria-hidden="true"
            className="h-full rounded-[var(--radius-pill)] bg-focus-strong"
            style={{ width: `${progress.percent}%` }}
          />
        </div>

        <p className="mt-3 text-[13px] leading-[1.45] text-muted">
          {progress.minutes === 0
            ? 'No focus data in this range yet — your progress starts at 0 m and nothing is back-filled.'
            : reached
              ? 'Goal reached for this period. Minutes beyond the goal still count.'
              : `${formatMinutes(target - progress.minutes)} to go.`}
        </p>

        <p className="mt-1 flex items-center gap-1.5 text-[13px] leading-[1.45] text-muted">
          <HardDrive aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>Goal is stored on this device only.</span>
        </p>
      </CardBody>
    </Card>
  );
}
