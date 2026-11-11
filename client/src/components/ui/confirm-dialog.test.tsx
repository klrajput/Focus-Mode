/*
 * ConfirmDialog tests (NFR-008, T-034): the one confirmation modal for destructive actions. The
 * caller owns the async mutation, so the dialog must not close itself while `pending`, must keep
 * Cancel and the destructive button last, and must surface a server error inside the panel.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConfirmDialog } from './confirm-dialog';

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <ConfirmDialog
      open
      title="Delete this download link?"
      description="The installer disappears from the landing page."
      confirmLabel="Delete link"
      onConfirm={onConfirm}
      onClose={onClose}
      {...overrides}
    >
      <p>macOS · arm64 · v1.4.0</p>
    </ConfirmDialog>,
  );
  return { ...view, onConfirm, onClose };
}

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    renderDialog({ open: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('labels the dialog, shows the description and keeps Cancel before the destructive action', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: 'Delete this download link?' });
    expect(dialog).toHaveAccessibleDescription('The installer disappears from the landing page.');
    expect(screen.getByText('macOS · arm64 · v1.4.0')).toBeInTheDocument();

    const buttons = screen.getAllByRole('button');
    const labels = buttons.map((button) => button.textContent ?? '');
    expect(labels.indexOf('Cancel')).toBeLessThan(labels.indexOf('Delete link'));
  });

  it('closes on Cancel and confirms with Confirm', async () => {
    const user = userEvent.setup();
    const { onClose, onConfirm } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Delete link' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('surfaces a server error inside the panel', () => {
    renderDialog({ error: 'Something went wrong on our side. Please try again.' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Please try again.',
    );
  });

  it('keeps the dialog open and disables Cancel while the mutation is pending', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog({ pending: true, loadingLabel: 'Deleting…' });

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    const confirm = screen.getByRole('button', { name: 'Deleting…' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');

    // Backdrop, header close and Escape all route through onClose, which must be a no-op here.
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
