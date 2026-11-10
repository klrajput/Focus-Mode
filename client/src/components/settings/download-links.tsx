/*
 * DownloadLinks — the only place installer buttons are rendered (UX_SPEC §4.1/§4.9, FR-029).
 * It reads the public `GET /agent-links` list and renders exactly the URLs an admin published:
 * nothing is guessed per OS, no version is invented, and a link with a non-HTTPS scheme is skipped
 * rather than offered as a download. Loading, empty, error and success copy come from §6.1.
 */

import { Download } from 'lucide-react';
import type { OsName } from '@focus-mode/shared';

import type { AgentLink } from '../../api/types';
import { useAgentLinks } from '../../hooks/use-agent-links';
import { formatDate, formatOs } from '../../lib/format';
import { errorCodeOf } from '../../lib/route-state';
import { EmptyState } from '../ui/empty-state';
import { ErrorState } from '../ui/error-state';
import { Skeleton } from '../ui/loading';

const OS_ORDER: readonly OsName[] = ['macOS', 'windows', 'linux'];

/** A download is only offered when it is an absolute HTTPS URL (never `javascript:` etc.). */
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function groupByOs(links: readonly AgentLink[]): { os: OsName; links: AgentLink[] }[] {
  return OS_ORDER.map((os) => ({ os, links: links.filter((link) => link.os === os) })).filter(
    (group) => group.links.length > 0,
  );
}

const ARCH_LABEL: Readonly<Record<AgentLink['arch'], string>> = {
  x64: 'Intel / x64',
  arm64: 'Apple silicon / ARM64',
  universal: 'Universal',
};

export function DownloadLinks({ className }: { className?: string }) {
  const linksQuery = useAgentLinks();

  if (linksQuery.isPending) {
    return (
      <div role="status" aria-live="polite" className={className}>
        <span className="sr-only">Loading downloads…</span>
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-11 w-36" />
          ))}
        </div>
      </div>
    );
  }

  if (linksQuery.isError) {
    return (
      <ErrorState
        className={className}
        title="We couldn't load downloads."
        message="Check your connection and try again."
        code={errorCodeOf(linksQuery.error)}
        onRetry={() => void linksQuery.refetch()}
      />
    );
  }

  const links = (linksQuery.data ?? []).filter((link) => isHttpsUrl(link.url));

  if (links.length === 0) {
    return (
      <EmptyState
        className={className}
        icon={Download}
        title="Installer links are being published — check back soon."
        description="An admin publishes the macOS, Windows and Linux installers."
      />
    );
  }

  return (
    <div className={className}>
      <ul className="grid gap-3 sm:grid-cols-3">
        {groupByOs(links).map((group) => (
          <li
            key={group.os}
            className="min-w-0 rounded-[var(--radius-card)] border border-border bg-card p-4"
          >
            <p className="text-[13px] font-medium text-muted">{formatOs(group.os)}</p>
            <ul className="mt-2 space-y-2">
              {group.links.map((link) => (
                <li key={link.id} className="min-w-0">
                  <a
                    href={link.url}
                    aria-label={`Download ${link.label} — version ${link.version}`}
                    className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm font-medium text-primary hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
                  >
                    <Download aria-hidden="true" className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {link.label} · {link.version}
                    </span>
                  </a>
                  <p className="mt-1 text-[13px] text-muted">
                    {ARCH_LABEL[link.arch]} · published {formatDate(link.publishedAt)}
                  </p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[13px] leading-[1.45] text-muted">
        These installers are unsigned builds. Your operating system may show a security warning the
        first time you open the Focus Agent.
      </p>
    </div>
  );
}
