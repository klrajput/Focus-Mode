/*
 * Achievements — calm badges for `/insights` (W10 / T-133, FR-018 partial per DEC-027).
 *
 * Every badge is derived from the real `GET /insights` payload for the selected range. There is
 * no badge store, no server write and no optimistic "earned" state: if the payload says a
 * threshold is not met, the badge stays locked with the exact threshold in text. Leaderboards and
 * comparisons between users are explicitly out of scope (DEC-027) — nothing here ranks people.
 *
 * Rules (each threshold is a `>=` on a value the API already returns):
 *   · First focus    — `totals.completed >= 1` (a finished session exists in this range).
 *   · Streak starter — `max(currentStreak, longestStreak) >= 3`.
 *   · Week warrior   — `max(currentStreak, longestStreak) >= 7`.
 *   · Consistent     — `max(currentStreak, longestStreak) >= 30`.
 *   · Ten hours      — `totals.focusMinutes >= 600` (focused minutes, never planned minutes).
 *   · Fifty sessions — `totals.sessions >= 50`.
 *   · Early bird     — the peak best-focus hour (the entry with the most minutes, minutes > 0) is
 *                      at or before 08:00, i.e. `peak.hour <= 8`.
 *   · Night owl      — that same peak hour is at or after 22:00, i.e. `peak.hour >= 22`.
 * Early bird / Night owl deliberately require `minutes > 0`, so an empty payload can never unlock
 * them through a zero-minute placeholder hour.
 */

import { Award, Lock } from 'lucide-react';

import type { Insights, InsightsBestHour } from '../../api/types';
import { cn } from '../../lib/cn';
import { Card, CardBody, CardHeader } from '../ui/card';

export interface AchievementBadge {
  id:
    | 'first-focus'
    | 'streak-starter'
    | 'week-warrior'
    | 'consistent'
    | 'ten-hours'
    | 'fifty-sessions'
    | 'early-bird'
    | 'night-owl';
  /** Short badge title, e.g. "First focus". */
  name: string;
  /** What the user did, shown only when unlocked. */
  earnedDescription: string;
  /** The exact threshold, shown when locked (never a vague "keep going"). */
  requirement: string;
  unlocked: boolean;
}

/** The hour where most focused minutes landed; zero-minute entries never win. */
function peakHourOf(bestHours: readonly InsightsBestHour[]): InsightsBestHour | undefined {
  return bestHours.reduce<InsightsBestHour | undefined>((peak, entry) => {
    if (entry.minutes <= 0) return peak;
    return peak === undefined || entry.minutes > peak.minutes ? entry : peak;
  }, undefined);
}

/**
 * Evaluate every badge from the payload alone. The order is stable so the list never reshuffles
 * between renders, and all eight badges are always returned (locked ones included) — hiding a
 * locked badge would make progress impossible to understand.
 */
export function evaluateAchievements(insights: Insights): AchievementBadge[] {
  const { totals } = insights;
  // A streak is "started" by either the live streak or the best one in the range; the API exposes
  // both, so use the larger value rather than guessing which one the user cares about.
  const bestStreak = Math.max(totals.currentStreak, totals.longestStreak);
  const peakHour = peakHourOf(insights.bestHours);
  const peakHourMinutes = peakHour?.minutes ?? 0;

  return [
    // First focus — completed >= 1. A cancelled session is not an achievement.
    {
      id: 'first-focus',
      name: 'First focus',
      earnedDescription: 'You finished your first focus session in this range.',
      requirement: 'Finish at least 1 focus session.',
      unlocked: totals.completed >= 1,
    },
    // Streak starter — max(current, longest) >= 3.
    {
      id: 'streak-starter',
      name: 'Streak starter',
      earnedDescription: 'You focused on 3 days in a row.',
      requirement: 'Reach a 3-day streak.',
      unlocked: bestStreak >= 3,
    },
    // Week warrior — max(current, longest) >= 7.
    {
      id: 'week-warrior',
      name: 'Week warrior',
      earnedDescription: 'You focused on 7 days in a row.',
      requirement: 'Reach a 7-day streak.',
      unlocked: bestStreak >= 7,
    },
    // Consistent — max(current, longest) >= 30.
    {
      id: 'consistent',
      name: 'Consistent',
      earnedDescription: 'You focused on 30 days in a row.',
      requirement: 'Reach a 30-day streak.',
      unlocked: bestStreak >= 30,
    },
    // Ten hours — focusMinutes >= 600 (focused minutes; `actualMinutes` on the server).
    {
      id: 'ten-hours',
      name: 'Ten hours',
      earnedDescription: 'You focused for 10 hours in this range.',
      requirement: 'Focus for 10 hours.',
      unlocked: totals.focusMinutes >= 600,
    },
    // Fifty sessions — sessions >= 50, whatever their status; this is the session count the page
    // already shows next to focused time.
    {
      id: 'fifty-sessions',
      name: 'Fifty sessions',
      earnedDescription: 'You logged 50 focus sessions in this range.',
      requirement: 'Log 50 focus sessions.',
      unlocked: totals.sessions >= 50,
    },
    // Early bird — the peak best-focus hour is 08:00 or earlier and has real minutes.
    {
      id: 'early-bird',
      name: 'Early bird',
      earnedDescription: 'Your best focus hour starts at 08:00 or earlier.',
      requirement: 'Make an hour from 00:00–08:59 your best focus hour.',
      unlocked: peakHour !== undefined && peakHourMinutes > 0 && peakHour.hour <= 8,
    },
    // Night owl — the peak best-focus hour is 22:00 or later and has real minutes.
    {
      id: 'night-owl',
      name: 'Night owl',
      earnedDescription: 'Your best focus hour starts at 22:00 or later.',
      requirement: 'Make an hour from 22:00–23:59 your best focus hour.',
      unlocked: peakHour !== undefined && peakHourMinutes > 0 && peakHour.hour >= 22,
    },
  ];
}

function BadgeItem({ badge }: { badge: AchievementBadge }) {
  const Icon = badge.unlocked ? Award : Lock;
  const ariaLabel = badge.unlocked
    ? `${badge.name}: earned`
    : `${badge.name}: locked, requires ${badge.requirement}`;

  return (
    <li
      aria-label={ariaLabel}
      className={cn(
        'flex min-w-0 gap-3 rounded-[var(--radius-control)] border p-3',
        badge.unlocked ? 'border-focus-strong bg-focus-subtle' : 'border-border bg-surface',
      )}
    >
      <span
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-pill)]',
          badge.unlocked ? 'bg-card text-focus-strong' : 'bg-skeleton text-disabled-text',
        )}
      >
        <Icon aria-hidden="true" className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-[15px] leading-[1.35] font-medium break-words text-ink">{badge.name}</p>
        <p
          className={cn(
            'mt-0.5 text-[13px] leading-[1.45]',
            badge.unlocked ? 'text-focus-strong' : 'text-muted',
          )}
        >
          {badge.unlocked ? badge.earnedDescription : badge.requirement}
        </p>
        <p
          className={cn(
            'mt-1 text-[13px] font-medium',
            badge.unlocked ? 'text-focus-strong' : 'text-disabled-text',
          )}
        >
          {badge.unlocked ? 'Earned' : 'Locked'}
        </p>
      </div>
    </li>
  );
}

export function Achievements({ insights }: { insights: Insights }) {
  const badges = evaluateAchievements(insights);
  const earnedCount = badges.filter((badge) => badge.unlocked).length;

  return (
    <Card ariaLabelledBy="achievements-heading">
      <CardHeader
        title="Achievements"
        titleId="achievements-heading"
        description="Earned from finished sessions in the selected range — nothing is estimated."
      />
      <CardBody>
        <p className="text-[15px] text-ink">
          <span className="font-medium">
            {earnedCount} of {badges.length}
          </span>{' '}
          earned
          {earnedCount === 0 ? ' in this range yet.' : '.'}
        </p>
        {earnedCount === 0 ? (
          <p className="mt-1 text-[13px] leading-[1.45] text-muted">
            Finish a session to unlock your first badge. Each badge below shows the threshold it
            needs, based only on the numbers above.
          </p>
        ) : null}

        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {badges.map((badge) => (
            <BadgeItem key={badge.id} badge={badge} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
