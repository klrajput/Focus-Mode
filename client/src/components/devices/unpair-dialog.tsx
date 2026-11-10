/*
 * UnpairDialog — confirmation before `DELETE /devices/:id` (UX_SPEC §4.5, FR-003).
 * Unpairing revokes the device token server-side; the API then nudges the agent, which restores any
 * running focus session and returns to IDLE (INV-5). The confirm button is the only destructive
 * action and stays in view in the dialog footer at every viewport width.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';

import { devicesApi } from '../../api/endpoints/devices';
import { isApiError } from '../../api/errors';
import type { Device } from '../../api/types';
import { ERROR_MESSAGES, copyForCode } from '../../copy/errors';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

export interface UnpairDialogProps {
  /** `null` closes the dialog; the device being unpaired otherwise. */
  device: Device | null;
  onClose: () => void;
  onUnpaired: (deviceId: string) => void;
}

export function UnpairDialog({ device, onClose, onUnpaired }: UnpairDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<void> {
    if (device === null) return;

    setPending(true);
    setError(null);
    try {
      await devicesApi.remove(device.id);
      toast.success('Device unpaired');
      onUnpaired(device.id);
      onClose();
    } catch (failure) {
      setError(isApiError(failure) ? copyForCode(failure.code) : ERROR_MESSAGES.INTERNAL);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={device !== null}
      title="Unpair this device?"
      description={
        device === null
          ? undefined
          : `${device.name} will stop being able to start focus until you pair it again.`
      }
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={pending}
            loadingLabel="Unpairing…"
            onClick={() => void confirm()}
          >
            Unpair
          </Button>
        </>
      }
    >
      {error === null ? null : (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-[13px] leading-[1.45] font-medium text-danger-text"
        >
          {error}
        </p>
      )}
      <p className="text-[15px] leading-[1.55] text-ink">
        The Focus Agent on this computer will stop working with this account. You can pair it again
        at any time with a new code.
      </p>
    </Dialog>
  );
}
