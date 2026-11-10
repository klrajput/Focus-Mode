/*
 * Page header — the single `<h1>` for a route plus its one primary action slot (UX_SPEC §3).
 * The Focus Agent badge sits in the shell header, so this component only owns the page title,
 * an optional context line and actions; it wraps at 360 px instead of overflowing.
 */

import type { ReactNode } from 'react';

import { useDocumentTitle } from '../../hooks/use-document-title';
import { cn } from '../../lib/cn';

export interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  useDocumentTitle(title);

  return (
    <header
      className={cn('flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-6', className)}
    >
      <div className="min-w-0">
        {eyebrow === undefined ? null : (
          <p className="text-[13px] font-medium tracking-wide text-muted uppercase">{eyebrow}</p>
        )}
        <h1 className="text-[28px] leading-[1.2] font-semibold break-words text-ink">{title}</h1>
        {description === undefined ? null : (
          <p className="mt-1 max-w-prose text-[15px] text-muted">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-3">{actions}</div>
      )}
    </header>
  );
}
