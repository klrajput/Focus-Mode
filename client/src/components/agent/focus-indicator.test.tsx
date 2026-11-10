/*
 * FocusIndicator tests (T-045/FR-009): the bar exists only while the agent reports FOCUSING, the
 * countdown comes from the agent's `endsAt` (seconds granularity, no local start time), and End
 * Focus sends the local `exitFocus` request through the provider.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  AgentLinkContext,
  type AgentLinkContextValue,
  type AgentSessionSummary,
} from '../../agent/agent-link-provider';
import { makeAgentLinkValue } from '../../test/test-utils';
import { FocusIndicator } from './focus-indicator';

const NOW = new Date('2026-11-10T10:00:00.000Z');

const SESSION: AgentSessionSummary = {
  sessionId: '9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c',
  startedAt: '2026-11-10T09:55:00.000Z',
  endsAt: '2026-11-10T10:01:05.000Z',
  plannedMinutes: 60,
  source: 'MANUAL',
};

function renderIndicator(overrides: Partial<AgentLinkContextValue> = {}) {
  return render(
    <AgentLinkContext.Provider
      value={makeAgentLinkValue({ status: 'FOCUSING', session: SESSION, ...overrides })}
    >
      <FocusIndicator />
    </AgentLinkContext.Provider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FocusIndicator', () => {
  it('renders nothing unless the agent reports FOCUSING with a session', () => {
    const { container } = render(
      <AgentLinkContext.Provider value={makeAgentLinkValue({ status: 'PAIRED', session: SESSION })}>
        <FocusIndicator />
      </AgentLinkContext.Provider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('counts down from endsAt once per second', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    renderIndicator();

    const bar = screen.getByRole('timer', {
      name: 'Focus session: 1 minute 5 seconds remaining',
    });
    expect(bar).toHaveTextContent('Focusing');
    expect(bar).toHaveTextContent('— 1:05 left');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByRole('timer')).toHaveAttribute(
      'aria-label',
      'Focus session: 1 minute 4 seconds remaining',
    );
  });

  it('keeps warning instead of vanishing when the link drops mid-session (F-02)', async () => {
    const refresh = vi.fn();
    const liveSession: AgentSessionSummary = {
      ...SESSION,
      endsAt: new Date(Date.now() + 65_000).toISOString(),
    };
    renderIndicator({ status: 'DISCONNECTED', linkLost: true, refresh, session: liveSession });

    const bar = screen.getByRole('timer');
    expect(bar).toHaveTextContent('Focusing');
    expect(bar).toHaveTextContent('Lost contact with your Focus Agent — the session keeps running.');
    expect(bar.getAttribute('aria-label')).toContain('Focus session: 1 minute');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('puts the countdown in the document title while focusing and restores it afterwards', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    document.title = 'Dashboard — Focus Mode';

    const { unmount } = renderIndicator();
    expect(document.title).toBe('Focusing — 2 min left — Focus Mode');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(document.title).toBe('Focusing — 1 min left — Focus Mode');

    unmount();
    expect(document.title).toBe('Dashboard — Focus Mode');
  });

  it('sends End Focus through the provider', async () => {
    const user = userEvent.setup();
    const endFocus = vi.fn(() => true);
    renderIndicator({ endFocus });

    await user.click(screen.getByRole('button', { name: 'End Focus' }));

    expect(endFocus).toHaveBeenCalledTimes(1);
  });
});
