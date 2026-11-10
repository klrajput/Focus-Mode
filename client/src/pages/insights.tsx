/*
 * `/insights` (UX_SPEC §4.8, T-033 owns the Recharts visualisation).
 * W1 renders the real `GET /insights` data: focused time, completion, streak and best hours, plus
 * an accessible daily summary table. Empty ranges show A3's empty sentence and "—" metrics; the
 * chart itself is deferred to T-033 so there is no fake placeholder chart with invented bars.
 * `aria-busy` marks the region during a range switch (UX_SPEC §6.1).
 */

import { useState } from 'react';
import { ChartColumn } from 'lucide-react';
import type { InsightsRange } from '@focus-mode/shared';

import { Card, CardBody, CardHeader } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { ErrorState } from '../components/ui/error-state';
import { Skeleton } from '../components/ui/loading';
import { PageHeader } from '../components/ui/page-header';
import { useInsights } from '../hooks/use-insights';
import { formatDate, formatHour, formatMinutes, formatPercent } from '../lib/format';
import { errorCodeOf } from '../lib/route-state';

const RANGES: readonly { value: InsightsRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <p className="mt-1 font-mono text-[28px] leading-[1.2] font-semibold tabular-nums text-ink">
          {value}
        </p>
        {hint === undefined ? null : <p className="mt-1 text-[13px] text-muted">{hint}</p>}
      </CardBody>
    </Card>
  );
}

export function InsightsPage() {
  const [range, setRange] = useState<InsightsRange>('7d');
  const insightsQuery = useInsights(range);
  const insights = insightsQuery.data;
  const isEmpty = insightsQuery.isSuccess && (insights?.totals.sessions ?? 0) === 0;
  const bestHour = insights?.bestHours[0];

  return (
    <>
      <PageHeader
        title="Insights"
        description="Focused time, completion and streaks — based on finished sessions."
        actions={
          <div role="group" aria-label="Date range" className="flex flex-wrap gap-2">
            {RANGES.map((option) => {
              const isActive = option.value === range;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setRange(option.value)}
                  className={
                    isActive
                      ? 'inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-primary bg-primary-subtle px-3 text-sm font-medium text-primary-active focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none md:min-h-10'
                      : 'inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm font-medium text-ink hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none md:min-h-10'
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        }
      />

      <div aria-busy={insightsQuery.isFetching} className="grid gap-4">
        {insightsQuery.isPending ? (
          <div
            role="status"
            aria-live="polite"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <span className="sr-only">Loading your insights…</span>
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
            <Skeleton className="h-56 w-full sm:col-span-2 lg:col-span-4" />
          </div>
        ) : null}

        {insightsQuery.isError ? (
          <ErrorState
            title="We couldn't load your insights."
            message="Your last known numbers are not shown because this dashboard does not keep a stale cache."
            code={errorCodeOf(insightsQuery.error)}
            onRetry={() => void insightsQuery.refetch()}
          />
        ) : null}

        {insightsQuery.isSuccess && insights !== undefined ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Focused time"
                value={isEmpty ? '—' : formatMinutes(insights.totals.focusMinutes)}
                hint={
                  isEmpty ? 'No sessions in this range' : `${insights.totals.sessions} sessions`
                }
              />
              <Metric
                label="Completion"
                value={isEmpty ? '—' : formatPercent(insights.totals.completionRate)}
                hint={isEmpty ? undefined : `${insights.totals.completed} completed`}
              />
              <Metric
                label="Current streak"
                value={isEmpty ? '—' : `${insights.totals.currentStreak} days`}
                hint={isEmpty ? undefined : `Longest ${insights.totals.longestStreak} days`}
              />
              <Metric
                label="Best hours"
                value={isEmpty || bestHour === undefined ? '—' : formatHour(bestHour.hour)}
                hint={
                  isEmpty || bestHour === undefined
                    ? undefined
                    : `${formatMinutes(bestHour.minutes)} focused`
                }
              />
            </div>

            {isEmpty ? (
              <EmptyState
                icon={ChartColumn}
                title="No focus data for this range yet. Finish a session to see your progress."
                footnote="Metrics stay empty until a session finishes; nothing is estimated or back-filled."
              />
            ) : (
              <Card ariaLabelledBy="daily-heading">
                <CardHeader
                  title="Daily focus minutes"
                  titleId="daily-heading"
                  description={`Last ${range.replace('d', '')} local days · timezone ${insights.timezone}`}
                />
                <CardBody>
                  {insights.daily.length === 0 ? (
                    <p className="text-[15px] text-muted">No daily data for this range yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[16rem] border-collapse text-left text-[13px]">
                        <caption className="sr-only">
                          Focused minutes per day for the selected range
                        </caption>
                        <thead>
                          <tr className="bg-table-header text-ink">
                            <th scope="col" className="px-3 py-2 font-medium">
                              Day
                            </th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">
                              Focused minutes
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {insights.daily.map((point) => (
                            <tr key={point.date} className="border-b border-border last:border-0">
                              <th scope="row" className="px-3 py-2 font-normal text-ink">
                                {formatDate(point.date)}
                              </th>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                                {Math.round(point.minutes)} m
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="mt-3 text-[13px] text-muted">
                    The Recharts daily-focus chart lands with T-033 (W2). This table is the
                    accessible equivalent of the same data, so no numbers are guessed.
                  </p>
                </CardBody>
              </Card>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
