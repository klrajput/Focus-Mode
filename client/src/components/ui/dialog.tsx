/*
 * Dialog — the one modal primitive used by the pairing/unpairing flow (UX_SPEC §3/§4.5).
 * It renders in a portal, traps Tab inside the panel, closes on Escape or the backdrop, restores
 * focus to the trigger and marks itself `aria-modal="true"` with a labelled title. Below `md` it
 * becomes a bottom sheet so a 360 px viewport never scrolls horizontally (UX_SPEC §8).
 */

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { cn } from '../../lib/cn';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  className,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = (): HTMLElement[] =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);

    // Prefer the first field (the pairing code) over the header close button (UX_SPEC §4.5).
    const firstField = panel?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    (firstField ?? focusables()[0])?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[var(--fm-z-modal)] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-ink/50"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        className={cn(
          'relative max-h-[calc(100dvh-1rem)] w-full max-w-[440px] overflow-y-auto rounded-t-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-modal)] sm:max-h-[calc(100dvh-2rem)] sm:rounded-[var(--radius-card)]',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[20px] leading-[1.3] font-semibold break-words text-ink"
            >
              {title}
            </h2>
            {description === undefined ? null : (
              <p id={descriptionId} className="mt-1 text-[13px] leading-[1.45] text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mt-1 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-muted hover:bg-primary-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4">{children}</div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-card px-5 py-3">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}
