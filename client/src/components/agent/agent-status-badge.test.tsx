/*
 * AgentStatusBadge accessibility tests (T-045, NFR-008 rule 1): every status is icon + text, never
 * colour-only, the live region has an accessible name and `aria-live="polite"`, and a Disconnected
 * badge is the keyboard-reachable trigger for the local-network help card. A disconnected badge
 * must never render the word "Connected".
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { makeAgentLinkValue } from '../../test/test-utils';
import { AgentLinkContext, type AgentLinkContextValue } from '../../agent/agent-link-provider';
import { AgentStatusBadge } from './agent-status-badge';

function renderBadge(overrides: Partial<AgentLinkContextValue> = {}) {
  return render(
    <AgentLinkContext.Provider value={makeAgentLinkValue(overrides)}>
      <AgentStatusBadge />
    </AgentLinkContext.Provider>,
  );
}

describe('AgentStatusBadge', () => {
  it('announces a Connected status with icon and text', () => {
    renderBadge({ status: 'PAIRED', detail: 'Your Focus Agent is connected.' });

    const status = screen.getByRole('status', { name: 'Focus Agent status: Connected' });
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Connected');
    expect(status.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('shows Focusing and Not paired as text, not colour alone', () => {
    const { rerender } = renderBadge({ status: 'FOCUSING' });
    expect(screen.getByText('Focusing')).toBeInTheDocument();

    rerender(
      <AgentLinkContext.Provider value={makeAgentLinkValue({ status: 'IDLE' })}>
        <AgentStatusBadge />
      </AgentLinkContext.Provider>,
    );
    expect(screen.getByText('Not paired')).toBeInTheDocument();
  });

  it('never claims Connected while Disconnected and opens the help card from the badge', async () => {
    const user = userEvent.setup();
    const showHelpCard = vi.fn();
    renderBadge({ status: 'DISCONNECTED', showHelpCard });

    expect(screen.queryByText('Connected')).not.toBeInTheDocument();

    const status = screen.getByRole('status', { name: 'Focus Agent status: Disconnected' });
    expect(status).toHaveTextContent('Disconnected');

    const helpButton = screen.getByRole('button', {
      name: 'Focus Agent status: Disconnected. Show connection help',
    });
    await user.click(helpButton);
    expect(showHelpCard).toHaveBeenCalledTimes(1);
  });

  it('shows Connecting… while the first attempt runs', () => {
    renderBadge({ status: 'DISCONNECTED', connecting: true });

    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
