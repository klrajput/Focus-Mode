/*
 * Text input primitive with a visible label, hint and inline error (UX_SPEC §10.5).
 * `aria-invalid` + `aria-describedby` wire the error text to the field, required fields say
 * "Required" in words instead of a bare asterisk, and the boundary uses `border-strong` because
 * `border` fails the 3:1 control-boundary rule (UX_SPEC §1.4/§2). Ref is spread from props so
 * react-hook-form's `register()` keeps working.
 */

import { useId, type ComponentPropsWithRef } from 'react';

import { cn } from '../../lib/cn';

export interface InputProps extends ComponentPropsWithRef<'input'> {
  label: string;
  hint?: string;
  error?: string;
  /** Show the word "Required" next to the label (never a bare asterisk). */
  requiredText?: boolean;
}

export function Input({
  label,
  hint,
  error,
  requiredText = false,
  id,
  className,
  'aria-describedby': describedBy,
  ...rest
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint === undefined ? undefined : `${inputId}-hint`;
  const errorId = error === undefined ? undefined : `${inputId}-error`;
  const describedByIds = [describedBy, hintId, errorId].filter(
    (value): value is string => value !== undefined,
  );

  return (
    <div className="min-w-0">
      <label
        htmlFor={inputId}
        className="flex flex-wrap items-baseline gap-2 text-[13px] font-medium text-ink"
      >
        <span>{label}</span>
        {requiredText ? <span className="text-[13px] font-normal text-muted">Required</span> : null}
      </label>

      <input
        {...rest}
        id={inputId}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedByIds.length === 0 ? undefined : describedByIds.join(' ')}
        className={cn(
          'mt-1.5 h-11 w-full rounded-[var(--radius-control)] border bg-card px-3 text-[15px] text-ink md:h-10',
          'placeholder:text-muted',
          'transition-colors duration-[var(--fm-duration-fast)] ease-[var(--fm-ease-calm)]',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:bg-disabled-fill disabled:text-disabled-text',
          error === undefined ? 'border-border-strong' : 'border-danger',
          className,
        )}
      />

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
