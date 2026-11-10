/*
 * Error state (NFR-007, UX_SPEC §6.1): the user always gets a plain sentence, an optional retry
 * and — when support needs it — the error code as muted small text, never as the primary message.
 * Rendered with `role="alert"` so a failed fetch is announced once (NFR-008).
 */

import { AlertTriangle, RefreshCw } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Button } from './button';

export interface ErrorStateProps {
  title: string;
  message?: string;
  code?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title,
  message,
  code,
  onRetry,
  retryLabel = 'Retry',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'min-w-0 rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-8',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-danger-subtle text-danger">
          <AlertTriangle aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] leading-[1.3] font-semibold break-words text-ink">{title}</h2>
          {message === undefined ? null : (
            <p className="mt-2 break-words text-[15px] text-muted">{message}</p>
          )}
          {code === undefined ? null : (
            <p className="mt-2 font-mono text-[13px] leading-[1.45] text-muted">(Ref: {code})</p>
          )}
          {onRetry === undefined ? null : (
            <Button
              variant="secondary"
              className="mt-4"
              onClick={onRetry}
              leadingIcon={<RefreshCw aria-hidden="true" className="h-4 w-4" />}
            >
              {retryLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
