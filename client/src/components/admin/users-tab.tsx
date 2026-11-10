/*
 * Admin → Users (UX_SPEC §4.10, INTEGRATION_CONTRACTS §3.1 #26–#27, FR-019).
 * Search + pagination over the real `GET /admin/users` list, role/active badges, and the
 * deactivate/reactivate `PATCH /admin/users/:id`. Only aggregate user fields are shown — no
 * per-user session detail is requested or rendered (PDF §6).
 */

import { useState, type FormEvent } from 'react';
import { Shield, ShieldCheck, Search, User } from 'lucide-react';
import toast from 'react-hot-toast';

import type { AdminUserListParams, PublicUser } from '../../api/types';
import { useAuth } from '../../auth/auth-context';
import { copyForError } from '../../copy/errors';
import { useAdminUsers, useUpdateAdminUser } from '../../hooks/use-admin-users';
import { errorCodeOf } from '../../lib/route-state';
import { formatDate } from '../../lib/format';
import { Button } from '../ui/button';
import { Card, CardBody } from '../ui/card';
import { EmptyState } from '../ui/empty-state';
import { ErrorState } from '../ui/error-state';
import { Input } from '../ui/input';
import { Skeleton } from '../ui/loading';
import { StatusBadge } from '../ui/status-badge';

const PAGE_SIZE = 20;

export function UsersTab() {
  const { user: currentUser } = useAuth();
  const [draft, setDraft] = useState('');
  const [params, setParams] = useState<AdminUserListParams>({
    page: 1,
    limit: PAGE_SIZE,
    sort: '-createdAt',
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const usersQuery = useAdminUsers(params);
  const updateUser = useUpdateAdminUser();

  const page = usersQuery.data?.page ?? params.page ?? 1;
  const totalPages = Math.max(1, usersQuery.data?.totalPages ?? 1);
  const total = usersQuery.data?.total ?? 0;
  const users = usersQuery.data?.items ?? [];
  const searching = params.search !== undefined && params.search !== '';

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = draft.trim();
    setBanner(null);
    setParams((previous) => ({
      ...previous,
      page: 1,
      search: value === '' ? undefined : value,
    }));
  }

  function clearSearch(): void {
    setDraft('');
    setBanner(null);
    setParams((previous) => ({ ...previous, page: 1, search: undefined }));
  }

  async function toggleActive(user: PublicUser): Promise<void> {
    setBanner(null);
    setBusyId(user.id);
    try {
      await updateUser.mutateAsync({ id: user.id, input: { isActive: !user.isActive } });
      toast.success(user.isActive ? 'User deactivated' : 'User activated');
    } catch (error) {
      const message = copyForError(error);
      setBanner(message);
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card ariaLabelledBy="users-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id="users-heading" className="text-[20px] leading-[1.3] font-semibold text-ink">
            Users
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {usersQuery.isSuccess ? `${total} total, newest first` : 'Newest first'}
          </p>
        </div>

        <form
          className="flex w-full max-w-md flex-wrap items-end gap-2 sm:w-auto"
          onSubmit={submitSearch}
        >
          <div className="min-w-0 flex-1">
            <Input
              label="Search users"
              type="search"
              placeholder="Search name or email"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="md:h-10"
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            leadingIcon={<Search aria-hidden="true" className="h-4 w-4" />}
          >
            Search
          </Button>
          {searching ? (
            <Button variant="ghost" onClick={clearSearch}>
              Clear
            </Button>
          ) : null}
        </form>
      </div>

      <CardBody>
        {banner === null ? null : (
          <p
            role="alert"
            className="mb-4 rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-[13px] leading-[1.45] font-medium text-danger-text"
          >
            {banner}
          </p>
        )}

        {usersQuery.isPending ? (
          <div role="status" aria-live="polite" className="space-y-3">
            <span className="sr-only">Loading admin users…</span>
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-5/6" />
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
            description="Try a different name or email."
            className="border-0 p-0 shadow-none sm:p-0"
          />
        ) : null}

        {usersQuery.isSuccess && users.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-left text-[13px]">
                <caption className="sr-only">
                  Users matching the current search, newest first
                </caption>
                <thead>
                  <tr className="bg-table-header text-ink">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Name
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Email
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Role
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Created
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const isSelf = user.id === currentUser?.id;
                    return (
                      <tr key={user.id} className="border-b border-border last:border-0">
                        <th scope="row" className="px-3 py-2 font-medium text-ink">
                          <span className="block max-w-[12rem] truncate" title={user.name}>
                            {user.name}
                          </span>
                        </th>
                        <td className="px-3 py-2 text-ink">
                          <span className="block max-w-[16rem] truncate" title={user.email}>
                            {user.email}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge
                            tone={user.role === 'ADMIN' ? 'info' : 'neutral'}
                            icon={user.role === 'ADMIN' ? ShieldCheck : User}
                          >
                            {user.role === 'ADMIN' ? 'Admin' : 'User'}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={user.isActive ? 'success' : 'danger'} icon={Shield}>
                            {user.isActive ? 'Active' : 'Disabled'}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2 text-muted">{formatDate(user.createdAt)}</td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isSelf || busyId === user.id}
                            loading={busyId === user.id}
                            loadingLabel={user.isActive ? 'Deactivating…' : 'Activating…'}
                            title={isSelf ? "You can't deactivate your own account." : undefined}
                            onClick={() => void toggleActive(user)}
                          >
                            {user.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-muted">
                Page {page} of {totalPages} · {total} users
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Previous page"
                  disabled={page <= 1}
                  onClick={() => {
                    setParams((previous) => ({ ...previous, page: Math.max(1, page - 1) }));
                  }}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Next page"
                  disabled={page >= totalPages}
                  onClick={() => {
                    setParams((previous) => ({ ...previous, page: page + 1 }));
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
