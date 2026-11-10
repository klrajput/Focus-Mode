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

    const region = screen.getByRole('region', {
      name: 'Focus session: 1 minute 5 seconds remaining',
    });
    expect(region).toHaveTextContent('Focusing');
    expect(region).toHaveTextContent('— 1:05 left');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByRole('region')).toHaveAttribute(
      'aria-label',
      'Focus session: 1 minute 4 seconds remaining',
    );
  });

  it('sends End Focus through the provider', async () => {
    const user = userEvent.setup();
    const endFocus = vi.fn();
    renderIndicator({ endFocus });

    await user.click(screen.getByRole('button', { name: 'End Focus' }));

    expect(endFocus).toHaveBeenCalledTimes(1);
  });
});
