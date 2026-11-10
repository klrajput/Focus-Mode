/*
 * PairDialog — the 6-digit pairing step on `/devices` (UX_SPEC §4.5, FR-003 / REC-002).
 * The code is validated by the frozen shared `devicePairSchema` before any network call, posted
 * only to the cloud (`POST /devices/pair`) and never sent over the local WebSocket (DEC-003). A
 * successful pair closes the dialog, toasts the approved sentence and lets the page nudge the agent
 * with the local `paired` message.
 */

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { devicePairSchema, type DevicePairInput } from '@focus-mode/shared';

import { devicesApi } from '../../api/endpoints/devices';
import { isApiError } from '../../api/errors';
import type { Device } from '../../api/types';
import { ERROR_MESSAGES, copyForCode } from '../../copy/errors';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input } from '../ui/input';

export interface PairDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after the cloud accepted the code; the page nudges the agent and refetches. */
  onPaired: (device: Device) => void;
}

function isPairingFieldError(code: string): boolean {
  return (
    code === 'INVALID_PAIRING_CODE' || code === 'PAIRING_EXPIRED' || code === 'VALIDATION_ERROR'
  );
}

export function PairDialog({ open, onClose, onPaired }: PairDialogProps) {
  const [banner, setBanner] = useState<string | null>(null);

  const form = useForm<DevicePairInput>({
    resolver: zodResolver(devicePairSchema),
    defaultValues: { code: '' },
    mode: 'onSubmit',
  });

  const { errors, isSubmitting } = form.formState;
  const registration = form.register('code');
  const code = form.watch('code') ?? '';
  const isComplete = /^\d{6}$/.test(code);

  function close(): void {
    if (isSubmitting) return;
    form.reset({ code: '' });
    setBanner(null);
    onClose();
  }

  async function onSubmit(values: DevicePairInput): Promise<void> {
    setBanner(null);

    try {
      const result = await devicesApi.pair({ code: values.code });
      toast.success('Agent connected');
      form.reset({ code: '' });
      onPaired(result.device);
      onClose();
    } catch (error) {
      if (!isApiError(error)) {
        setBanner(ERROR_MESSAGES.INTERNAL);
        return;
      }

      if (isPairingFieldError(error.code)) {
        form.setError('code', { type: 'server', message: copyForCode(error.code) });
        return;
      }

      setBanner(copyForCode(error.code));
    }
  }

  return (
    <Dialog
      open={open}
      title="Pair a device"
      description="Open your Focus Agent and type the 6-digit code it shows."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void form.handleSubmit(onSubmit)()}
            loading={isSubmitting}
            loadingLabel="Pairing…"
            disabled={!isComplete}
          >
            Pair device
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {banner === null ? null : (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-[13px] leading-[1.45] font-medium text-danger-text"
          >
            {banner}
          </p>
        )}

        <Input
          {...registration}
          label="6-digit pairing code"
          hint="Digits only. The code is shown only in the Focus Agent — never on this page."
          error={errors.code?.message}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          placeholder="000000"
          className="max-w-[320px] font-mono tracking-[0.3em]"
          onChange={(event) => {
            event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
            void registration.onChange(event);
          }}
        />
      </form>
    </Dialog>
  );
}
