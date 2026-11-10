/*
 * `/insights` (UX_SPEC §4.8, FR-013).
 *
 * Real `GET /insights?range=7d|30d|90d` data: focused time (`actualMinutes`), sessions, completion
 * rate, current + longest streak, best focus hours, and a Recharts daily/weekly bar chart with both
 * a plain-language summary and a disclosure table so the numbers never depend on the SVG. Empty
 * ranges show "—" metrics and §6.1's encouraging sentence; the chart is hidden rather than faked.
 * `aria-busy` marks the region during a range refresh.
 */

import { useState } from 'react';
import { ChartColumn } from 'lucide-react';
import type { InsightsRange } from '@focus-mode/shared';

import { FocusChart, buildChartSeries } from '../components/insights/focus-chart';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { ErrorState } from '../components/ui/error-state';
import { Skeleton } from '../components/ui/loading';
import { PageHeader } from '../components/ui/page-header';
import { useInsights } from '../hooks/use-insights';
import { formatHour, formatMinutes, formatPercent } from '../lib/format';
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

  const series = insights === undefined ? null : buildChartSeries(insights.daily, insights.range);
  const bestHours =
    insights === undefined
      ? []
      : [...insights.bestHours]
          .filter((entry) => entry.minutes > 0)
          .sort((left, right) => right.minutes - left.minutes)
          .slice(0, 3);
  const bestHour = bestHours[0];
  const bestHourPeak = bestHour?.minutes ?? 0;

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
            <Skeleton className="h-[300px] w-full sm:col-span-2 lg:col-span-4" />
          </div>
        ) : null}

        {insightsQuery.isError ? (
          <ErrorState
            title="We couldn't load your insights."
            message="Check your connection and try again."
            code={errorCodeOf(insightsQuery.error)}
            onRetry={() => void insightsQuery.refetch()}
          />
        ) : null}

        {insightsQuery.isSuccess && insights !== undefined && series !== null ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Focused time"
                value={isEmpty ? '—' : formatMinutes(insights.totals.focusMinutes)}
                hint={
                  isEmpty
                    ? 'No sessions in this range'
                    : `${insights.totals.sessions} sessions · ${insights.totals.cancelled} cancelled`
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
                value={
                  isEmpty || bestHour === undefined
                    ? '—'
                    : `${formatHour(bestHour.hour)}–${formatHour(bestHour.hour + 1)}`
                }
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
              <>
                <Card ariaLabelledBy="chart-heading">
                  <CardHeader
                    title={series.title}
                    titleId="chart-heading"
                    description={`Last ${range.replace('d', '')} local days · timezone ${insights.timezone}`}
                  />
                  <CardBody>
                    <FocusChart series={series} timezone={insights.timezone} />
                  </CardBody>
                </Card>

                <Card ariaLabelledBy="best-hours-heading">
                  <CardHeader
                    title="Best focus hours"
                    titleId="best-hours-heading"
                    description="When your focused minutes land in this range."
                  />
                  <CardBody>
                    {bestHours.length === 0 ? (
                      <p className="text-[15px] text-muted">
                        No focus data for this range yet. Finish a session to see your best hours.
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {bestHours.map((entry) => (
                          <li key={entry.hour}>
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <p className="text-[15px] font-medium text-ink">
                                {formatHour(entry.hour)}–{formatHour(entry.hour + 1)}
                              </p>
                              <p className="font-mono text-[13px] tabular-nums text-muted">
                                {formatMinutes(entry.minutes)}
                              </p>
                            </div>
                            <div
                              aria-hidden="true"
                              className="mt-1 h-2 w-full overflow-hidden rounded-[var(--radius-pill)] bg-skeleton"
                            >
                              <div
                                className="h-full rounded-[var(--radius-pill)] bg-focus-strong"
                                style={{
                                  width: `${Math.round((entry.minutes / bestHourPeak) * 100)}%`,
                                }}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              </>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
