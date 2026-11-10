/*
 * `/allowlist` (UX_SPEC §4.6, T-034 owns the editor).
 * W1 reads the real allow-list: protected entries are shown as locked rows with a lock icon +
 * "Protected" text (never an edit control — INV-3), and user apps render as chips. Editing,
 * manual add and preset application are explicitly deferred to T-034; nothing pretends to save.
 */

import { Lock, ShieldCheck } from 'lucide-react';

import { StatusBadge } from '../components/ui/status-badge';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { ErrorState } from '../components/ui/error-state';
import { Skeleton } from '../components/ui/loading';
import { PageHeader } from '../components/ui/page-header';
import { useAllowlist } from '../hooks/use-allowlist';
import { errorCodeOf } from '../lib/route-state';

export function AllowlistPage() {
  const allowlistQuery = useAllowlist();
  const allowlist = allowlistQuery.data;

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
          <Card ariaLabelledBy="protected-heading">
            <CardHeader
              title="Protected — always stays open"
              titleId="protected-heading"
              description="Locked by the Focus Agent. These rows can never be removed or edited."
            />
            <CardBody>
              <ul className="divide-y divide-border">
                {allowlist.protectedApps.map((app) => (
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
            />
            <CardBody>
              {allowlist.userApps.length === 0 ? (
                <p className="text-[15px] text-muted">
                  Only protected apps are allow-listed right now. Add the apps you need for a focus
                  session.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {allowlist.userApps.map((app) => (
                    <li
                      key={app.key}
                      className="inline-flex max-w-full items-center gap-2 rounded-[var(--radius-pill)] border border-border-strong bg-card px-3 py-1.5 text-[13px] text-ink"
                    >
                      <ShieldCheck
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-focus-strong"
                      />
                      <span className="truncate">{app.label}</span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-4 text-[13px] text-muted">
                Allow-list version {allowlist.version}. Editing and adding apps aren&apos;t
                available yet.
              </p>
            </CardBody>
          </Card>

          <p className="text-[13px] text-muted">
            We move windows aside during focus — we never close or quit an app.
          </p>
        </div>
      ) : null}
    </>
  );
}
