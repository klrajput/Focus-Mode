/*
 * Route-level lazy-loading tests (W7 / task-48).
 *
 * The page tests import page components directly, so they do not exercise the `React.lazy` +
 * `Suspense` boundary at all. This file renders the real `AppRoutes` inside a MemoryRouter:
 *   · a public route (`/`) resolves its lazy chunk and paints the real heading;
 *   · an authenticated lazy route (`/insights`, the Recharts page) resolves without unmounting the
 *     eager AppShell, so navigation stays visible while the chunk loads;
 *   · the eager `/dashboard` still renders through the same route table;
 *   · the Suspense fallback is an accessible status region with stable height (NFR-008).
 * Every assertion after navigation uses `findBy` because the page module now loads asynchronously.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { AgentLinkContext } from '../agent/agent-link-provider';
import { AuthContext } from '../auth/auth-context';
import {
  createTestQueryClient,
  makeAgentLinkValue,
  makeAuthValue,
  makeUser,
} from '../test/test-utils';
import { AppRoutes } from './app-routes';
import { RouteFallback } from './route-fallback';

const USER = makeUser({ timezone: 'Asia/Kolkata', defaultDurationMin: 25 });

const INSIGHTS = {
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
    { date: '2026-11-09', minutes: 60 },
    { date: '2026-11-10', minutes: 60 },
  ],
  bestHours: [{ hour: 9, minutes: 120 }],
};

function pageBody(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: true, data }),
  } as Response;
}

function page(items: unknown[]): Response {
  return pageBody({ items, page: 1, limit: 20, total: items.length, totalPages: 1 });
}

/** Stub exactly the requests the route under test makes (anything else is a bug, not a pass). */
function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/notifications')) return Promise.resolve(page([]));
      if (url.includes('/insights')) return Promise.resolve(pageBody(INSIGHTS));
      if (url.includes('/agent-links')) return Promise.resolve(page([]));
      if (url.includes('/sessions')) return Promise.resolve(page([]));
      if (url.includes('/schedules')) return Promise.resolve(page([]));
      throw new Error(`unexpected request: ${url}`);
    }),
  );
}

function renderRoute(path: string, authenticated: boolean) {
  const auth = authenticated
    ? makeAuthValue({ status: 'authenticated', user: USER })
    : makeAuthValue({ status: 'anonymous', user: null });

  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthContext.Provider value={auth}>
          <AgentLinkContext.Provider value={makeAgentLinkValue({ status: 'PAIRED' })}>
            <AppRoutes />
          </AgentLinkContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('route-level code splitting', () => {
  it('renders the lazy landing page on the public root route', async () => {
    installFetch();
    renderRoute('/', false);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Focus on one thing.' }),
    ).toBeInTheDocument();
  });

  it('renders the eager dashboard through the real route table', async () => {
    installFetch();
    renderRoute('/dashboard', true);

    expect(await screen.findByRole('heading', { level: 1, name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Insights' })).toBeInTheDocument();
  });

  it('resolves the lazy Recharts insights route without unmounting the shell', async () => {
    installFetch();
    renderRoute('/insights', true);

    // The shell is eager: its navigation is already painted while the page chunk is in flight.
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();

    expect(await screen.findByRole('heading', { level: 1, name: 'Insights' })).toBeInTheDocument();
    expect(await screen.findByText('Daily focus minutes')).toBeInTheDocument();
    // The shell survives the Suspense boundary that wraps only the <Outlet /> page.
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });

  it('exposes the Suspense fallback as a single accessible status region', () => {
    render(<RouteFallback />);

    const status = screen.getAllByRole('status');
    expect(status).toHaveLength(1);
    expect(status[0]).toHaveTextContent('Loading page…');
    expect(status[0]).toHaveAttribute('aria-live', 'polite');
  });
});
