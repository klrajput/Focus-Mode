/*
 * `/dashboard` (UX_SPEC §4.3, T-030 owns the full page).
 * W1 proves the data path honestly: the greeting comes from the real authenticated user and the
 * recent-sessions card is a real `GET /sessions` query with loading / empty / error / success
 * states. Starting a session is disabled with a visible reason because the Focus Agent link does
 * not exist yet (W2/T-045) — no fake "connected" state and no dead click (DEC-012 Q4).
 */

import { useSearchParams } from 'react-router-dom';
import { Clock, Play, Timer } from 'lucide-react';

import { useAuth } from '../auth/auth-context';
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

const DURATION_CHOICES = [25, 50, 60] as const;

function StartFocusCard() {
  return (
    <Card>
      <CardHeader
        title="Start a focus session"
        description="One action, one focus block. You can end it at any time."
      />
      <CardBody>
        <p className="text-[13px] font-medium text-ink">Duration</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DURATION_CHOICES.map((minutes) => (
            <span
              key={minutes}
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-muted md:min-h-10"
            >
              {minutes} min
            </span>
          ))}
          <span className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-muted md:min-h-10">
            Custom…
          </span>
        </div>

        <div className="mt-4 rounded-[var(--radius-control)] border border-border bg-surface p-3">
          <p className="flex items-start gap-2 text-[13px] leading-[1.45] text-ink">
            <Timer aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-focus-strong" />
            <span>
              Starting a session needs the live Focus Agent link — it lands in W2 (T-045). The Focus
              Agent is what actually moves windows aside, so nothing is started from here yet.
            </span>
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled aria-describedby="start-focus-reason">
            <Play aria-hidden="true" className="h-4 w-4" />
            Start Focus
          </Button>
          <p id="start-focus-reason" className="text-[13px] text-muted">
            Disabled until a Focus Agent is connected.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

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
        <p className="mt-3 text-[13px] text-muted">
          The download links and the pairing dialog land in W2; this checklist is here so the
          first-run path is visible, not implied.
        </p>
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
