/*
 * ConsentModal copy contract (T-056, FR-009, UX_SPEC §5).
 *
 * These assertions are the copy-contract test: every sentence below is A3's approved text and a
 * change here is a copy change, not a refactor. The behavioural guarantee (nothing is sent before
 * Confirm) is proven with the link spy in `start-focus-card.test.tsx`; this file additionally proves
 * that Cancel / Escape never call `onConfirm` and that there is exactly one confirming action.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConsentModal } from './consent-modal';

function renderModal(overrides: Partial<Parameters<typeof ConsentModal>[0]> = {}) {
  const props: Parameters<typeof ConsentModal>[0] = {
    open: true,
    durationMin: 25,
    deviceName: "Kabir's MacBook",
    allowListLabels: ['Visual Studio Code', 'Slack'],
    asideLabels: ['Music', 'Notes', 'Photos', 'Mail', 'Calendar', 'Maps', 'Terminal'],
    reaside: true,
    onReasideChange: vi.fn(),
    onRequestAsideCandidates: vi.fn(),
    onCancel: vi.fn(),
    onChangeDuration: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };

  return { props, ...render(<ConsentModal {...props} />) };
}

describe('ConsentModal — UX_SPEC §5 copy', () => {
  it('renders the title, summary and duration row verbatim', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');

    expect(
      within(dialog).getByRole('heading', { name: 'Start a 25-minute focus session?' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "This is exactly what will happen on Kabir's MacBook. You can end it at any time.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/^Duration: /)).toHaveTextContent(
      /Duration: 25 minutes — ends at .+\./,
    );
    expect(within(dialog).getByRole('button', { name: 'Change' })).toBeInTheDocument();
  });

  it('lists what stays open, what steps aside and the re-aside rule', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByRole('heading', { name: 'These stay open' })).toBeInTheDocument();
    expect(
      within(dialog).getByText('All web browsers (Chrome, Edge, Firefox, Safari and others)'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('The Focus Agent')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'System essentials: Task Manager (Windows) / Activity Monitor (macOS), File Explorer (Windows) / Finder (macOS), the Dock / taskbar, System Settings',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Your allow-listed apps: Visual Studio Code, Slack')).toBeInTheDocument();

    expect(
      within(dialog).getByRole('heading', { name: 'These will step aside' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Other open apps will be minimised or hidden so they're out of the way. They are not closed. Nothing is deleted or quit.",
      ),
    ).toBeInTheDocument();
    // Count + first five labels + "and N more" (never a truncated list without a count).
    expect(
      within(dialog).getByText(
        "Right now that's 7 apps: Music, Notes, Photos, Mail, Calendar, and 2 more.",
      ),
    ).toBeInTheDocument();

    expect(
      within(dialog).getByRole('heading', { name: 'Keep new apps aside' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('switch', { name: 'Keep new apps aside' })).toBeChecked();
    expect(
      within(dialog).getByText(
        'On: apps that open or jump to the front during the session also step aside.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Off: a newly opened app stays in front.'),
    ).toBeInTheDocument();
  });

  it('states how to end focus and the fine print', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');

    expect(
      within(dialog).getByRole('heading', { name: 'You can end focus any time' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('End Focus on this dashboard')).toBeInTheDocument();
    expect(within(dialog).getByText('End Focus in the Focus Agent tray menu')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Quit the Focus Agent — it restores your windows first'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Focus starts only after you confirm. This summary is shown before every session. The Focus Agent never moves a window without your consent.',
      ),
    ).toBeInTheDocument();
  });

  it('offers exactly one confirming action and cancels on Escape / Cancel', async () => {
    const user = userEvent.setup();
    const { props } = renderModal();

    const confirmButtons = screen.getAllByRole('button', { name: 'Confirm — start focus' });
    expect(confirmButtons).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('says "none yet" when the allow-list is empty and omits the count until the agent answers', () => {
    renderModal({ allowListLabels: [], asideLabels: null });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Your allow-listed apps: none yet')).toBeInTheDocument();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Checking which apps are open…');
    expect(within(dialog).queryByText(/Right now that's/)).not.toBeInTheDocument();
  });
});
