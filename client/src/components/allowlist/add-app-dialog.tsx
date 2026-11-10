/*
 * AddAppDialog — the `/allowlist` add flow (UX_SPEC §4.6, FR-020/REC-007).
 *
 * Two honest paths, exactly as the wireframe asks:
 *   · "Running apps" comes from the Focus Agent's `listApps` reply (key + label + running only —
 *     REC-007/INV-6: no window titles ever leave the machine). The page triggers `listApps`; this
 *     dialog only renders what the agent sent.
 *   · "Add manually" validates the key/label with the shared `appEntrySchema` fields, so the client
 *     and the server apply the same rules (NFR-001).
 * Protected and already-listed keys are rejected here with the approved copy; the server still
 * enforces both (400 PROTECTED_ENTRY / VALIDATION_ERROR) and the page surfaces that banner.
 */

import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { RefreshCw } from 'lucide-react';
import { appEntrySchema } from '@focus-mode/shared';
import type { AppEntry, RunningApp } from '@focus-mode/shared';
import type { z } from 'zod';

import { ERROR_MESSAGES } from '../../copy/errors';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input } from '../ui/input';

/** Only the two manual fields; the shared `appEntrySchema` keeps client/server rules identical. */
const manualAppSchema = appEntrySchema.pick({ key: true, label: true });

type ManualAppInput = z.infer<typeof manualAppSchema>;

/** Friendly display for the shared schema's technical zod messages (the rules stay shared). */
const FIELD_COPY: Readonly<Record<'key' | 'label', string>> = Object.freeze({
  key: 'Use 2–40 lowercase letters, numbers or dashes.',
  label: 'Enter a name between 2 and 60 characters.',
});

/** Custom messages (duplicate/protected) pass through; raw zod messages become friendly copy. */
function displayError(
  field: 'key' | 'label',
  error: { message?: string; type?: string } | undefined,
): string | undefined {
  if (error === undefined) return undefined;
  if (error.type === 'duplicate' || error.type === 'protected') return error.message;
  return FIELD_COPY[field];
}

export interface AddAppDialogProps {
  open: boolean;
  onClose: () => void;
  protectedApps: readonly AppEntry[];
  userApps: readonly AppEntry[];
  /** `null` until the agent answers `listApps`. */
  runningApps: readonly RunningApp[] | null;
  /** False while the local link is not attested; the picker explains why it is unavailable. */
  agentConnected: boolean;
  onRequestRunningApps: () => void;
  /** Resolves true when the API accepted the new allow-list (the dialog then closes). */
  onAdd: (apps: AppEntry[]) => Promise<boolean>;
  /** Mutation error from the page (`PROTECTED_ENTRY`, `VALIDATION_ERROR`, …), already user copy. */
  error: string | null;
  busy: boolean;
}

export function AddAppDialog({
  open,
  onClose,
  protectedApps,
  userApps,
  runningApps,
  agentConnected,
  onRequestRunningApps,
  onAdd,
  error,
  busy,
}: AddAppDialogProps) {
  const form = useForm<ManualAppInput>({
    resolver: zodResolver(manualAppSchema),
    defaultValues: { key: '', label: '' },
    mode: 'onSubmit',
  });

  const { errors } = form.formState;

  useEffect(() => {
    if (open) return;
    form.reset({ key: '', label: '' });
  }, [open, form]);

  // Opening the picker asks the agent once (REC-007). `runningApps` staying null just means the
  // agent has not answered yet; the effect cannot loop on a stable null value.
  useEffect(() => {
    if (open && agentConnected && runningApps === null) onRequestRunningApps();
  }, [open, agentConnected, runningApps, onRequestRunningApps]);

  const takenKeys = new Set([
    ...userApps.map((app) => app.key),
    ...protectedApps.map((app) => app.key),
  ]);
  const availableRunning = (runningApps ?? []).filter((app) => !takenKeys.has(app.key));

  function close(): void {
    if (busy) return;
    onClose();
  }

  async function submitManual(values: ManualAppInput): Promise<void> {
    const key = values.key.trim();
    const label = values.label.trim();

    if (protectedApps.some((app) => app.key === key)) {
      form.setError('key', { type: 'protected', message: ERROR_MESSAGES.PROTECTED_ENTRY });
      return;
    }
    if (userApps.some((app) => app.key === key)) {
      form.setError('key', {
        type: 'duplicate',
        message: 'That app is already on your allow-list.',
      });
      return;
    }

    const added = await onAdd([{ key, label }]);
    if (added) close();
  }

  async function addRunningApp(app: RunningApp): Promise<void> {
    const added = await onAdd([{ key: app.key, label: app.label }]);
    if (added) close();
  }

  return (
    <Dialog
      open={open}
      title="Add an app"
      description="These apps stay open during focus. Everything else steps aside — never closed."
      onClose={close}
      footer={
        <Button variant="secondary" onClick={close} disabled={busy}>
          Cancel
        </Button>
      }
    >
      <div className="space-y-6">
        {error === null ? null : (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-[13px] leading-[1.45] font-medium text-danger-text"
          >
            {error}
          </p>
        )}

        <section aria-labelledby="running-apps-heading" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="running-apps-heading" className="text-[15px] font-semibold text-ink">
              Running on this computer
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRequestRunningApps}
              disabled={!agentConnected || busy}
              leadingIcon={<RefreshCw aria-hidden="true" className="h-4 w-4" />}
            >
              {runningApps === null ? 'Check running apps' : 'Refresh'}
            </Button>
          </div>

          {!agentConnected ? (
            <p className="mt-1 text-[13px] leading-[1.45] text-muted">
              Your Focus Agent isn&apos;t connected, so running apps can&apos;t be listed. You can
              still add an app manually.
            </p>
          ) : runningApps === null ? (
            <p className="mt-1 text-[13px] leading-[1.45] text-muted">
              Ask your Focus Agent which apps are running. Only app names are shared — never window
              titles.
            </p>
          ) : availableRunning.length === 0 ? (
            <p className="mt-1 text-[13px] leading-[1.45] text-muted">
              No new apps to add from the running list. Add one manually below.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {availableRunning.map((app) => (
                <li
                  key={app.key}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="min-w-0 text-[15px] text-ink">
                    <span className="truncate">{app.label}</span>
                    <span className="ml-2 text-[13px] text-muted">
                      {app.running ? 'Running' : 'Not running'}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void addRunningApp(app)}
                    disabled={busy}
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="manual-app-heading"
          className="min-w-0 border-t border-border pt-5"
        >
          <h3 id="manual-app-heading" className="text-[15px] font-semibold text-ink">
            Add manually
          </h3>
          <p className="mt-1 text-[13px] leading-[1.45] text-muted">
            Use the app&apos;s name and a short lowercase key, for example <code>vscode</code>.
          </p>

          <form className="mt-3 space-y-3" onSubmit={form.handleSubmit(submitManual)} noValidate>
            <Input
              {...form.register('label')}
              label="App name"
              placeholder="Visual Studio Code"
              autoComplete="off"
              error={displayError('label', errors.label)}
            />
            <Input
              {...form.register('key')}
              label="App key"
              hint="2–40 characters: lowercase letters, numbers or dashes."
              placeholder="vscode"
              autoComplete="off"
              className="max-w-[320px]"
              error={displayError('key', errors.key)}
            />

            <Button
              type="submit"
              loading={busy}
              loadingLabel="Saving…"
              className="w-full sm:w-auto"
            >
              Add app
            </Button>
          </form>
        </section>
      </div>
    </Dialog>
  );
}
