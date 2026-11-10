/*
 * NotificationBell tests (T-034, FR-025, NFR-007): the real unread count from GET /notifications,
 * the panel's recent items, marking one read through PATCH /notifications/:id/read and the empty
 * state. Fetch is stubbed at the transport boundary.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';

import type { NotificationItem } from '../../api/types';
import { createTestQueryClient } from '../../test/test-utils';
import { NotificationBell } from './notification-bell';

const UNREAD: NotificationItem = {
  id: '507f1f77bcf86cd799439031',
  type: 'SCHEDULE_MISSED',
  message: 'Your 09:00 Coding block was missed — no Focus Agent was connected.',
  readAt: null,
  createdAt: '2026-11-11T09:00:00.000Z',
};

const READ: NotificationItem = {
  id: '507f1f77bcf86cd799439032',
  type: 'SCHEDULE_MISSED',
  message: 'Your 19:00 Pomodoro hour was missed.',
  readAt: '2026-11-10T19:10:00.000Z',
  createdAt: '2026-11-10T19:00:00.000Z',
};

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function pageOf(items: NotificationItem[]): unknown {
  return {
    success: true,
    data: { items, page: 1, limit: 20, total: items.length, totalPages: 1 },
  };
}

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {})),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderBell() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <NotificationBell />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NotificationBell', () => {
  it('shows the unread count, lists recent items and marks one read', async () => {
    const user = userEvent.setup();
    let items = [UNREAD, READ];
    const fetchMock = installFetch((url, init) => {
      if (url.includes('/notifications/') && (init.method ?? 'GET') === 'PATCH') {
        const id = url.split('/notifications/')[1]?.replace('/read', '');
        items = items.map((item) =>
          item.id === id ? { ...item, readAt: '2026-11-11T10:00:00.000Z' } : item,
        );
        return fakeResponse({ success: true, data: items.find((item) => item.id === id) });
      }
      if (url.includes('/notifications')) return fakeResponse(pageOf(items));
      throw new Error(`unexpected request: ${url}`);
    });

    renderBell();

    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    await user.click(bell);

    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent(UNREAD.message);
    expect(panel).toHaveTextContent(READ.message);
    expect(panel).toHaveTextContent('1 unread');

    await user.click(
      within(panel).getByRole('button', { name: new RegExp(UNREAD.message.slice(0, 30)) }),
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).includes(UNREAD.id) &&
            (init as RequestInit | undefined)?.method === 'PATCH',
        ),
      ).toBe(true);
    });

    // The list is invalidated and refetched, so the count drops to zero.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    });
    expect(within(panel).getByText('All read')).toBeInTheDocument();
  });

  it('shows the empty state when there are no notifications', async () => {
    const user = userEvent.setup();
    installFetch((url) => {
      if (url.includes('/notifications')) return fakeResponse(pageOf([]));
      throw new Error(`unexpected request: ${url}`);
    });

    renderBell();
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));

    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
    expect(screen.getByText('Missed scheduled sessions will show up here.')).toBeInTheDocument();
  });

  it('shows an error state with Retry inside the panel', async () => {
    const user = userEvent.setup();
    let calls = 0;
    installFetch((url) => {
      if (!url.includes('/notifications')) throw new Error(`unexpected request: ${url}`);
      calls += 1;
      // First load and the refetch triggered by opening the panel fail; Retry succeeds.
      if (calls <= 2) {
        return fakeResponse(
          { success: false, error: { code: 'INTERNAL', message: 'Database unavailable' } },
          500,
        );
      }
      return fakeResponse(pageOf([UNREAD]));
    });

    renderBell();
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));

    expect(await screen.findByText("We couldn't load your notifications.")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(UNREAD.message)).toBeInTheDocument();
  });
});
