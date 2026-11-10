/*
 * `/dashboard` (UX_SPEC §4.3, T-056/T-065).
 * The greeting and the recent-sessions card read real API data with the four NFR-007 states, and
 * the Start card is the one primary action: duration chips → consent modal → Focus Agent. Nothing
 * here fakes a session: the card is disabled with a visible reason while the Focus Agent is
 * unreachable, unpaired or unable to move windows, and it never starts a session without the
 * explicit confirmation of UX_SPEC §5.
 */

import { useSearchParams } from 'react-router-dom';
import { Clock } from 'lucide-react';

import { useAuth } from '../auth/auth-context';
import { StartFocusCard } from '../components/focus/start-focus-card';
import { SessionStatusBadge } from '../components/status/status-badges';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { ErrorState } from '../components/ui/error-state';
import { Skeleton } from '../components/ui/loading';
import { PageHeader } from '../components/ui/page-header';
import { useSessions } from '../hooks/use-sessions';
import { formatDateTime, formatDuration, firstName, greetingFor } from '../lib/format';
import { errorCodeOf } from '../lib/route-state';

function RecentSessionsCard() {
  const sessionsQuery = useSessions({ limit: 5, sort: '-startedAt' });

  return (
    <Card ariaLabelledBy="recent-sessions-heading">
      <CardHeader title="Recent sessions" titleId="recent-sessions-heading" />

      <CardBody>
        {sessionsQuery.isPending ? (
          <div role="status" aria-live="polite" className="space-y-3">
            <span className="sr-only">Loading your recent sessions…</span>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        ) : null}

        {sessionsQuery.isError ? (
          <ErrorState
            title="We couldn't load your dashboard."
            message="The recent sessions could not be fetched."
            code={errorCodeOf(sessionsQuery.error)}
            onRetry={() => void sessionsQuery.refetch()}
          />
        ) : null}

        {sessionsQuery.isSuccess && sessionsQuery.data.items.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No focus sessions yet. Your first session will show up here."
            description="Once your Focus Agent is paired, start a session from this dashboard and it will appear in this list."
            className="border-0 shadow-none"
          />
        ) : null}

        {sessionsQuery.isSuccess && sessionsQuery.data.items.length > 0 ? (
          <ul className="divide-y divide-border">
            {sessionsQuery.data.items.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-[15px] text-ink">
                    {formatDateTime(session.startedAt)} · {formatDuration(session.actualMinutes)}
                  </p>
                  <p className="text-[13px] text-muted">
                    {session.source === 'SCHEDULE' ? 'Schedule' : 'Manual'} · planned{' '}
                    {formatDuration(session.plannedMinutes)}
                  </p>
                </div>
                <SessionStatusBadge status={session.status} />
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}

function WelcomeChecklist({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Card className="mb-4 border-primary-subtle bg-primary-subtle">
      <CardHeader
        title="Set up Focus Mode"
        description="Install → pair → start your first session."
      />
      <CardBody>
        <ol className="list-decimal space-y-2 pl-5 text-[15px] text-ink">
          <li>Download and open the Focus Agent — it shows a 6-digit code.</li>
          <li>Pair it on Devices with that code.</li>
          <li>Start a focus session from this dashboard.</li>
        </ol>
        <Button variant="secondary" className="mt-4" onClick={onDismiss}>
          Got it
        </Button>
      </CardBody>
    </Card>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const showWelcome = searchParams.get('welcome') === '1';

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={user === null ? undefined : `${greetingFor()}, ${firstName(user.name)}.`}
        eyebrow="Focus Mode"
      />

      {showWelcome ? (
        <WelcomeChecklist
          onDismiss={() => {
            searchParams.delete('welcome');
            setSearchParams(searchParams, { replace: true });
          }}
        />
      ) : null}

      <div className="grid gap-4">
        <StartFocusCard />
        <RecentSessionsCard />
      </div>
    </>
  );
}
