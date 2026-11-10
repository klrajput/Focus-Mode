/*
 * `/allowlist` (UX_SPEC §4.6, T-066 / FR-008/FR-020, INV-3).
 *
 * Protected rows are always locked (lock icon + "Protected" text, never a remove control). The user
 * apps are edited through the real REST contract:
 *   remove / add → PUT /allowlist {userApps} (optimistic, rolled back on error, ≤50 unique keys)
 *   preset       → POST /allowlist/preset/:id?mode=merge|replace (the server returns the new list)
 * Apps can be picked from the Focus Agent's `listApps` reply (REC-007: labels only, never window
 * titles) or entered manually with the shared `appEntrySchema` rules. A 400 PROTECTED_ENTRY is
 * rendered as the approved inline banner and the optimistic row is restored.
 */

import { useState } from 'react';
import { Layers, Lock, Plus, ShieldCheck, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AppEntry } from '@focus-mode/shared';

import { useAgentLink } from '../agent/agent-link-provider';
import type { AllowList, Preset } from '../api/types';
import { AddAppDialog } from '../components/allowlist/add-app-dialog';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { ErrorState } from '../components/ui/error-state';
import { Skeleton } from '../components/ui/loading';
import { PageHeader } from '../components/ui/page-header';
import { StatusBadge } from '../components/ui/status-badge';
import { copyForError, ERROR_MESSAGES } from '../copy/errors';
import { useAllowlist, useApplyPreset, useUpdateAllowlist } from '../hooks/use-allowlist';
import { usePresets } from '../hooks/use-presets';
import { formatDate } from '../lib/format';
import { errorCodeOf } from '../lib/route-state';

/** REQUIREMENTS §7 / shared `MAX_USER_APPS`: at most 50 user apps per allow-list. */
const MAX_USER_APPS = 50;

function AppChip({ app, onRemove }: { app: AppEntry; onRemove: (app: AppEntry) => void }) {
  return (
    <li className="inline-flex max-w-full items-center gap-1 rounded-[var(--radius-pill)] border border-border-strong bg-card py-1 pr-1 pl-3 text-[13px] text-ink">
      <ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-focus-strong" />
      <span className="truncate py-0.5">{app.label}</span>
      <button
        type="button"
        onClick={() => onRemove(app)}
        aria-label={`Remove ${app.label}`}
        className="ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-pill)] text-muted hover:bg-danger-subtle hover:text-danger-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </li>
  );
}

function PresetsCard({
  presets,
  isPending,
  isError,
  onMerge,
  onReplace,
  pendingPresetId,
}: {
  presets: readonly Preset[];
  isPending: boolean;
  isError: boolean;
  onMerge: (preset: Preset) => void;
  onReplace: (preset: Preset) => void;
  pendingPresetId: string | null;
}) {
  return (
    <Card ariaLabelledBy="presets-heading">
      <CardHeader
        title="Presets"
        titleId="presets-heading"
        description="Published by an admin. Applying one never changes protected apps."
      />
      <CardBody>
        {isPending ? (
          <div role="status" aria-live="polite" className="space-y-3">
            <span className="sr-only">Loading presets…</span>
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : null}

        {!isPending && !isError && presets.length === 0 ? (
          <p className="text-[15px] text-muted">No presets published yet.</p>
        ) : null}

        {!isPending && presets.length > 0 ? (
          <ul className="divide-y divide-border">
            {presets.map((preset) => {
              const busy = pendingPresetId === preset.id;
              return (
                <li
                  key={preset.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[15px] text-ink">
                      <Layers aria-hidden="true" className="h-4 w-4 shrink-0 text-focus-strong" />
                      <span className="truncate">{preset.name}</span>
                    </p>
                    <p className="text-[13px] text-muted">
                      {preset.apps.length} {preset.apps.length === 1 ? 'app' : 'apps'} ·{' '}
                      {formatDate(preset.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onMerge(preset)}
                      loading={busy}
                      loadingLabel="Applying…"
                    >
                      Merge
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onReplace(preset)}
                      disabled={busy}
                    >
                      Replace…
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function AllowlistPage() {
  const agent = useAgentLink();
  const allowlistQuery = useAllowlist();
  const presetsQuery = usePresets();
  const updateAllowlist = useUpdateAllowlist();
  const applyPreset = useApplyPreset();

  const [addOpen, setAddOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<Preset | null>(null);

  const allowlist: AllowList | undefined = allowlistQuery.data;
  const userApps = allowlist?.userApps ?? [];
  const protectedApps = allowlist?.protectedApps ?? [];

  const atLimit = userApps.length >= MAX_USER_APPS;
  const agentConnected = agent.status === 'PAIRED' || agent.status === 'FOCUSING';

  function reportError(error: unknown): void {
    const message = copyForError(error);
    setBanner(message);
    toast.error(message);
  }

  async function saveUserApps(next: AppEntry[]): Promise<boolean> {
    setBanner(null);
    try {
      await updateAllowlist.mutateAsync(next);
      toast.success('Allow-list saved');
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  function removeApp(app: AppEntry): void {
    void saveUserApps(userApps.filter((entry) => entry.key !== app.key));
  }

  async function addApps(apps: AppEntry[]): Promise<boolean> {
    const next = [...userApps];
    for (const app of apps) {
      if (next.some((entry) => entry.key === app.key)) continue;
      if (protectedApps.some((entry) => entry.key === app.key)) {
        setBanner(ERROR_MESSAGES.PROTECTED_ENTRY);
        return false;
      }
      next.push(app);
    }

    if (next.length > MAX_USER_APPS) {
      setBanner(
        `You can allow-list at most ${MAX_USER_APPS} apps. Remove an app before adding another.`,
      );
      return false;
    }

    return saveUserApps(next);
  }

  async function applyPresetTo(mode: 'merge' | 'replace', preset: Preset): Promise<void> {
    setBanner(null);
    try {
      await applyPreset.mutateAsync({ id: preset.id, mode });
      toast.success('Allow-list saved');
    } catch (error) {
      reportError(error);
    }
  }

  return (
    <>
      <PageHeader
        title="Allow-list"
        description="These apps stay open during focus. Everything else steps aside — never closed."
      />

      {allowlistQuery.isPending ? (
        <div role="status" aria-live="polite" className="space-y-4">
          <span className="sr-only">Loading your allow-list…</span>
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}

      {allowlistQuery.isError ? (
        <ErrorState
          title="We couldn't load your allow-list."
          message="Check your connection and try again."
          code={errorCodeOf(allowlistQuery.error)}
          onRetry={() => void allowlistQuery.refetch()}
        />
      ) : null}

      {allowlistQuery.isSuccess && allowlist !== undefined ? (
        <div className="grid gap-4">
          {banner === null ? null : (
            <p
              role="alert"
              className="rounded-[var(--radius-control)] bg-danger-subtle px-4 py-3 text-[13px] leading-[1.45] font-medium text-danger-text"
            >
              {banner}
            </p>
          )}

          <Card ariaLabelledBy="protected-heading">
            <CardHeader
              title="Protected — always stays open"
              titleId="protected-heading"
              description="Locked by the Focus Agent. These rows can never be removed or edited."
            />
            <CardBody>
              <ul className="divide-y divide-border">
                {protectedApps.map((app) => (
                  <li
                    key={app.key}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-[15px] text-ink">
                      <Lock aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                      <span className="truncate">{app.label}</span>
                    </span>
                    <StatusBadge tone="neutral" icon={Lock}>
                      Protected
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card ariaLabelledBy="user-apps-heading">
            <CardHeader
              title="Your apps — these stay open"
              titleId="user-apps-heading"
              description="Everything not listed here will step aside during focus."
              action={
                <Button
                  onClick={() => {
                    setBanner(null);
                    setAddOpen(true);
                  }}
                  disabled={atLimit}
                  aria-describedby={atLimit ? 'user-apps-limit' : undefined}
                  leadingIcon={<Plus aria-hidden="true" className="h-4 w-4" />}
                >
                  Add app
                </Button>
              }
            />
            <CardBody>
              {userApps.length === 0 ? (
                <p className="text-[15px] text-muted">
                  Only protected apps are allow-listed right now. Add the apps you need for a focus
                  session.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {userApps.map((app) => (
                    <AppChip key={app.key} app={app} onRemove={removeApp} />
                  ))}
                </ul>
              )}

              <p id="user-apps-limit" className="mt-4 text-[13px] text-muted">
                {userApps.length} of {MAX_USER_APPS} apps
                {atLimit
                  ? ' — remove an app before adding another.'
                  : '. Removing an app takes effect the next time focus starts.'}
              </p>
            </CardBody>
          </Card>

          <PresetsCard
            presets={presetsQuery.data?.items ?? []}
            isPending={presetsQuery.isPending}
            isError={presetsQuery.isError}
            pendingPresetId={applyPreset.isPending ? (applyPreset.variables?.id ?? null) : null}
            onMerge={(preset) => void applyPresetTo('merge', preset)}
            onReplace={setReplaceTarget}
          />

          {presetsQuery.isError ? (
            <p role="alert" className="text-[13px] leading-[1.45] text-danger-text">
              We couldn&apos;t load presets. {copyForError(presetsQuery.error)}
            </p>
          ) : null}

          <p className="text-[13px] text-muted">
            We move windows aside during focus — we never close or quit an app.
          </p>
        </div>
      ) : null}

      <AddAppDialog
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setBanner(null);
        }}
        protectedApps={protectedApps}
        userApps={userApps}
        runningApps={agent.runningApps}
        agentConnected={agentConnected}
        onRequestRunningApps={agent.requestRunningApps}
        onAdd={addApps}
        error={banner}
        busy={updateAllowlist.isPending}
      />

      <Dialog
        open={replaceTarget !== null}
        title="Replace your allow-list?"
        description={
          replaceTarget === null
            ? undefined
            : `This replaces your apps with the ${replaceTarget.name} preset. Protected apps are never changed.`
        }
        onClose={() => setReplaceTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReplaceTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={applyPreset.isPending}
              loadingLabel="Replacing…"
              onClick={() => {
                if (replaceTarget === null) return;
                const target = replaceTarget;
                setReplaceTarget(null);
                void applyPresetTo('replace', target);
              }}
            >
              Replace allow-list
            </Button>
          </>
        }
      >
        <p className="text-[15px] text-ink">
          Your {userApps.length} {userApps.length === 1 ? 'app' : 'apps'} will be replaced by the
          preset. You can change the list again at any time.
        </p>
      </Dialog>
    </>
  );
}
