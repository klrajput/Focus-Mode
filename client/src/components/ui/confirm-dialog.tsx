/*
 * ConfirmDialog — one confirmation modal for destructive/irreversible actions (unpair-all, deleting
 * a preset or a download link). It wraps the accessible `Dialog` primitive, keeps the destructive
 * button last and in the sticky footer, and lets the caller own the async mutation so the dialog
 * never closes before the server confirms.
 */

import type { ReactNode } from 'react';

import { Button } from './button';
import { Dialog } from './dialog';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel: string;
  loadingLabel?: string;
  pending?: boolean;
  error?: string | null;
  confirmVariant?: 'danger' | 'primary';
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  loadingLabel,
  pending = false,
  error = null,
  confirmVariant = 'danger',
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            loading={pending}
            loadingLabel={loadingLabel ?? confirmLabel}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {error === null ? null : (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-[13px] leading-[1.45] font-medium text-danger-text"
        >
          {error}
        </p>
      )}
    </Dialog>
  );
}
