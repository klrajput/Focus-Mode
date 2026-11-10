/*
 * `/schedules` (UX_SPEC §4.7, T-035 owns creation/editing).
 * W1 shows the real schedules in the user's IANA timezone with loading / empty / error / success
 * states. Creating or toggling a schedule is deferred to T-035, and the page states the operational
 * truth from the spec: a scheduled session only starts while a Focus Agent is connected, after a
 * 10-second heads-up. No toggle is rendered because it could not be honest yet.
 */

import { CalendarClock, CheckCircle2, CircleSlash2 } from 'lucide-react';

import { useAuth } from '../auth/auth-context';
import { StatusBadge } from '../components/ui/status-badge';
import { Card, CardBody } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { ErrorState } from '../components/ui/error-state';
import { Skeleton } from '../components/ui/loading';
import { PageHeader } from '../components/ui/page-header';
import { useSchedules } from '../hooks/use-schedules';
import { formatDuration, formatScheduleDays } from '../lib/format';
import { errorCodeOf } from '../lib/route-state';

export function SchedulesPage() {
  const { user } = useAuth();
  const schedulesQuery = useSchedules({ limit: 20 });
  const schedules = schedulesQuery.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Schedules"
        description={user === null ? undefined : `Times shown in ${user.timezone}.`}
      />

      {schedulesQuery.isPending ? (
        <div role="status" aria-live="polite" className="space-y-3">
          <span className="sr-only">Loading your schedules…</span>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {schedulesQuery.isError ? (
        <ErrorState
          title="We couldn't load your schedules."
          message="Check your connection and try again."
          code={errorCodeOf(schedulesQuery.error)}
          onRetry={() => void schedulesQuery.refetch()}
        />
      ) : null}

      {schedulesQuery.isSuccess && schedules.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No schedules yet. Add one for your next deep-work block."
          footnote="A scheduled session starts only while your Focus Agent is connected, and only after a 10-second heads-up you can cancel."
        />
      ) : null}

      {schedulesQuery.isSuccess && schedules.length > 0 ? (
        <div className="grid gap-4">
          <ul className="grid gap-4">
            {schedules.map((schedule) => (
              <li key={schedule.id} className="min-w-0">
                <Card>
                  <CardBody>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-[20px] leading-[1.3] font-semibold text-ink">
                          {schedule.name}
                        </h2>
                        <p className="mt-1 text-[15px] text-ink">
                          {formatScheduleDays(schedule.days)} · {schedule.startTime} ·{' '}
                          {formatDuration(schedule.durationMin)}
                        </p>
                      </div>
                      <StatusBadge
                        tone={schedule.enabled ? 'success' : 'neutral'}
                        icon={schedule.enabled ? CheckCircle2 : CircleSlash2}
                      >
                        {schedule.enabled ? 'Enabled' : 'Disabled'}
                      </StatusBadge>
                    </div>
                    <p className="mt-3 text-[13px] text-muted">
                      Needs a connected Focus Agent to start. Missed runs appear in notifications,
                      not here.
                    </p>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>

          <p className="text-[13px] text-muted">
            Creating and editing schedules aren&apos;t available yet.
          </p>
        </div>
      ) : null}
    </>
  );
}
