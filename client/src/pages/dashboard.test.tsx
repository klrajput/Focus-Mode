/*
 * `/dashboard` tests (T-065, FR-010/FR-013, NFR-007): the Today card reads COMPLETED sessions from
 * the user's local day and the next enabled schedule in their IANA timezone; recent sessions show
 * planned vs focused minutes and link to /insights. `fetch` is stubbed at the transport boundary, so
 * the page exercises the real API modules and TanStack Query wiring. Every widget is checked in its
 * loading, empty, error and success state.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { AgentLinkContext } from '../agent/agent-link-provider';
import type { FocusSession, Schedule } from '../api/types';
import { AuthContext } from '../auth/auth-context';
import {
  createTestQueryClient,
  makeAgentLinkValue,
  makeAuthValue,
  makeUser,
} from '../test/test-utils';
import { DashboardPage } from './dashboard';

const USER = makeUser({ timezone: 'Asia/Kolkata' });

function makeSession(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: '507f1f77bcf86cd799439020',
    deviceId: '507f1f77bcf86cd799439011',
    startedAt: '2026-11-10T04:00:00.000Z',
    endedAt: '2026-11-10T05:00:00.000Z',
    plannedMinutes: 60,
    actualMinutes: 60,
    status: 'COMPLETED',
    source: 'MANUAL',
    clientSessionId: '9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c',
    endReason: 'COMPLETED',
    lastHeartbeatAt: '2026-11-10T04:59:00.000Z',
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: '507f1f77bcf86cd799439030',
    name: 'Coding block',
    days: [1, 2, 3, 4, 5],
    startTime: '09:00',
    durationMin: 60,
    enabled: true,
    lastRunAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

function page<T>(items: T[]) {
  return {
    success: true,
    data: { items, page: 1, limit: 20, total: items.length, totalPages: 1 },
  };
}

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

interface StubData {
  today: FocusSession[];
  recent: FocusSession[];
  schedules: Schedule[];
}

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {})),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Route the real API module paths; the today query is the only `/sessions` call with a status. */
function installStub(overrides: Partial<StubData> = {}): StubData {
  const data: StubData = {
    today: [makeSession({ id: '507f1f77bcf86cd799439021', actualMinutes: 60 })],
    recent: [makeSession()],
    schedules: [makeSchedule()],
    ...overrides,
  };

  installFetch((url) => {
    if (url.includes('/sessions')) {
      if (url.includes('status=COMPLETED')) return fakeResponse(page(data.today));
      return fakeResponse(page(data.recent));
    }
    if (url.includes('/schedules')) return fakeResponse(page(data.schedules));
    if (url.includes('/allowlist')) {
      return fakeResponse({
        success: true,
        data: { protectedApps: [], userApps: [], version: 1 },
      });
    }
    if (url.includes('/devices')) return fakeResponse(page([]));
    throw new Error(`Unexpected dashboard request: ${url}`);
  });

  return data;
}

function renderDashboard() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <AuthContext.Provider value={makeAuthValue({ status: 'authenticated', user: USER })}>
          <AgentLinkContext.Provider value={makeAgentLinkValue()}>
            <DashboardPage />
          </AgentLinkContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DashboardPage — Today', () => {
  it('sums focused minutes from completed sessions and shows the next schedule in the user timezone', async () => {
    installStub({
      today: [
        makeSession({ id: 'a'.repeat(24), actualMinutes: 60 }),
        makeSession({ id: 'b'.repeat(24), actualMinutes: 25 }),
      ],
      schedules: [
        makeSchedule(),
        makeSchedule({ id: 'c'.repeat(24), name: 'Ignored block', enabled: false }),
      ],
    });

    renderDashboard();

    // 60 + 25 focused minutes (actualMinutes), never the planned value.
    expect(await screen.findByText('1 h 25 m')).toBeInTheDocument();
    expect(screen.getByText('2 completed sessions today')).toBeInTheDocument();
    expect(
      screen.getByText(/Focused time and your next schedule, in Asia\/Kolkata/),
    ).toBeInTheDocument();

    expect(await screen.findByText('Coding block')).toBeInTheDocument();
    expect(screen.getByText(/09:00 · 60 m · Asia\/Kolkata/)).toBeInTheDocument();
    expect(screen.queryByText('Ignored block')).not.toBeInTheDocument();
  });

  it('shows loading states for all three cards while the requests are pending', () => {
    installFetch(() => new Promise<Response>(() => undefined));

    renderDashboard();

    expect(screen.getByText("Loading today's focus time…")).toBeInTheDocument();
    expect(screen.getByText('Loading your next scheduled session…')).toBeInTheDocument();
    expect(screen.getByText('Loading your recent sessions…')).toBeInTheDocument();
  });

  it('shows honest empty states when nothing is completed or scheduled', async () => {
    installStub({ today: [], recent: [], schedules: [] });

    renderDashboard();

    expect(await screen.findByText('No focus time yet today.')).toBeInTheDocument();
    expect(screen.getByText('No enabled schedules yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a schedule' })).toHaveAttribute(
      'href',
      '/schedules',
    );
    expect(
      screen.getByRole('heading', {
        name: 'No focus sessions yet. Your first session will show up here.',
      }),
    ).toBeInTheDocument();
  });

  it('keeps the page usable when one widget fails and retries only that widget', async () => {
    const user = userEvent.setup();
    let todayFails = true;

    const data: StubData = {
      today: [makeSession({ actualMinutes: 45 })],
      recent: [makeSession({ actualMinutes: 30 })],
      schedules: [makeSchedule()],
    };

    installFetch((url) => {
      if (url.includes('/sessions')) {
        if (url.includes('status=COMPLETED') && todayFails) {
          return fakeResponse(
            { success: false, error: { code: 'INTERNAL', message: 'Database unavailable' } },
            500,
          );
        }
        return fakeResponse(page(url.includes('status=COMPLETED') ? data.today : data.recent));
      }
      if (url.includes('/schedules')) {
        return fakeResponse(
          { success: false, error: { code: 'INTERNAL', message: 'Database unavailable' } },
          500,
        );
      }
      if (url.includes('/allowlist')) {
        return fakeResponse({
          success: true,
          data: { protectedApps: [], userApps: [], version: 1 },
        });
      }
      return fakeResponse(page([]));
    });

    renderDashboard();

    // Two failed widgets, each with its own Retry; the recent-sessions card still rendered.
    expect(await screen.findAllByText("We couldn't load your dashboard.")).toHaveLength(2);
    expect(await screen.findByText(/Planned 60 m · Focused 30 m/)).toBeInTheDocument();

    const [todayRetry] = screen.getAllByRole('button', { name: 'Retry' });
    if (todayRetry === undefined) throw new Error('Today retry button not rendered');
    todayFails = false;
    await user.click(todayRetry);

    expect(await screen.findByText('45 m')).toBeInTheDocument();
    expect(screen.getAllByText("We couldn't load your dashboard.")).toHaveLength(1);
  });
});

describe('DashboardPage — Recent sessions', () => {
  it('lists planned vs focused minutes, status, source and the insights link', async () => {
    installStub({
      recent: [
        makeSession({
          id: '507f1f77bcf86cd799439022',
          status: 'CANCELLED',
          plannedMinutes: 60,
          actualMinutes: 20,
          source: 'SCHEDULE',
        }),
      ],
      today: [],
    });

    renderDashboard();

    expect(await screen.findByText('Planned 60 m · Focused 20 m')).toBeInTheDocument();
    expect(screen.getByText(/· Schedule/)).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'View insights' });
    expect(link).toHaveAttribute('href', '/insights');
  });

  it('shows the recent-sessions error with a working Retry', async () => {
    const user = userEvent.setup();
    let recentFails = true;

    installFetch((url) => {
      if (url.includes('/sessions')) {
        if (!url.includes('status=COMPLETED') && recentFails) {
          return fakeResponse(
            { success: false, error: { code: 'INTERNAL', message: 'Database unavailable' } },
            500,
          );
        }
        return fakeResponse(page([makeSession()]));
      }
      if (url.includes('/schedules')) return fakeResponse(page([makeSchedule()]));
      if (url.includes('/allowlist')) {
        return fakeResponse({
          success: true,
          data: { protectedApps: [], userApps: [], version: 1 },
        });
      }
      return fakeResponse(page([]));
    });

    renderDashboard();

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('The recent sessions could not be fetched.'),
    ).toBeInTheDocument();
    expect(within(alert).getByText('(Ref: INTERNAL)')).toBeInTheDocument();

    recentFails = false;
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/Planned 60 m · Focused 60 m/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
