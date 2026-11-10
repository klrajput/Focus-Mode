/*
 * AgentHelpCard tests (T-045 / UX_SPEC §6.3): the local-network explainer renders the approved
 * browser instructions, the "Start your Focus Agent" troubleshooting steps and a working dismiss
 * action. No copy here claims the agent is connected.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { AgentHelpCard } from './agent-help-card';

function renderHelpCard() {
  const onDismiss = vi.fn();
  render(
    <MemoryRouter>
      <AgentHelpCard onDismiss={onDismiss} />
    </MemoryRouter>,
  );
  return onDismiss;
}

describe('AgentHelpCard', () => {
  it('explains the local-network permission and the Safari limitation', () => {
    renderHelpCard();

    expect(
      screen.getByRole('heading', { name: 'Allow this site to reach your Focus Agent' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Choose Allow — the connection stays on this computer/),
    ).toBeInTheDocument();
    expect(screen.getByText('Chrome / Edge')).toBeInTheDocument();
    expect(screen.getByText('Firefox 147+')).toBeInTheDocument();
    expect(
      screen.getByText(/Safari can't open a local WebSocket from an HTTPS page/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Start your Focus Agent and leave it running/)).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('can be dismissed', async () => {
    const user = userEvent.setup();
    const onDismiss = renderHelpCard();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
