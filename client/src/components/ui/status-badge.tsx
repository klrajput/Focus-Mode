/*
 * Status badge — icon + text, never colour-only (UX_SPEC §3/§10.1). The label colour tokens are
 * the audited badge pairs from UX_SPEC §2.1 row 39; the neutral label reuses the `disabled-text`
 * token, which is the same sanctioned slate value as the neutral badge label.
 */

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export type BadgeTone = 'success' | 'neutral' | 'focus' | 'amber' | 'danger' | 'info';

const TONE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  success: 'bg-badge-success-bg text-success-text',
  neutral: 'bg-badge-neutral-bg text-disabled-text',
  focus: 'bg-badge-focus-bg text-focus-strong-hover',
  amber: 'bg-badge-amber-bg text-amber-text',
  danger: 'bg-badge-danger-bg text-danger-text',
  info: 'bg-badge-info-bg text-primary-active',
};

export interface StatusBadgeProps {
  tone: BadgeTone;
  icon: LucideIcon;
  children: ReactNode;
  /** Tooltip / supplementary accessible description (status stays icon+text without it). */
  title?: string;
  className?: string;
}

export function StatusBadge({ tone, icon: Icon, children, title, className }: StatusBadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 text-[13px] font-medium',
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}
