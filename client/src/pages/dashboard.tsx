/*
 * `/dashboard` (UX_SPEC §4.3, T-065 / FR-010/FR-013/FR-020/FR-021/FR-025).
 * Three real widgets, each with the four NFR-007 states and no invented numbers:
 *   · Today — focused minutes from COMPLETED sessions started in the user's local day, plus the next
 *     enabled schedule occurrence in the user's IANA timezone (scheduler execution is server-side).
 *   · Recent sessions — the last five REST sessions with planned vs focused minutes and a link to
 *     /insights (planned minutes are never called "focused time", REQUIREMENTS §6).
 *   · StartFocusCard — the one primary action: duration chips → consent modal → Focus Agent.
 * A failed widget shows its own error + Retry so the rest of the page survives (UX_SPEC §6.1).
 */

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CalendarClock, Clock, RefreshCw } from 'lucide-react';

import { useAuth } from '../auth/auth-context';
import { StartFocusCard } from '../components/focus/start-focus-card';
import { SessionStatusBadge } from '../components/status/status-badges';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { Skeleton } from '../components/ui/loading';
import { PageHeader } from '../components/ui/page-header';
import { useSchedules } from '../hooks/use-schedules';
import { useSessions } from '../hooks/use-sessions';
import {
  formatDateTime,
  formatDuration,
  formatMinutes,
  formatScheduleDays,
  firstName,
  greetingFor,
} from '../lib/format';
import {
  describeNextRunDay,
  localDayRangeIso,
  nextScheduleRun,
  type NextScheduleRun,
} from '../lib/schedule-next';
import { errorCodeOf } from '../lib/route-state';

/** The UX_SPEC §6.1 dashboard error title shared by every widget on this page. */
const DASHBOARD_ERROR_TITLE = "We couldn't load your dashboard.";

/** Used only if the authenticated user has no timezone yet (never invented for a real user). */
const FALLBACK_TIME_ZONE = 'UTC';

/** Small inline error that keeps the surrounding card usable (NFR-007). */
function WidgetError({
  description,
  code,
  onRetry,
}: {
  description: string;
  code?: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="rounded-[var(--radius-control)] bg-danger-subtle p-3">
      <p className="text-[15px] font-medium text-danger-text">{DASHBOARD_ERROR_TITLE}</p>
      <p className="mt-1 text-[13px] leading-[1.45] text-ink">{description}</p>
      {code === undefined ? null : (
        <p className="mt-1 font-mono text-[13px] leading-[1.45] text-muted">(Ref: {code})</p>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={onRetry}
        leadingIcon={<RefreshCw aria-hidden="true" className="h-4 w-4" />}
      >
        Retry
      </Button>
    </div>
  );
}

function TodayCard() {
  const { user } = useAuth();
  const timeZone = user?.timezone ?? FALLBACK_TIME_ZONE;

  // One inclusive local-day window, never a UTC-midnight guess (UX_SPEC §4.3 "Today").
  const range = useMemo(() => localDayRangeIso(timeZone), [timeZone]);

  const todayQuery = useSessions({
    from: range.from,
    to: range.to,
    status: 'COMPLETED',
    limit: 100,
    sort: '-startedAt',
  });
  const schedulesQuery = useSchedules({ limit: 50 });

  const todayMinutes = useMemo(() => {
    const items = todayQuery.data?.items ?? [];
    return items.reduce((total, session) => total + session.actualMinutes, 0);
  }, [todayQuery.data]);
  const todaySessions = todayQuery.data?.items.length ?? 0;

  const nextRun: NextScheduleRun | null = useMemo(() => {
    const items = schedulesQuery.data?.items;
    if (items === undefined) return null;
    return nextScheduleRun(items, timeZone);
  }, [schedulesQuery.data, timeZone]);

  return (
    <Card ariaLabelledBy="today-heading">
      <CardHeader
        title="Today"
        titleId="today-heading"
        description={`Focused time and your next schedule, in ${timeZone}.`}
      />

      <CardBody>
        <dl className="grid gap-5 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-[13px] font-medium text-muted">Focused today</dt>
            <dd className="mt-1 min-w-0">
              {todayQuery.isPending ? (
                <div role="status" aria-live="polite" className="space-y-2">
                  <span className="sr-only">Loading today&apos;s focus time…</span>
                  <Skeleton className="h-7 w-28" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ) : null}

              {todayQuery.isError ? (
                <WidgetError
                  description="Today's focus time could not be fetched."
                  code={errorCodeOf(todayQuery.error)}
                  onRetry={() => void todayQuery.refetch()}
                />
              ) : null}

              {todayQuery.isSuccess ? (
                todayMinutes > 0 ? (
                  <>
                    <p className="text-[28px] leading-[1.2] font-semibold text-ink">
                      {formatMinutes(todayMinutes)}
                    </p>
                    <p className="mt-1 text-[13px] text-muted">
                      {todaySessions} completed {todaySessions === 1 ? 'session' : 'sessions'} today
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[15px] text-ink">No focus time yet today.</p>
                    <p className="mt-1 text-[13px] text-muted">
                      Finish a session and your focused minutes show up here.
                    </p>
                  </>
                )
              ) : null}
            </dd>
          </div>

          <div className="min-w-0">
            <dt className="text-[13px] font-medium text-muted">Next scheduled session</dt>
            <dd className="mt-1 min-w-0">
              {schedulesQuery.isPending ? (
                <div role="status" aria-live="polite" className="space-y-2">
                  <span className="sr-only">Loading your next scheduled session…</span>
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ) : null}

              {schedulesQuery.isError ? (
                <WidgetError
                  description="Your schedules could not be fetched."
                  code={errorCodeOf(schedulesQuery.error)}
                  onRetry={() => void schedulesQuery.refetch()}
                />
              ) : null}

              {schedulesQuery.isSuccess ? (
                nextRun === null ? (
                  <>
                    <p className="text-[15px] text-ink">No enabled schedules yet.</p>
                    <Link
                      to="/schedules"
                      className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:text-primary-hover"
                    >
                      Add a schedule
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="truncate text-[15px] text-ink">{nextRun.schedule.name}</p>
                    <p className="mt-1 text-[13px] text-muted">
                      {describeNextRunDay(nextRun, timeZone)} {nextRun.schedule.startTime} ·{' '}
                      {formatDuration(nextRun.schedule.durationMin)} · {timeZone}
                    </p>
                    <p className="mt-1 text-[13px] text-muted">
                      {formatScheduleDays(nextRun.schedule.days)}
                    </p>
                  </>
                )
              ) : null}
            </dd>
          </div>
        </dl>

        <p className="mt-4 flex items-start gap-2 text-[13px] leading-[1.45] text-muted">
          <CalendarClock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-focus-strong" />
          <span>
            A scheduled session starts only while your Focus Agent is connected, after a 10-second
            heads-up you can cancel.
          </span>
        </p>
      </CardBody>
    </Card>
  );
}

function RecentSessionsCard() {
  const sessionsQuery = useSessions({ limit: 5, sort: '-startedAt' });

  return (
    <Card ariaLabelledBy="recent-sessions-heading">
      <CardHeader
        title="Recent sessions"
        titleId="recent-sessions-heading"
        action={
          <Link
            to="/insights"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:text-primary-hover"
          >
            View insights
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        }
      />

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
          <WidgetError
            description="The recent sessions could not be fetched."
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
                    {formatDateTime(session.startedAt)} ·{' '}
                    {session.source === 'SCHEDULE' ? 'Schedule' : 'Manual'}
                  </p>
                  <p className="text-[13px] text-muted">
                    Planned {formatDuration(session.plannedMinutes)} · Focused{' '}
                    {formatDuration(session.actualMinutes)}
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
        <TodayCard />
        <RecentSessionsCard />
      </div>
    </>
  );
}
