/*
 * Native select primitive with the same label/hint/error wiring as `Input` (UX_SPEC §10.5).
 * A native `<select>` is deliberate: it keeps OS keyboard support and mobile pickers, and every
 * option is a real value the shared schemas validate. `border-strong` keeps the 3:1 boundary.
 */

import { useId, type ComponentPropsWithRef } from 'react';

import { cn } from '../../lib/cn';

export interface SelectProps extends ComponentPropsWithRef<'select'> {
  label: string;
  hint?: string;
  error?: string;
  /** Show the word "Required" next to the label (never a bare asterisk). */
  requiredText?: boolean;
}

export function Select({
  label,
  hint,
  error,
  requiredText = false,
  id,
  className,
  children,
  'aria-describedby': describedBy,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = hint === undefined ? undefined : `${selectId}-hint`;
  const errorId = error === undefined ? undefined : `${selectId}-error`;
  const describedByIds = [describedBy, hintId, errorId].filter(
    (value): value is string => value !== undefined,
  );

  return (
    <div className="min-w-0">
      <label
        htmlFor={selectId}
        className="flex flex-wrap items-baseline gap-2 text-[13px] font-medium text-ink"
      >
        <span>{label}</span>
        {requiredText ? <span className="text-[13px] font-normal text-muted">Required</span> : null}
      </label>

      <select
        {...rest}
        id={selectId}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedByIds.length === 0 ? undefined : describedByIds.join(' ')}
        className={cn(
          'mt-1.5 h-11 w-full rounded-[var(--radius-control)] border bg-card px-3 text-[15px] text-ink md:h-10',
          'transition-colors duration-[var(--fm-duration-fast)] ease-[var(--fm-ease-calm)]',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:bg-disabled-fill disabled:text-disabled-text',
          error === undefined ? 'border-border-strong' : 'border-danger',
          className,
        )}
      >
        {children}
      </select>

      {hint === undefined ? null : (
        <p id={hintId} className="mt-1.5 text-[13px] leading-[1.45] text-muted">
          {hint}
        </p>
      )}

      {error === undefined ? null : (
        <p id={errorId} className="mt-1.5 text-[13px] leading-[1.45] font-medium text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
