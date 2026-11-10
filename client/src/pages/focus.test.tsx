/*
 * `/focus` page tests (T-057, FR-006/FR-007/FR-009, UX_SPEC §4.4).
 * The page is driven only by the agent context: the ring counts down from `endsAt` (a slow or busy
 * tab can never accumulate drift because every tick recomputes from the absolute timestamp), End
 * Focus sends `exitFocus`, a dropped link keeps the session visible with the ratified warning, and
 * the ended state shows the approved success sentence.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import {
  AgentLinkContext,
  type AgentLinkContextValue,
  type AgentSessionSummary,
} from '../agent/agent-link-provider';
import { createTestQueryClient, makeAgentLinkValue } from '../test/test-utils';
import { FocusPage } from './focus';

const NOW = new Date('2026-11-10T10:00:00.000Z');

const SESSION: AgentSessionSummary = {
  sessionId: '9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c',
  startedAt: '2026-11-10T09:55:00.000Z',
  endsAt: '2026-11-10T10:01:05.000Z',
  plannedMinutes: 60,
  source: 'MANUAL',
};

function fakeResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/allowlist')) {
        return Promise.resolve(
          fakeResponse({
            success: true,
            data: {
              protectedApps: [{ key: 'chrome', label: 'Google Chrome' }],
              userApps: [{ key: 'vscode', label: 'Visual Studio Code' }],
              version: 3,
            },
          }),
        );
      }
      return Promise.resolve(
        fakeResponse({
          success: true,
          data: {
            items: [
              {
                id: '507f1f77bcf86cd799439011',
                name: "Kabir's MacBook",
                os: 'macOS',
                status: 'FOCUSING',
                agentVersion: '1.4.0',
                pairedAt: '2026-11-02T10:00:00.000Z',
                lastSeenAt: '2026-11-10T10:00:00.000Z',
              },
            ],
            page: 1,
            limit: 20,
            total: 1,
            totalPages: 1,
          },
        }),
      );
    }),
  );
}

function renderPage(overrides: Partial<AgentLinkContextValue> = {}) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <AgentLinkContext.Provider
          value={makeAgentLinkValue({ status: 'FOCUSING', session: SESSION, ...overrides })}
        >
          <FocusPage />
        </AgentLinkContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('FocusPage', () => {
  it('counts down from endsAt with no cumulative drift', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    installFetch();
    renderPage();

    expect(
      screen.getByRole('img', { name: 'Focus session: 1 minute 5 seconds remaining' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1:05')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('1:04')).toBeInTheDocument();

    // Five more ticks: the value comes from `endsAt`, so 6 s of interval time is exactly 0:59.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('0:59')).toBeInTheDocument();

    // A long jump (background tab) lands on the true remaining time, not on a drifted counter.
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });

  it('shows the session facts, allow-listed apps and a prominent End Focus', async () => {
    installFetch();
    const endFocus = vi.fn(() => true);
    renderPage({ endFocus });

    expect(await screen.findByText(/Visual Studio Code/)).toBeInTheDocument();
    expect(screen.getByText(/60 m planned/)).toBeInTheDocument();
    expect(screen.getByText(/^Manual$/)).toBeInTheDocument();
    expect(screen.getByText(/device: Kabir's MacBook/)).toBeInTheDocument();
    expect(
      screen.getByText(/You can also end from the Focus Agent tray menu, or by quitting it\./),
    ).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'End Focus' }));
    expect(endFocus).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Ending…' })).toBeInTheDocument();
  });

  it('keeps the session visible with the ratified warning when the link drops', async () => {
    installFetch();
    const refresh = vi.fn();
    renderPage({ linkLost: true, refresh });

    expect(
      await screen.findByText(
        'Lost contact with your Focus Agent. Your session keeps running — the agent ends it on time. Reconnect to End from here.',
      ),
    ).toBeInTheDocument();
    // The ring is still there: the agent keeps running the session.
    expect(screen.getByRole('img', { name: /Focus session:/ })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('explains when End Focus cannot reach the agent', async () => {
    installFetch();
    renderPage({ endFocus: () => false });

    await userEvent.setup().click(screen.getByRole('button', { name: 'End Focus' }));

    expect(
      await screen.findByText(
        "We couldn't reach your Focus Agent. Reconnect, or end the session from its tray menu.",
      ),
    ).toBeInTheDocument();
  });

  it('shows the honest empty state when no session is running', async () => {
    installFetch();
    renderPage({ status: 'PAIRED', session: null });

    expect(
      await screen.findByRole('heading', { name: 'No focus session is running.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a session' })).toBeInTheDocument();
  });

  it('shows the session summary after the agent ends focus', async () => {
    installFetch();
    renderPage({
      status: 'PAIRED',
      session: null,
      lastEnded: {
        sessionId: SESSION.sessionId,
        at: '2026-11-10T10:01:05.000Z',
        reason: 'COMPLETED',
        actualMinutes: 60,
      },
    });

    expect(
      await screen.findByRole('heading', { name: 'Focus ended — your windows are back.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('60 m')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});
