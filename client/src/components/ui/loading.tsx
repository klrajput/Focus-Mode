/*
 * Static loading indicators (UX_SPEC §9: no infinite/looping animation, no shimmer skeletons).
 * A skeleton is a static `skeleton` block; the accessible "Loading…" text lives in the parent
 * region so screen readers hear it once instead of once per block (NFR-008).
 */

import { Loader2 } from 'lucide-react';

import { cn } from '../../lib/cn';

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('rounded-[var(--radius-control)] bg-skeleton', className)}
    />
  );
}

export interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

/** A short stack of text-line skeletons (static, no pulse). */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-4', index === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export interface SpinnerProps {
  label?: string;
  className?: string;
}

/**
 * Static "Loading…" indicator. Kept as a component (not an animated spinner) so status text is
 * always visible and reduced-motion users lose nothing.
 */
export function Spinner({ label = 'Loading…', className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center gap-2 text-[13px] text-muted', className)}
    >
      <Loader2 aria-hidden="true" className="h-4 w-4" />
      <span>{label}</span>
    </span>
  );
}

export interface PageLoadingProps {
  label?: string;
}

/** Full-page loading state used by the auth gate while the session is rehydrated. */
export function PageLoading({ label = 'Loading…' }: PageLoadingProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-[var(--fm-page-pad-x)]">
      <Spinner label={label} />
    </div>
  );
}
