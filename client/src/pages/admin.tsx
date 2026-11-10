/*
 * `/admin` (UX_SPEC §4.10, ADMIN only; T-073+ owns the tabs).
 * W1 renders the real `GET /admin/users` list with loading / empty / error / success states.
 * Presets, agent links and aggregate stats are explicitly deferred, and no per-user session detail
 * is ever requested here (PDF §6). The route itself is wrapped in `RequireRole role="ADMIN"` and
 * the API enforces 403 FORBIDDEN regardless — the guard is UX, not security.
 */

import { Shield, ShieldCheck, User } from 'lucide-react';

import { StatusBadge } from '../components/ui/status-badge';
import { Card, CardBody } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { ErrorState } from '../components/ui/error-state';
import { Skeleton } from '../components/ui/loading';
import { PageHeader } from '../components/ui/page-header';
import { useAdminUsers } from '../hooks/use-admin-users';
import { formatDate } from '../lib/format';
import { errorCodeOf } from '../lib/route-state';

export function AdminPage() {
  const usersQuery = useAdminUsers({ limit: 20, sort: '-createdAt' });
  const users = usersQuery.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Admin"
        description="Users, presets, download links and aggregate stats. No per-user session detail is shown."
      />

      <div className="grid gap-4">
        <Card ariaLabelledBy="users-heading">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 id="users-heading" className="text-[20px] leading-[1.3] font-semibold text-ink">
                Users
              </h2>
              <p className="mt-0.5 text-[13px] text-muted">
                {usersQuery.isSuccess
                  ? `${usersQuery.data.total} total, newest first`
                  : 'Newest first'}
              </p>
            </div>
          </div>

          <CardBody>
            {usersQuery.isPending ? (
              <div role="status" aria-live="polite" className="space-y-3">
                <span className="sr-only">Loading admin data…</span>
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-5/6" />
                <Skeleton className="h-6 w-2/3" />
              </div>
            ) : null}

            {usersQuery.isError ? (
              <ErrorState
                title="We couldn't load admin data."
                message="Check your connection and try again."
                code={errorCodeOf(usersQuery.error)}
                onRetry={() => void usersQuery.refetch()}
              />
            ) : null}

            {usersQuery.isSuccess && users.length === 0 ? (
              <EmptyState
                icon={User}
                title="No users match your filters."
                className="border-0 p-0 shadow-none sm:p-0"
              />
            ) : null}

            {usersQuery.isSuccess && users.length > 0 ? (
              <ul className="divide-y divide-border">
                {users.map((user) => (
                  <li key={user.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium text-ink">{user.name}</p>
                        <p className="truncate text-[13px] text-muted">{user.email}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          tone={user.role === 'ADMIN' ? 'info' : 'neutral'}
                          icon={user.role === 'ADMIN' ? ShieldCheck : User}
                        >
                          {user.role === 'ADMIN' ? 'Admin' : 'User'}
                        </StatusBadge>
                        <StatusBadge tone={user.isActive ? 'success' : 'danger'} icon={Shield}>
                          {user.isActive ? 'Active' : 'Disabled'}
                        </StatusBadge>
                      </div>
                    </div>
                    <p className="mt-1 text-[13px] text-muted">
                      Joined {formatDate(user.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>

        <p className="text-[13px] text-muted">
          User management actions, presets, download links and aggregate stats aren&apos;t available
          yet.
        </p>
      </div>
    </>
  );
}
