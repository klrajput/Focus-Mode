/*
 * Admin → Presets (UX_SPEC §4.10, INTEGRATION_CONTRACTS §3.1 #28–#31, FR-019).
 * Lists every published preset with its app count, opens the create/edit dialog and deletes after a
 * confirmation. The `/presets` cache is invalidated by the hooks so users never see a stale picker.
 */

import { useState } from 'react';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

import type { Preset } from '../../api/types';
import { copyForError } from '../../copy/errors';
import { useAdminPresets, useDeletePreset } from '../../hooks/use-admin-presets';
import { errorCodeOf } from '../../lib/route-state';
import { Button } from '../ui/button';
import { Card, CardBody } from '../ui/card';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { EmptyState } from '../ui/empty-state';
import { ErrorState } from '../ui/error-state';
import { Skeleton } from '../ui/loading';
import { PresetDialog } from './preset-dialog';

export function PresetsTab() {
  const presetsQuery = useAdminPresets();
  const deletePreset = useDeletePreset();

  const [dialogKey, setDialogKey] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Preset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Preset | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const presets = presetsQuery.data ?? [];

  function openCreate(): void {
    setEditing(null);
    setDialogKey('new');
    setDialogOpen(true);
  }

  function openEdit(preset: Preset): void {
    setEditing(preset);
    setDialogKey(preset.id);
    setDialogOpen(true);
  }

  async function confirmDelete(): Promise<void> {
    if (deleteTarget === null) return;
    setDeleteError(null);
    try {
      await deletePreset.mutateAsync(deleteTarget.id);
      toast.success('Preset deleted');
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(copyForError(error));
    }
  }

  return (
    <>
      <Card ariaLabelledBy="presets-heading">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="presets-heading" className="text-[20px] leading-[1.3] font-semibold text-ink">
              Presets
            </h2>
            <p className="mt-0.5 text-[13px] text-muted">
              App bundles users can apply to their allow-list.
            </p>
          </div>
          <Button
            onClick={openCreate}
            leadingIcon={<Plus aria-hidden="true" className="h-4 w-4" />}
          >
            New preset
          </Button>
        </div>

        <CardBody>
          {presetsQuery.isPending ? (
            <div role="status" aria-live="polite" className="space-y-3">
              <span className="sr-only">Loading presets…</span>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-5/6" />
            </div>
          ) : null}

          {presetsQuery.isError ? (
            <ErrorState
              title="We couldn't load admin data."
              message="Check your connection and try again."
              code={errorCodeOf(presetsQuery.error)}
              onRetry={() => void presetsQuery.refetch()}
            />
          ) : null}

          {presetsQuery.isSuccess && presets.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No presets yet. Create the first one."
              action={<Button onClick={openCreate}>New preset</Button>}
              className="border-0 p-0 shadow-none sm:p-0"
            />
          ) : null}

          {presets.length > 0 ? (
            <ul className="divide-y divide-border">
              {presets.map((preset) => (
                <li
                  key={preset.id}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-primary-subtle text-primary-active"
                  >
                    <Layers className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium text-ink" title={preset.name}>
                      {preset.name}
                    </p>
                    <p className="text-[13px] text-muted">
                      {preset.apps.length} app{preset.apps.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openEdit(preset)}
                      leadingIcon={<Pencil aria-hidden="true" className="h-4 w-4" />}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(preset);
                      }}
                      leadingIcon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      {dialogOpen ? (
        <PresetDialog
          key={dialogKey ?? 'new'}
          preset={editing}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this preset?"
        description={
          deleteTarget === null
            ? undefined
            : `${deleteTarget.name} will no longer be available to users. Allow-lists already applied from it are not changed.`
        }
        confirmLabel="Delete preset"
        loadingLabel="Deleting…"
        pending={deletePreset.isPending}
        error={deleteError}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
