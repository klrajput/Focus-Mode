/*
 * Weekly goal tests (W10 / T-133): real progress math from payload fixtures, the localStorage
 * preference scoped per user id, the honest empty state and the progressbar role/values. The
 * component is rendered directly with an explicit `userId`, which is exactly what the page passes
 * from the authenticated user.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { InsightsDailyPoint } from '../../api/types';
import {
  DEFAULT_WEEKLY_GOAL,
  WeeklyGoalCard,
  computeWeeklyGoalProgress,
  readWeeklyGoal,
  weeklyGoalStorageKey,
  writeWeeklyGoal,
} from './weekly-goal';

const WEEK: InsightsDailyPoint[] = [
  { date: '2026-11-04', minutes: 20 },
  { date: '2026-11-05', minutes: 60 },
  { date: '2026-11-06', minutes: 40 },
  { date: '2026-11-07', minutes: 80 },
  { date: '2026-11-08', minutes: 0 },
  { date: '2026-11-09', minutes: 60 },
  { date: '2026-11-10', minutes: 60 },
];

beforeEach(() => {
  window.localStorage.clear();
});

describe('weekly goal progress', () => {
  it('sums the seven daily points for the 7-day range', () => {
    const progress = computeWeeklyGoalProgress(WEEK, '7d', 300);

    expect(progress.minutes).toBe(320);
    expect(progress.rawPercent).toBe(107);
    expect(progress.percent).toBe(100); // the bar is capped, the text is not
    expect(progress.periodLabel).toBe('Last 7 local days');
    expect(progress.hasData).toBe(true);
  });

  it('uses the latest weekly bucket for 30/90-day ranges', () => {
    const daily: InsightsDailyPoint[] = [
      { date: '2026-10-19', minutes: 30 },
      { date: '2026-10-26', minutes: 45 },
    ];

    const progress = computeWeeklyGoalProgress(daily, '30d', 120);

    expect(progress.minutes).toBe(45);
    expect(progress.rawPercent).toBe(38);
    expect(progress.percent).toBe(38);
    expect(progress.periodLabel.startsWith('Week of ')).toBe(true);
    expect(progress.hasData).toBe(true);
  });

  it('reports zero honestly when the range has no data', () => {
    const progress = computeWeeklyGoalProgress([], '7d', 600);

    expect(progress.minutes).toBe(0);
    expect(progress.percent).toBe(0);
    expect(progress.rawPercent).toBe(0);
    expect(progress.hasData).toBe(false);
  });

  it('reads only the three supported targets, falling back to the default', () => {
    window.localStorage.setItem(weeklyGoalStorageKey('user-a'), '999');
    expect(readWeeklyGoal('user-a')).toBe(DEFAULT_WEEKLY_GOAL);

    writeWeeklyGoal('user-a', 600);
    expect(readWeeklyGoal('user-a')).toBe(600);
  });
});

describe('WeeklyGoalCard', () => {
  it('renders the real progress, the device-local label and accessible progressbar semantics', () => {
    render(<WeeklyGoalCard daily={WEEK} range="7d" userId="user-a" />);

    expect(screen.getByRole('heading', { name: 'Weekly goal', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('320 of 300 min')).toBeInTheDocument();
    expect(screen.getByText(/5 h 20 m of 5 h · 107 % of goal/)).toBeInTheDocument();
    expect(screen.getByText('Goal is stored on this device only.')).toBeInTheDocument();
    expect(screen.getByText(/Goal reached for this period/)).toBeInTheDocument();

    const progressbar = screen.getByRole('progressbar', { name: 'Weekly goal' });
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '300');
    expect(progressbar).toHaveAttribute('aria-valuenow', '300');
    expect(progressbar).toHaveAttribute('aria-valuetext', '320 of 300 minutes this week');
  });

  it('shows an honest empty state with 0 m progress and no invented history', () => {
    render(<WeeklyGoalCard daily={[]} range="7d" userId="user-a" />);

    expect(screen.getByRole('progressbar', { name: 'Weekly goal' })).toHaveAttribute(
      'aria-valuetext',
      '0 of 300 minutes this week',
    );
    expect(screen.getByText(/No focus data in this range yet/)).toBeInTheDocument();
    expect(screen.getByText('0 of 300 min')).toBeInTheDocument();
  });

  it('persists the target per user and keeps two users apart', async () => {
    const user = userEvent.setup();
    const { rerender, unmount } = render(
      <WeeklyGoalCard daily={WEEK} range="7d" userId="user-a" />,
    );

    const select = screen.getByLabelText('Weekly goal target');
    expect(select).toHaveValue('300');

    await user.selectOptions(select, '600');
    expect(select).toHaveValue('600');
    expect(window.localStorage.getItem(weeklyGoalStorageKey('user-a'))).toBe('600');
    expect(window.localStorage.getItem(weeklyGoalStorageKey('user-b'))).toBeNull();

    // Switching accounts on the same browser must not carry the goal over.
    rerender(<WeeklyGoalCard daily={WEEK} range="7d" userId="user-b" />);
    expect(screen.getByLabelText('Weekly goal target')).toHaveValue('300');
    expect(window.localStorage.getItem(weeklyGoalStorageKey('user-b'))).toBeNull();

    // Re-mounting the first account reads its own persisted target back.
    unmount();
    render(<WeeklyGoalCard daily={WEEK} range="7d" userId="user-a" />);
    expect(screen.getByLabelText('Weekly goal target')).toHaveValue('600');
    expect(readWeeklyGoal('user-a')).toBe(600);
  });

  it('does not persist a goal when there is no signed-in user', async () => {
    const user = userEvent.setup();
    render(<WeeklyGoalCard daily={WEEK} range="7d" userId={null} />);

    await user.selectOptions(screen.getByLabelText('Weekly goal target'), '120');
    expect(screen.getByLabelText('Weekly goal target')).toHaveValue('120');
    expect(window.localStorage.length).toBe(0);
  });
});
