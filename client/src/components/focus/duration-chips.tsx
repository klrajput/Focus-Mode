/*
 * DurationChips — the 25 / 50 / 60 / Custom control of the Start card (UX_SPEC §4.3, T-056).
 * Preset chips are real buttons (`aria-pressed`), never decorative spans. "Custom…" reveals one
 * labelled number input with the frozen 1–480 minute range (`durationMinSchema`); an invalid or
 * empty custom value is reported to the parent as `null` so Start Focus stays disabled with a
 * visible reason (FR-007, NFR-001).
 */

import { useId, useState } from 'react';

import { cn } from '../../lib/cn';

export const PRESET_DURATIONS = [25, 50, 60] as const;

/** Frozen bounds — the same numbers as `durationMinSchema` (shared/src/schemas/common.ts). */
export const MIN_DURATION_MIN = 1;
export const MAX_DURATION_MIN = 480;

export const INVALID_DURATION_COPY = `Enter a duration between ${MIN_DURATION_MIN} and ${MAX_DURATION_MIN} minutes.`;

function isPreset(minutes: number | null): minutes is (typeof PRESET_DURATIONS)[number] {
  return minutes !== null && (PRESET_DURATIONS as readonly number[]).includes(minutes);
}

export interface DurationChipsProps {
  /** Selected minutes, or `null` while the custom value is empty/invalid. */
  value: number | null;
  onChange: (minutes: number | null) => void;
  disabled?: boolean;
}

export function DurationChips({ value, onChange, disabled = false }: DurationChipsProps) {
  const inputId = useId();
  const errorId = useId();
  const [customOpen, setCustomOpen] = useState<boolean>(!isPreset(value));
  const [customText, setCustomText] = useState<string>(() =>
    isPreset(value) ? '' : value === null ? '' : String(value),
  );

  const customInvalid = customOpen && customText !== '' && value === null;

  function selectPreset(minutes: (typeof PRESET_DURATIONS)[number]): void {
    setCustomOpen(false);
    setCustomText('');
    onChange(minutes);
  }

  function openCustom(): void {
    setCustomOpen(true);
    // Carry the current chip value into the field so the user edits instead of retyping.
    if (customText === '' && value !== null) setCustomText(String(value));
  }

  function handleCustomChange(raw: string): void {
    const digitsOnly = raw.replace(/[^\d]/g, '');
    setCustomText(digitsOnly);

    if (digitsOnly === '') {
      onChange(null);
      return;
    }

    const parsed = Number.parseInt(digitsOnly, 10);
    onChange(
      Number.isInteger(parsed) && parsed >= MIN_DURATION_MIN && parsed <= MAX_DURATION_MIN
        ? parsed
        : null,
    );
  }

  return (
    <div>
      <p className="text-[13px] font-medium text-ink" id={`${inputId}-label`}>
        Duration
      </p>

      <div role="group" aria-labelledby={`${inputId}-label`} className="mt-2 flex flex-wrap gap-2">
        {PRESET_DURATIONS.map((minutes) => {
          const active = !customOpen && value === minutes;
          return (
            <button
              key={minutes}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => selectPreset(minutes)}
              className={cn(
                'inline-flex min-h-11 items-center rounded-[var(--radius-control)] border px-3 text-sm font-medium md:min-h-10',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-disabled-fill disabled:text-disabled-text',
                active
                  ? 'border-primary bg-primary-subtle text-primary-active'
                  : 'border-border-strong bg-card text-ink hover:bg-primary-subtle',
              )}
            >
              {minutes} min
            </button>
          );
        })}

        <button
          type="button"
          aria-pressed={customOpen}
          aria-expanded={customOpen}
          disabled={disabled}
          onClick={openCustom}
          // T-084 (axe: aria-valid-attr-value): only point at the input while it is rendered;
          // a dangling aria-controls target is a critical violation.
          aria-controls={customOpen ? `${inputId}-custom` : undefined}
          className={cn(
            'inline-flex min-h-11 items-center rounded-[var(--radius-control)] border px-3 text-sm font-medium md:min-h-10',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-disabled-fill disabled:text-disabled-text',
            customOpen
              ? 'border-primary bg-primary-subtle text-primary-active'
              : 'border-border-strong bg-card text-ink hover:bg-primary-subtle',
          )}
        >
          Custom…
        </button>
      </div>

      {customOpen ? (
        <div className="mt-3">
          <label htmlFor={`${inputId}-custom`} className="text-[13px] font-medium text-ink">
            Custom duration (minutes)
          </label>
          <input
            id={`${inputId}-custom`}
            type="number"
            inputMode="numeric"
            min={MIN_DURATION_MIN}
            max={MAX_DURATION_MIN}
            step={1}
            value={customText}
            disabled={disabled}
            aria-describedby={`${inputId}-hint`}
            aria-invalid={customInvalid ? true : undefined}
            onChange={(event) => handleCustomChange(event.target.value)}
            className="mt-1 block h-11 w-32 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm text-ink tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-disabled-fill disabled:text-disabled-text md:h-10"
          />
          <p id={`${inputId}-hint`} className="mt-1 text-[13px] text-muted">
            {MIN_DURATION_MIN}–{MAX_DURATION_MIN} minutes
          </p>
          {customInvalid ? (
            <p id={errorId} role="alert" className="mt-1 text-[13px] text-danger-text">
              {INVALID_DURATION_COPY}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
