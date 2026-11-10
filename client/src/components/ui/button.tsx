/*
 * Button primitive — UX_SPEC §1.4 recipes. One primary action per screen; loading keeps the label
 * in place with a static icon (no spinner animation, UX_SPEC §9) and sets `aria-busy`. All colours
 * come from the CSS-variable tokens; disabled controls use the audited disabled tokens (NFR-008).
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '../../lib/cn';

export type ButtonVariant =
  'primary' | 'secondary' | 'danger' | 'ghost' | 'on-base' | 'on-base-quiet';
export type ButtonSize = 'sm' | 'md';

const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-primary text-white hover:bg-primary-hover active:bg-primary-active',
  secondary:
    'border border-border-strong bg-card text-ink hover:bg-primary-subtle active:bg-primary-subtle',
  danger: 'bg-danger text-white hover:bg-danger-hover active:bg-danger-hover',
  ghost: 'bg-transparent text-primary hover:bg-primary-subtle',
  'on-base':
    'bg-focus-strong text-white hover:bg-focus-strong-hover focus-visible:ring-ring-on-base focus-visible:ring-offset-base',
  'on-base-quiet':
    'bg-transparent text-text-on-base-muted hover:bg-nav-active-bg hover:text-white focus-visible:ring-ring-on-base focus-visible:ring-offset-base',
};

const SIZE_CLASSES: Readonly<Record<ButtonSize, string>> = {
  // 44 px touch target below md, 40 px on desktop (UX_SPEC §8; `sm` keeps 40 px at every width).
  sm: 'h-10 px-3 text-sm md:h-10',
  md: 'h-11 px-4 text-sm md:h-10',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Text shown while `loading`; defaults to the normal children. */
  loadingLabel?: string;
  leadingIcon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel,
  leadingIcon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isDisabled = disabled === true || loading;

  return (
    <button
      {...rest}
      type={type}
      className={cn(
        'inline-flex min-w-0 items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium',
        'transition-colors duration-[var(--fm-duration-fast)] ease-[var(--fm-ease-calm)]',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-disabled-fill disabled:text-disabled-text',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
    >
      {loading ? <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0" /> : leadingIcon}
      <span className="truncate">{loading ? (loadingLabel ?? children) : children}</span>
    </button>
  );
}
