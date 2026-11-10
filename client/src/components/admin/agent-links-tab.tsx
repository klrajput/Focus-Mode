/*
 * Admin → Agent links (UX_SPEC §4.10, INTEGRATION_CONTRACTS §3.1 #32–#35, FR-019).
 * Lists the published installers, creates/edits them through the shared schema dialog and deletes
 * after confirmation. Only real, HTTPS URLs are published because this list is what the public
 * landing page and `/settings` download buttons render.
 */

import { useState } from 'react';
import { ExternalLink, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

import type { AgentLink } from '../../api/types';
import { copyForError } from '../../copy/errors';
import { useAdminAgentLinks, useDeleteAgentLink } from '../../hooks/use-admin-agent-links';
import { formatDate, formatOs } from '../../lib/format';
import { errorCodeOf } from '../../lib/route-state';
import { Button } from '../ui/button';
import { Card, CardBody } from '../ui/card';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { EmptyState } from '../ui/empty-state';
import { ErrorState } from '../ui/error-state';
import { Skeleton } from '../ui/loading';
import { AgentLinkDialog } from './agent-link-dialog';

const ARCH_LABEL: Readonly<Record<AgentLink['arch'], string>> = {
  x64: 'x64',
  arm64: 'arm64',
  universal: 'universal',
};

export function AgentLinksTab() {
  const linksQuery = useAdminAgentLinks();
  const deleteLink = useDeleteAgentLink();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState('new');
  const [editing, setEditing] = useState<AgentLink | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentLink | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const links = linksQuery.data ?? [];

  function openCreate(): void {
    setEditing(null);
    setDialogKey('new');
    setDialogOpen(true);
  }

  function openEdit(link: AgentLink): void {
    setEditing(link);
    setDialogKey(link.id);
    setDialogOpen(true);
  }

  async function confirmDelete(): Promise<void> {
    if (deleteTarget === null) return;
    setDeleteError(null);
    try {
      await deleteLink.mutateAsync(deleteTarget.id);
      toast.success('Download link deleted');
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(copyForError(error));
    }
  }

  return (
    <>
      <Card ariaLabelledBy="agent-links-heading">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2
              id="agent-links-heading"
              className="text-[20px] leading-[1.3] font-semibold text-ink"
            >
              Agent links
            </h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Installer downloads shown on the landing page and in Settings.
            </p>
          </div>
          <Button
            onClick={openCreate}
            leadingIcon={<Plus aria-hidden="true" className="h-4 w-4" />}
          >
            New link
          </Button>
        </div>

        <CardBody>
          {linksQuery.isPending ? (
            <div role="status" aria-live="polite" className="space-y-3">
              <span className="sr-only">Loading download links…</span>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-5/6" />
            </div>
          ) : null}

          {linksQuery.isError ? (
            <ErrorState
              title="We couldn't load admin data."
              message="Check your connection and try again."
              code={errorCodeOf(linksQuery.error)}
              onRetry={() => void linksQuery.refetch()}
            />
          ) : null}

          {linksQuery.isSuccess && links.length === 0 ? (
            <EmptyState
              icon={Download}
              title="No download links yet. Publish the first installer."
              action={<Button onClick={openCreate}>New link</Button>}
              className="border-0 p-0 shadow-none sm:p-0"
            />
          ) : null}

          {links.length > 0 ? (
            <ul className="divide-y divide-border">
              {links.map((link) => (
                <li key={link.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium text-ink">
                        {formatOs(link.os)} · {ARCH_LABEL[link.arch]} · v{link.version}
                      </p>
                      <p className="text-[13px] text-muted">{link.label}</p>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-flex min-h-11 max-w-full items-center gap-1 text-[13px] text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        title={link.url}
                      >
                        <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{link.url}</span>
                      </a>
                      <p className="text-[13px] text-muted">
                        Published {formatDate(link.publishedAt)}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openEdit(link)}
                        leadingIcon={<Pencil aria-hidden="true" className="h-4 w-4" />}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(link);
                        }}
                        leadingIcon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      {dialogOpen ? (
        <AgentLinkDialog key={dialogKey} link={editing} onClose={() => setDialogOpen(false)} />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this download link?"
        description={
          deleteTarget === null
            ? undefined
            : `${formatOs(deleteTarget.os)} downloads will disappear from the landing page and Settings until you publish another link.`
        }
        confirmLabel="Delete link"
        loadingLabel="Deleting…"
        pending={deleteLink.isPending}
        error={deleteError}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
