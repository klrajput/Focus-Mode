/*
 * Achievements tests (W10 / T-133): every badge rule is checked just below and exactly at its
 * threshold, locked badges expose the threshold in text + an accessible name, and an empty payload
 * can never unlock anything. The evaluator is pure, so the boundaries are tested directly before
 * the rendered list semantics are asserted.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import type { Insights, InsightsBestHour, InsightsTotals } from '../../api/types';
import { Achievements, evaluateAchievements } from './achievements';

const ZERO_TOTALS: InsightsTotals = {
  focusMinutes: 0,
  sessions: 0,
  completed: 0,
  cancelled: 0,
  completionRate: 0,
  currentStreak: 0,
  longestStreak: 0,
};

function insights(overrides: Partial<Insights> = {}): Insights {
  return {
    range: '7d',
    timezone: 'Asia/Kolkata',
    totals: ZERO_TOTALS,
    daily: [],
    bestHours: [],
    ...overrides,
  };
}

function withTotals(patch: Partial<InsightsTotals>): Insights {
  return insights({ totals: { ...ZERO_TOTALS, ...patch } });
}

function withHours(bestHours: InsightsBestHour[]): Insights {
  return insights({ bestHours });
}

function unlockedIds(payload: Insights): string[] {
  return evaluateAchievements(payload)
    .filter((badge) => badge.unlocked)
    .map((badge) => badge.id);
}

describe('achievement rules', () => {
  it('First focus unlocks at completed >= 1, not at 0', () => {
    expect(unlockedIds(withTotals({ sessions: 1, completed: 0 }))).not.toContain('first-focus');
    expect(unlockedIds(withTotals({ sessions: 1, completed: 1 }))).toContain('first-focus');
  });

  it('Streak starter unlocks at a 3-day current or longest streak, not at 2', () => {
    expect(unlockedIds(withTotals({ currentStreak: 2, longestStreak: 2 }))).not.toContain(
      'streak-starter',
    );
    expect(unlockedIds(withTotals({ currentStreak: 3, longestStreak: 1 }))).toContain(
      'streak-starter',
    );
    // The longest streak counts even when the current one ended.
    expect(unlockedIds(withTotals({ currentStreak: 1, longestStreak: 3 }))).toContain(
      'streak-starter',
    );
  });

  it('Week warrior unlocks at a 7-day streak, not at 6', () => {
    expect(unlockedIds(withTotals({ currentStreak: 6, longestStreak: 6 }))).not.toContain(
      'week-warrior',
    );
    expect(unlockedIds(withTotals({ currentStreak: 7, longestStreak: 7 }))).toContain(
      'week-warrior',
    );
  });

  it('Consistent unlocks at a 30-day streak, not at 29', () => {
    expect(unlockedIds(withTotals({ currentStreak: 29, longestStreak: 29 }))).not.toContain(
      'consistent',
    );
    expect(unlockedIds(withTotals({ currentStreak: 30, longestStreak: 30 }))).toContain(
      'consistent',
    );
  });

  it('Ten hours unlocks at 600 focused minutes, not at 599', () => {
    expect(unlockedIds(withTotals({ focusMinutes: 599 }))).not.toContain('ten-hours');
    expect(unlockedIds(withTotals({ focusMinutes: 600 }))).toContain('ten-hours');
  });

  it('Fifty sessions unlocks at 50 sessions, not at 49', () => {
    expect(unlockedIds(withTotals({ sessions: 49 }))).not.toContain('fifty-sessions');
    expect(unlockedIds(withTotals({ sessions: 50 }))).toContain('fifty-sessions');
  });

  it('Early bird unlocks when the peak best-focus hour is 08:00 or earlier, not at 09:00', () => {
    expect(unlockedIds(withHours([{ hour: 9, minutes: 90 }]))).not.toContain('early-bird');
    expect(unlockedIds(withHours([{ hour: 8, minutes: 90 }]))).toContain('early-bird');
    // A later hour wins the peak, so an earlier low-minute hour does not unlock it.
    expect(
      unlockedIds(
        withHours([
          { hour: 8, minutes: 10 },
          { hour: 14, minutes: 90 },
        ]),
      ),
    ).not.toContain('early-bird');
    // A zero-minute entry is not focus data.
    expect(unlockedIds(withHours([{ hour: 8, minutes: 0 }]))).not.toContain('early-bird');
  });

  it('Night owl unlocks when the peak best-focus hour is 22:00 or later, not at 21:00', () => {
    expect(unlockedIds(withHours([{ hour: 21, minutes: 90 }]))).not.toContain('night-owl');
    expect(unlockedIds(withHours([{ hour: 22, minutes: 90 }]))).toContain('night-owl');
    expect(unlockedIds(withHours([{ hour: 22, minutes: 0 }]))).not.toContain('night-owl');
  });

  it('returns all eight badges in a stable order', () => {
    expect(evaluateAchievements(insights()).map((badge) => badge.id)).toEqual([
      'first-focus',
      'streak-starter',
      'week-warrior',
      'consistent',
      'ten-hours',
      'fifty-sessions',
      'early-bird',
      'night-owl',
    ]);
  });

  it('never unlocks a badge from an empty payload', () => {
    const badges = evaluateAchievements(insights());
    expect(badges).toHaveLength(8);
    expect(badges.every((badge) => badge.unlocked === false)).toBe(true);
    expect(unlockedIds(insights())).toEqual([]);
  });
});

describe('Achievements list', () => {
  it('renders locked badges with the threshold in text and an accessible name', () => {
    render(<Achievements insights={insights()} />);

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);

    const streak = screen.getByRole('listitem', {
      name: 'Streak starter: locked, requires Reach a 3-day streak.',
    });
    expect(within(streak).getByText('Reach a 3-day streak.')).toBeInTheDocument();
    expect(within(streak).getByText('Locked')).toBeInTheDocument();
    expect(within(streak).queryByText('Earned')).not.toBeInTheDocument();
    expect(screen.getByText(/Finish a session to unlock your first badge/)).toBeInTheDocument();
    expect(screen.getByText(/0 of 8/)).toBeInTheDocument();
  });

  it('marks threshold badges as earned with calm text (no colour-only meaning)', () => {
    render(
      <Achievements
        insights={withTotals({
          completed: 1,
          currentStreak: 7,
          longestStreak: 7,
          focusMinutes: 600,
          sessions: 50,
        })}
      />,
    );

    const firstFocus = screen.getByRole('listitem', { name: 'First focus: earned' });
    expect(within(firstFocus).getByText('Earned')).toBeInTheDocument();
    expect(
      within(firstFocus).getByText('You finished your first focus session in this range.'),
    ).toBeInTheDocument();

    expect(screen.getByRole('listitem', { name: 'Week warrior: earned' })).toBeInTheDocument();
    expect(screen.getByText(/5 of 8/)).toBeInTheDocument();
    // Early bird / Night owl stay locked: the empty best-hours payload is not evidence.
    expect(screen.getByRole('listitem', { name: /Early bird: locked/ })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /Night owl: locked/ })).toBeInTheDocument();
  });

  it('renders no earned badge and no celebratory copy from a fabricated/empty payload', () => {
    render(<Achievements insights={insights()} />);

    expect(screen.queryByText('Earned')).not.toBeInTheDocument();
    expect(screen.queryByText(/You finished your first focus session/)).not.toBeInTheDocument();
    expect(screen.getByText(/0 of 8/)).toBeInTheDocument();
  });
});
