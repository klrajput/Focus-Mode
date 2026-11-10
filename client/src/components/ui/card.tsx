/*
 * Card primitives shared by every data page. The surface recipe is UX_SPEC §1.4:
 * `bg-card border border-border rounded-[--radius-card] shadow-[--shadow-card]`.
 * `min-w-0` is mandatory so long session names/badges never force horizontal scroll at 360 px.
 */

import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Pass a heading id when the card is a labelled region. */
  ariaLabelledBy?: string;
}

export function Card({ children, className, ariaLabelledBy }: CardProps) {
  return (
    <section
      aria-labelledby={ariaLabelledBy}
      className={cn(
        'min-w-0 rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-card)]',
        className,
      )}
    >
      {children}
    </section>
  );
}

export interface CardHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  titleId?: string;
}

export function CardHeader({ title, description, action, titleId }: CardHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <h2 id={titleId} className="text-[20px] leading-[1.3] font-semibold text-ink">
          {title}
        </h2>
        {description === undefined ? null : (
          <p className="mt-0.5 text-[13px] leading-[1.45] text-muted">{description}</p>
        )}
      </div>
      {action === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      )}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}
