/*
 * Preset create/edit dialog tests (UX_SPEC §4.10, FR-019): shared schema validation (including the
 * duplicate-key rule), server field details mapped back onto name/apps.N.key|label, the generic
 * error banner, the "only close after the server accepts" rule and the add/remove app editor.
 * The admin-preset hooks are mocked so the dialog is tested without transport.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UNIQUE_APP_KEYS_MESSAGE } from '@focus-mode/shared';

import type { Preset } from '../../api/types';
import { ApiError } from '../../api/errors';
import { PresetDialog } from './preset-dialog';

const createPreset = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const updatePreset = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('../../hooks/use-admin-presets', () => ({
  useCreatePreset: () => createPreset,
  useUpdatePreset: () => updatePreset,
}));

const CODING: Preset = {
  id: '507f1f77bcf86cd799439011',
  name: 'Coding',
  apps: [{ key: 'vs-code', label: 'VS Code' }],
  createdAt: '2026-11-02T10:00:00.000Z',
};

function renderDialog(preset: Preset | null = null) {
  const onClose = vi.fn();
  const view = render(<PresetDialog preset={preset} onClose={onClose} />);
  return { ...view, onClose };
}

async function fillApp(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  key: string,
  label: string,
): Promise<void> {
  await user.type(screen.getByLabelText(new RegExp(`^App ${index} key`)), key);
  await user.type(screen.getByLabelText(new RegExp(`^App ${index} label`)), label);
}

describe('PresetDialog — create', () => {
  it('publishes a valid preset and closes only after the server accepts', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    createPreset.mutateAsync.mockResolvedValue(CODING);

    expect(screen.getByRole('dialog', { name: 'New preset' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Preset name/), 'Coding');
    await fillApp(user, 1, 'vs-code', 'VS Code');
    await user.click(screen.getByRole('button', { name: 'Publish preset' }));

    await waitFor(() => {
      expect(createPreset.mutateAsync).toHaveBeenCalledWith({
        name: 'Coding',
        apps: [{ key: 'vs-code', label: 'VS Code' }],
      });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updatePreset.mutateAsync).not.toHaveBeenCalled();
  });

  it('adds and removes app rows, keeping at least one', async () => {
    const user = userEvent.setup();
    renderDialog();

    const removeButtons = (): HTMLElement[] =>
      screen.getAllByRole('button', { name: 'Remove app' });
    expect(removeButtons()).toHaveLength(1);
    expect(removeButtons()[0]).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Add app' }));
    expect(removeButtons()).toHaveLength(2);
    expect(removeButtons()[0]).toBeEnabled();

    await user.click(removeButtons()[1] as HTMLElement);
    expect(removeButtons()).toHaveLength(1);
    expect(removeButtons()[0]).toBeDisabled();
  });

  it('rejects duplicate app keys with the shared message', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.type(screen.getByLabelText(/^Preset name/), 'Coding');
    await fillApp(user, 1, 'vs-code', 'VS Code');
    await user.click(screen.getByRole('button', { name: 'Add app' }));
    await fillApp(user, 2, 'vs-code', 'Visual Studio Code');
    await user.click(screen.getByRole('button', { name: 'Publish preset' }));

    expect(await screen.findByText(UNIQUE_APP_KEYS_MESSAGE)).toBeInTheDocument();
    expect(createPreset.mutateAsync).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('maps server validation details back onto the name and app fields', async () => {
    const user = userEvent.setup();
    renderDialog();
    createPreset.mutateAsync.mockRejectedValue(
      new ApiError('VALIDATION_ERROR', 400, 'Request validation failed', [
        { path: 'name', message: 'That preset name is reserved.' },
        { path: 'apps.0.key', message: 'That app key is not allowed.' },
        { path: 'apps.0.label', message: 'Use a clearer label.' },
        { path: 'apps.1.key', message: 'This row does not exist.' },
        { path: 'apps.not-a-number.key', message: 'Malformed path.' },
        { path: 'other', message: 'Unknown field.' },
      ]),
    );

    await user.type(screen.getByLabelText(/^Preset name/), 'Coding');
    await fillApp(user, 1, 'vs-code', 'VS Code');
    await user.click(screen.getByRole('button', { name: 'Publish preset' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check the highlighted fields and try again.',
    );
    expect(await screen.findByText('That preset name is reserved.')).toBeInTheDocument();
    expect(screen.getByText('That app key is not allowed.')).toBeInTheDocument();
    expect(screen.getByText('Use a clearer label.')).toBeInTheDocument();
    expect(screen.queryByText('This row does not exist.')).not.toBeInTheDocument();
    expect(screen.queryByText('Malformed path.')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown field.')).not.toBeInTheDocument();
  });

  it('shows the shared copy for a non-validation API error', async () => {
    const user = userEvent.setup();
    renderDialog();
    createPreset.mutateAsync.mockRejectedValue(new ApiError('CONFLICT', 409, 'Conflict'));

    await user.type(screen.getByLabelText(/^Preset name/), 'Coding');
    await fillApp(user, 1, 'vs-code', 'VS Code');
    await user.click(screen.getByRole('button', { name: 'Publish preset' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That action conflicts with something already in progress. Refresh and try again.',
    );
  });

  it('shows the internal copy for a transport failure', async () => {
    const user = userEvent.setup();
    renderDialog();
    createPreset.mutateAsync.mockRejectedValue(new TypeError('Failed to fetch'));

    await user.type(screen.getByLabelText(/^Preset name/), 'Coding');
    await fillApp(user, 1, 'vs-code', 'VS Code');
    await user.click(screen.getByRole('button', { name: 'Publish preset' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Please try again.',
    );
  });

  it('cannot be closed while the write is in flight', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    let finish: () => void = () => undefined;
    createPreset.mutateAsync.mockReturnValue(
      new Promise<Preset>((resolve) => {
        finish = () => resolve(CODING);
      }),
    );

    await user.type(screen.getByLabelText(/^Preset name/), 'Coding');
    await fillApp(user, 1, 'vs-code', 'VS Code');
    await user.click(screen.getByRole('button', { name: 'Publish preset' }));

    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    expect(saving).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('PresetDialog — edit', () => {
  it('prefills the preset and updates it by id', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog(CODING);
    updatePreset.mutateAsync.mockResolvedValue(CODING);

    const dialog = screen.getByRole('dialog', { name: 'Edit preset' });
    expect(within(dialog).getByLabelText(/^Preset name/)).toHaveValue('Coding');
    expect(within(dialog).getByLabelText(/^App 1 key/)).toHaveValue('vs-code');
    expect(within(dialog).getByLabelText(/^App 1 label/)).toHaveValue('VS Code');

    await user.click(within(dialog).getByRole('button', { name: 'Save preset' }));

    await waitFor(() => {
      expect(updatePreset.mutateAsync).toHaveBeenCalledWith({
        id: CODING.id,
        input: { name: 'Coding', apps: [{ key: 'vs-code', label: 'VS Code' }] },
      });
    });
    expect(createPreset.mutateAsync).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
