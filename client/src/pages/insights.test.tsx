/*
 * `/insights` tests (T-034, FR-013, NFR-007): real GET /insights data, the 7d/30d range switch,
 * the accessible chart summary + table fallback, and the empty and error states. `fetch` is stubbed
 * at the transport boundary so the page exercises the real endpoint module and query hook.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';

import type { Insights } from '../api/types';
import { AuthContext } from '../auth/auth-context';
import { createTestQueryClient, makeAuthValue, makeUser } from '../test/test-utils';
import { InsightsPage } from './insights';

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {})),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function insights(overrides: Partial<Insights> = {}): Insights {
  return {
    range: '7d',
    timezone: 'Asia/Kolkata',
    totals: {
      focusMinutes: 320,
      sessions: 8,
      completed: 6,
      cancelled: 2,
      completionRate: 0.75,
      currentStreak: 4,
      longestStreak: 7,
    },
    daily: [
      { date: '2026-11-04', minutes: 20 },
      { date: '2026-11-05', minutes: 60 },
      { date: '2026-11-06', minutes: 40 },
      { date: '2026-11-07', minutes: 80 },
      { date: '2026-11-08', minutes: 0 },
      { date: '2026-11-09', minutes: 60 },
      { date: '2026-11-10', minutes: 60 },
    ],
    bestHours: [
      { hour: 9, minutes: 120 },
      { hour: 10, minutes: 90 },
      { hour: 9, minutes: 0 },
      { hour: 22, minutes: 0 },
    ],
    ...overrides,
  };
}

function success(data: unknown): unknown {
  return { success: true, data };
}

const AUTH = makeAuthValue({
  status: 'authenticated',
  user: makeUser({ id: '507f1f77bcf86cd799439012' }),
});

function renderInsights() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthContext.Provider value={AUTH}>
        <InsightsPage />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('InsightsPage', () => {
  it('renders totals, streaks, best hours and an accessible chart summary + table', async () => {
    installFetch(() => fakeResponse(success(insights())));
    renderInsights();

    expect(await screen.findByText('5 h 20 m')).toBeInTheDocument();
    expect(screen.getByText('75 %')).toBeInTheDocument();
    expect(screen.getByText('4 days')).toBeInTheDocument();
    expect(screen.getByText('Longest 7 days')).toBeInTheDocument();
    expect(screen.getAllByText('09:00–10:00').length).toBeGreaterThanOrEqual(1);

    // Achievements + device-local weekly goal are part of the success state.
    expect(screen.getByRole('heading', { name: 'Achievements', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Weekly goal', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Weekly goal' })).toHaveAttribute(
      'aria-valuenow',
      '300',
    );
    expect(screen.getByText('Goal is stored on this device only.')).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'Daily focus minutes', level: 2 }),
    ).toBeInTheDocument();

    // Plain-language summary for assistive tech.
    expect(
      screen.getByText(/Bar chart of daily focus minutes\. 320 focused minutes across 7 days\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/Best day: .* with 80 minutes\./)).toBeInTheDocument();

    // Table fallback carries the same numbers.
    expect(
      screen.getByRole('table', { name: /Focused minutes per day for the selected range/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Focused minutes' })).toBeInTheDocument();
  });

  it('switches to 30 days, requests that range and aggregates weekly bars', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch((url) =>
      fakeResponse(
        success(
          insights({
            range: url.includes('range=30d') ? '30d' : '7d',
            daily: [
              { date: '2026-10-19', minutes: 30 },
              { date: '2026-10-26', minutes: 45 },
            ],
          }),
        ),
      ),
    );

    renderInsights();
    await screen.findByText('5 h 20 m');

    await user.click(screen.getByRole('button', { name: '30 days' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('range=30d'))).toBe(
        true,
      );
    });
    expect(
      await screen.findByRole('heading', { name: 'Weekly focus minutes', level: 2 }),
    ).toBeInTheDocument();
    // The goal card reads the same payload: the latest weekly bucket is 45 minutes.
    expect(await screen.findByText('45 of 300 min')).toBeInTheDocument();
  });

  it('shows the empty state with "—" metrics and no chart', async () => {
    installFetch(() =>
      fakeResponse(
        success(
          insights({
            totals: {
              focusMinutes: 0,
              sessions: 0,
              completed: 0,
              cancelled: 0,
              completionRate: 0,
              currentStreak: 0,
              longestStreak: 0,
            },
            daily: [],
            bestHours: [],
          }),
        ),
      ),
    );

    renderInsights();

    expect(
      await screen.findByRole('heading', {
        name: 'No focus data for this range yet. Finish a session to see your progress.',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(
      screen.queryByRole('heading', { name: 'Daily focus minutes', level: 2 }),
    ).not.toBeInTheDocument();

    // Empty data must never fabricate badges or goal progress.
    expect(screen.queryByText('Earned')).not.toBeInTheDocument();
    expect(screen.getByText(/0 of 8/)).toBeInTheDocument();
    expect(screen.getByText(/No focus data in this range yet/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Weekly goal' })).toHaveAttribute(
      'aria-valuetext',
      '0 of 300 minutes this week',
    );
  });

  it('shows the error state with the code as a muted reference and retries', async () => {
    const user = userEvent.setup();
    let firstRequest = true;
    installFetch(() => {
      if (firstRequest) {
        firstRequest = false;
        return fakeResponse(
          { success: false, error: { code: 'INTERNAL', message: 'Aggregation failed' } },
          500,
        );
      }
      return fakeResponse(success(insights()));
    });

    renderInsights();

    expect(
      await screen.findByRole('heading', { name: "We couldn't load your insights." }),
    ).toBeInTheDocument();
    expect(screen.getByText('(Ref: INTERNAL)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('5 h 20 m')).toBeInTheDocument();
  });
});
