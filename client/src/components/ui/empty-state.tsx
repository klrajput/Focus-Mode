/*
 * Empty state (NFR-007, UX_SPEC §6.1 copy deck). Every data page must prove it can be empty
 * without faking a row; the caller supplies A3's approved sentence and the next useful action.
 */

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  footnote?: string;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  footnote,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-[var(--radius-card)] border border-border bg-card p-6 text-center shadow-[var(--shadow-card)] sm:p-8',
        className,
      )}
    >
      {Icon === undefined ? null : (
        <span className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-[var(--radius-pill)] bg-focus-subtle text-focus-strong">
          <Icon aria-hidden="true" className="h-6 w-6" />
        </span>
      )}
      <h2 className="text-[20px] leading-[1.3] font-semibold break-words text-ink">{title}</h2>
      {description === undefined ? null : (
        <p className="mx-auto mt-2 max-w-prose text-[15px] text-muted">{description}</p>
      )}
      {action === undefined ? null : (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{action}</div>
      )}
      {footnote === undefined ? null : (
        <p className="mx-auto mt-4 max-w-prose text-[13px] leading-[1.45] text-muted">{footnote}</p>
      )}
    </div>
  );
}
