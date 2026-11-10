/*
 * `/settings` (UX_SPEC §4.9, T-036 owns editing).
 * W1 shows the real public user from `GET /auth/me` (read-only) with loading / error / success
 * states. Profile editing, password change, unpair-all and download links land with T-036; the
 * start-at-login toggle stays in the Focus Agent tray (REC-008, DEC-012 Q5) and is deliberately
 * absent here. Sign out is real.
 */

import { Download, LogOut } from 'lucide-react';

import { useAuth } from '../auth/auth-context';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { ErrorState } from '../components/ui/error-state';
import { Skeleton } from '../components/ui/loading';
import { PageHeader } from '../components/ui/page-header';
import { useMe } from '../hooks/use-me';
import { formatDate, formatDuration } from '../lib/format';
import { errorCodeOf } from '../lib/route-state';

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="truncate text-[15px] text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}

export function SettingsPage() {
  const { logout } = useAuth();
  const meQuery = useMe();

  return (
    <>
      <PageHeader title="Settings" description="Your profile and Focus Agent setup." />

      {meQuery.isPending ? (
        <div role="status" aria-live="polite" className="space-y-4">
          <span className="sr-only">Loading your settings…</span>
          <Skeleton className="h-6 w-1/4" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {meQuery.isError ? (
        <ErrorState
          title="We couldn't load your settings."
          message="Check your connection and try again."
          code={errorCodeOf(meQuery.error)}
          onRetry={() => void meQuery.refetch()}
        />
      ) : null}

      {meQuery.isSuccess ? (
        <div className="grid gap-4">
          <Card ariaLabelledBy="profile-heading">
            <CardHeader
              title="Profile"
              titleId="profile-heading"
              description="Read-only in W1. Editing lands with T-036."
            />
            <CardBody>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Detail label="Name" value={meQuery.data.name} />
                <Detail label="Email" value={meQuery.data.email} />
                <Detail label="Role" value={meQuery.data.role} />
                <Detail label="Timezone" value={meQuery.data.timezone} />
                <Detail
                  label="Default duration"
                  value={formatDuration(meQuery.data.defaultDurationMin)}
                />
                <Detail label="Member since" value={formatDate(meQuery.data.createdAt)} />
              </dl>
              <p className="mt-4 text-[13px] text-muted">
                Email is managed by your account; changing it needs an admin. Profile editing,
                password change and unpair-all land with T-036 (W2).
              </p>
            </CardBody>
          </Card>

          <Card ariaLabelledBy="downloads-heading">
            <CardHeader
              title="Focus Agent"
              titleId="downloads-heading"
              description="The desktop companion that applies focus."
            />
            <CardBody>
              <EmptyState
                icon={Download}
                title="Installer links are being published — check back soon."
                description="Once an admin publishes the macOS, Windows and Linux installers, the download buttons appear here."
                className="border-0 p-0 shadow-none sm:p-0"
              />
              <p className="mt-4 text-[13px] text-muted">
                Start at login is controlled in the Focus Agent tray, never from this dashboard
                (REC-008).
              </p>
            </CardBody>
          </Card>

          <Card ariaLabelledBy="session-heading">
            <CardHeader title="This session" titleId="session-heading" />
            <CardBody>
              <Button
                variant="secondary"
                onClick={() => void logout()}
                leadingIcon={<LogOut aria-hidden="true" className="h-4 w-4" />}
              >
                Sign out
              </Button>
            </CardBody>
          </Card>
        </div>
      ) : null}
    </>
  );
}
