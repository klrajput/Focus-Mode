/*
 * ScheduleDialog — create/edit a recurring focus block (UX_SPEC §4.7, FR-012, T-067).
 *
 * The form reuses the frozen shared field schemas (`displayNameSchema`, `scheduleDaysSchema`,
 * `scheduleStartTimeSchema`, `durationMinSchema`) so the client and the server reject exactly the
 * same input (NFR-001): days are a non-empty subset of 0–6, `startTime` is 24-hour `HH:mm` and
 * `durationMin` is an integer 1–480. Nothing here starts a session — the server scheduler owns
 * execution; this dialog only writes the schedule record.
 */

import { useEffect, useId } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  displayNameSchema,
  durationMinSchema,
  scheduleDaysSchema,
  scheduleStartTimeSchema,
} from '@focus-mode/shared';
import { z } from 'zod';

import type { Schedule } from '../../api/types';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input } from '../ui/input';

/**
 * Same rules as `scheduleCreateSchema`, with `enabled` required because this form always submits it.
 * Reusing the shared field schemas keeps the server and the client in lockstep.
 */
export const scheduleFormSchema = z.strictObject({
  name: displayNameSchema,
  days: scheduleDaysSchema,
  startTime: scheduleStartTimeSchema,
  durationMin: durationMinSchema,
  enabled: z.boolean(),
});

export type ScheduleFormValues = z.infer<typeof scheduleFormSchema>;

const DAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
] as const;

const EMPTY_VALUES: ScheduleFormValues = {
  name: '',
  days: [],
  startTime: '09:00',
  durationMin: 60,
  enabled: true,
};

function valuesFrom(schedule: Schedule | undefined): ScheduleFormValues {
  if (schedule === undefined) return EMPTY_VALUES;
  return {
    name: schedule.name,
    days: [...schedule.days].sort((a, b) => a - b),
    startTime: schedule.startTime,
    durationMin: schedule.durationMin,
    enabled: schedule.enabled,
  };
}

/** Friendly wrapper around the shared schema's technical zod messages (rules stay shared). */
function displayError(
  field: 'name' | 'startTime' | 'durationMin',
  error: { message?: string; type?: string } | undefined,
): string | undefined {
  if (error === undefined) return undefined;
  switch (field) {
    case 'name':
      return 'Enter a name between 2 and 60 characters.';
    case 'startTime':
      // UX_SPEC §13.4 F-102: the shared schema's raw "startTime must be 24-hour HH:mm" leaks a
      // field name. The rule stays shared; only the rendered sentence becomes user copy.
      return 'Use 24-hour HH:mm, for example 09:00.';
    case 'durationMin':
      return 'Enter a whole number of minutes between 1 and 480.';
  }
}

export interface ScheduleDialogProps {
  open: boolean;
  /** `undefined` = create; a schedule = edit. */
  schedule?: Schedule | undefined;
  onClose: () => void;
  /** Resolves true when the API accepted the schedule (the dialog then closes). */
  onSubmit: (values: ScheduleFormValues) => Promise<boolean>;
  busy: boolean;
}

export function ScheduleDialog({ open, schedule, onClose, onSubmit, busy }: ScheduleDialogProps) {
  const formId = useId();
  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: EMPTY_VALUES,
    mode: 'onSubmit',
  });

  const { errors, isSubmitting } = form.formState;
  const selectedDays = form.watch('days');

  useEffect(() => {
    if (!open) return;
    form.reset(valuesFrom(schedule));
  }, [open, schedule, form]);

  async function submit(values: ScheduleFormValues): Promise<void> {
    const saved = await onSubmit(values);
    if (saved) onClose();
  }

  function toggleDay(day: number): void {
    const next = selectedDays.includes(day)
      ? selectedDays.filter((value) => value !== day)
      : [...selectedDays, day].sort((a, b) => a - b);
    form.setValue('days', next, { shouldValidate: form.formState.isSubmitted });
  }

  const isEdit = schedule !== undefined;

  return (
    <Dialog
      open={open}
      title={isEdit ? 'Edit schedule' : 'New schedule'}
      description="Times are in your timezone. A scheduled session only starts while your Focus Agent is connected."
      onClose={() => {
        if (busy || isSubmitting) return;
        onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy || isSubmitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void form.handleSubmit(submit)()}
            loading={busy || isSubmitting}
            loadingLabel="Saving…"
          >
            {isEdit ? 'Save changes' : 'Save schedule'}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-4" onSubmit={form.handleSubmit(submit)} noValidate>
        <Input
          {...form.register('name')}
          label="Name"
          placeholder="Coding block"
          autoComplete="off"
          requiredText
          error={displayError('name', errors.name)}
        />

        <fieldset className="min-w-0">
          <legend className="text-[13px] font-medium text-ink">
            Days <span className="font-normal text-muted">Required</span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {DAYS.map((day) => {
              const selected = selectedDays.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleDay(day.value)}
                  className={`inline-flex h-10 min-w-[52px] items-center justify-center rounded-[var(--radius-control)] border px-3 text-[13px] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none ${
                    selected
                      ? 'border-primary bg-primary-subtle text-primary-active'
                      : 'border-border-strong bg-card text-ink hover:bg-primary-subtle'
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
          {errors.days === undefined ? null : (
            <p className="mt-1.5 text-[13px] font-medium text-danger-text">{errors.days.message}</p>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            {...form.register('startTime')}
            label="Start time"
            hint="24-hour HH:mm, for example 09:00."
            placeholder="09:00"
            inputMode="numeric"
            autoComplete="off"
            error={displayError('startTime', errors.startTime)}
          />
          <Input
            {...form.register('durationMin', { valueAsNumber: true })}
            label="Duration in minutes"
            hint="1–480 minutes."
            type="number"
            min={1}
            max={480}
            step={1}
            error={displayError('durationMin', errors.durationMin)}
          />
        </div>

        <label className="flex items-start gap-2 text-[15px] text-ink">
          <input
            {...form.register('enabled')}
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
          />
          <span>
            Enabled
            <span className="block text-[13px] font-normal text-muted">
              Disabled schedules keep their settings but never start a session.
            </span>
          </span>
        </label>
      </form>
    </Dialog>
  );
}
