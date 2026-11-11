/*
 * Admin preset create/edit dialog (UX_SPEC §4.10, INTEGRATION_CONTRACTS §3.1 #29–#30, FR-019).
 * A preset is a name plus 1–50 app entries; both fields are validated with the shared app-entry
 * rules (`appKeySchema`/`appLabelSchema` via `appEntrySchema`) so the API and the form cannot drift.
 * The dialog only closes after the server accepts the write.
 */

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import {
  appEntrySchema,
  displayNameSchema,
  hasDuplicateAppKeys,
  UNIQUE_APP_KEYS_MESSAGE,
} from '@focus-mode/shared';

import type { Preset } from '../../api/types';
import { isApiError } from '../../api/errors';
import { copyForError, ERROR_MESSAGES } from '../../copy/errors';
import { useCreatePreset, useUpdatePreset } from '../../hooks/use-admin-presets';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input } from '../ui/input';

const presetAppSchema = appEntrySchema.pick({ key: true, label: true });

const presetFormSchema = z.object({
  name: displayNameSchema,
  apps: z
    .array(presetAppSchema)
    .min(1, 'Add at least one app.')
    .max(50, 'A preset can hold at most 50 apps.')
    .refine((apps) => !hasDuplicateAppKeys(apps), UNIQUE_APP_KEYS_MESSAGE),
});

type PresetFormValues = z.infer<typeof presetFormSchema>;

export interface PresetDialogProps {
  /** `null` creates a new preset; a preset edits it. */
  preset: Preset | null;
  onClose: () => void;
}

export function PresetDialog({ preset, onClose }: PresetDialogProps) {
  const createPreset = useCreatePreset();
  const updatePreset = useUpdatePreset();
  const [banner, setBanner] = useState<string | null>(null);

  const form = useForm<PresetFormValues>({
    resolver: zodResolver(presetFormSchema),
    defaultValues:
      preset === null
        ? { name: '', apps: [{ key: '', label: '' }] }
        : {
            name: preset.name,
            apps: preset.apps.map((app) => ({ key: app.key, label: app.label })),
          },
    mode: 'onSubmit',
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'apps' });
  const { errors, isSubmitting } = form.formState;
  // react-hook-form reports array-level resolver errors (min/max/refine) on `apps.root`, not on
  // `apps.message`; read both so the shared "App keys must be unique" message is actually shown.
  const appsError = errors.apps?.root?.message ?? errors.apps?.message;

  async function onSubmit(values: PresetFormValues): Promise<void> {
    setBanner(null);
    try {
      if (preset === null) {
        await createPreset.mutateAsync(values);
      } else {
        await updatePreset.mutateAsync({ id: preset.id, input: values });
      }
      toast.success('Preset published');
      onClose();
    } catch (error) {
      if (isApiError(error) && error.code === 'VALIDATION_ERROR' && error.details.length > 0) {
        for (const issue of error.details) {
          const match = /^apps\.(\d+)\.(key|label)$/.exec(issue.path);
          if (match !== null) {
            const index = Number(match[1]);
            const field = match[2];
            if (field === 'key' || field === 'label') {
              form.setError(`apps.${index}.${field}`, { type: 'server', message: issue.message });
            }
          } else if (issue.path === 'name') {
            form.setError('name', { type: 'server', message: issue.message });
          }
        }
        setBanner(ERROR_MESSAGES.VALIDATION_ERROR);
        return;
      }
      setBanner(copyForError(error));
    }
  }

  return (
    <Dialog
      open
      title={preset === null ? 'New preset' : 'Edit preset'}
      description="A preset is a bundle of allow-listed apps any user can apply."
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="preset-form" loading={isSubmitting} loadingLabel="Saving…">
            {preset === null ? 'Publish preset' : 'Save preset'}
          </Button>
        </>
      }
    >
      {banner === null ? null : (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-[13px] leading-[1.45] font-medium text-danger-text"
        >
          {banner}
        </p>
      )}

      <form
        id="preset-form"
        className="grid gap-4"
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
      >
        <Input
          label="Preset name"
          requiredText
          placeholder="Coding"
          error={errors.name?.message}
          {...form.register('name')}
        />

        <fieldset className="min-w-0">
          <legend className="text-[13px] font-medium text-ink">Apps in this preset</legend>
          <p className="mt-1 text-[13px] text-muted">
            Keys are stable lowercase slugs (2–40 characters of a–z, 0–9 or “-”); labels are what
            users see.
          </p>

          <ul className="mt-3 space-y-3">
            {fields.map((field, index) => (
              <li
                key={field.id}
                className="rounded-[var(--radius-control)] border border-border p-3"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label={`App ${index + 1} key`}
                    requiredText
                    placeholder="vs-code"
                    error={errors.apps?.[index]?.key?.message}
                    {...form.register(`apps.${index}.key`)}
                  />
                  <Input
                    label={`App ${index + 1} label`}
                    requiredText
                    placeholder="VS Code"
                    error={errors.apps?.[index]?.label?.message}
                    {...form.register(`apps.${index}.label`)}
                  />
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={fields.length === 1}
                    onClick={() => remove(index)}
                    leadingIcon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                  >
                    Remove app
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {appsError === undefined ? null : (
            <p role="alert" className="mt-2 text-[13px] font-medium text-danger-text">
              {appsError}
            </p>
          )}

          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={fields.length >= 50}
            onClick={() => append({ key: '', label: '' })}
            leadingIcon={<Plus aria-hidden="true" className="h-4 w-4" />}
          >
            Add app
          </Button>
        </fieldset>
      </form>
    </Dialog>
  );
}
