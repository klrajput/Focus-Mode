/*
 * FocusChart — the Recharts daily/weekly bar chart for `/insights` (UX_SPEC §4.8, FR-013).
 * The bar chart is decorative for assistive tech (`aria-hidden`), so every number is also present
 * as (a) a plain-language summary in a live region and (b) a disclosure table with the same data.
 * 7 days render one bar per local day; 30/90 days are aggregated by local week so the x-axis stays
 * readable and never invents a day that is not in the API response.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { InsightsRange } from '@focus-mode/shared';

import type { InsightsDailyPoint } from '../../api/types';
import { formatDate } from '../../lib/format';

export interface ChartPoint {
  key: string;
  /** Short x-axis label, e.g. "10 Nov". */
  label: string;
  /** Full label for the table and the summary, e.g. "10 Nov 2026". */
  longLabel: string;
  minutes: number;
}

export interface ChartSeries {
  bucket: 'day' | 'week';
  title: string;
  points: ChartPoint[];
  summary: string;
}

function parseLocalDay(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
}

function mondayOf(date: Date): Date {
  const monday = new Date(date);
  const offset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - offset);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function summarise(
  bucket: 'day' | 'week',
  points: readonly ChartPoint[],
  totalMinutes: number,
): string {
  const noun = bucket === 'day' ? 'day' : 'week';
  const period = bucket === 'day' ? 'daily' : 'weekly';
  const highest = points.reduce<ChartPoint | undefined>(
    (best, point) => (best === undefined || point.minutes > best.minutes ? point : best),
    undefined,
  );

  const empty = `No focus data for this range yet.`;
  if (points.length === 0 || highest === undefined || highest.minutes === 0) return empty;

  return `Bar chart of ${period} focus minutes. ${Math.round(totalMinutes)} focused minutes across ${points.length} ${noun}${points.length === 1 ? '' : 's'}. Best ${noun}: ${highest.longLabel} with ${Math.round(highest.minutes)} minutes.`;
}

/** Build the chart series from the API's daily points (no invented buckets). */
export function buildChartSeries(
  daily: readonly InsightsDailyPoint[],
  range: InsightsRange,
): ChartSeries {
  const totalMinutes = daily.reduce((sum, point) => sum + point.minutes, 0);

  if (range === '7d') {
    const points: ChartPoint[] = daily.map((point) => {
      const date = parseLocalDay(point.date);
      return {
        key: point.date,
        label: shortDate(date),
        longLabel: formatDate(point.date),
        minutes: Math.round(point.minutes),
      };
    });

    return {
      bucket: 'day',
      title: 'Daily focus minutes',
      points,
      summary: summarise('day', points, totalMinutes),
    };
  }

  const buckets = new Map<string, { label: string; longLabel: string; minutes: number }>();
  for (const point of daily) {
    const monday = mondayOf(parseLocalDay(point.date));
    const key = localDateKey(monday);
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, {
        label: shortDate(monday),
        longLabel: `Week of ${formatDate(key)}`,
        minutes: Math.round(point.minutes),
      });
    } else {
      existing.minutes += Math.round(point.minutes);
    }
  }

  const points: ChartPoint[] = [...buckets.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, bucket]) => ({ key, ...bucket }));

  return {
    bucket: 'week',
    title: 'Weekly focus minutes',
    points,
    summary: summarise('week', points, totalMinutes),
  };
}

export function FocusChart({ series, timezone }: { series: ChartSeries; timezone: string }) {
  const total = series.points.reduce((sum, point) => sum + point.minutes, 0);

  return (
    <div>
      <p className="text-[13px] text-muted">
        {series.bucket === 'day' ? 'Each bar is one local day' : 'Each bar is one local week'} ·{' '}
        {timezone} · {Math.round(total)} m total
      </p>

      {/* Accessible equivalent #1: one plain-language sentence, always in the DOM. */}
      <p className="sr-only">{series.summary}</p>

      {/* The SVG itself is decorative; the summary and table carry the data. */}
      <div aria-hidden="true" role="presentation" className="mt-3 h-[220px] w-full">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={series.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--color-border-strong)' }}
              tick={{ fontSize: 12, fill: 'var(--color-muted)' }}
              interval="preserveStartEnd"
            />
            <YAxis
              width={40}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: 'var(--color-muted)' }}
            />
            <Tooltip cursor={{ fill: 'var(--color-primary-subtle)' }} />
            <Bar
              dataKey="minutes"
              name="Focused"
              unit=" m"
              fill="var(--color-focus-strong)"
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Accessible equivalent #2: the same numbers as a table. */}
      <details className="mt-3 rounded-[var(--radius-control)] border border-border bg-card">
        <summary className="min-h-11 cursor-pointer px-3 py-3 text-[13px] font-medium text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          View as a table
        </summary>
        <div className="overflow-x-auto px-3 pb-3">
          <table className="w-full min-w-[16rem] border-collapse text-left text-[13px]">
            <caption className="sr-only">
              Focused minutes per {series.bucket} for the selected range
            </caption>
            <thead>
              <tr className="bg-table-header text-ink">
                <th scope="col" className="px-3 py-2 font-medium">
                  {series.bucket === 'day' ? 'Day' : 'Week'}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Focused minutes
                </th>
              </tr>
            </thead>
            <tbody>
              {series.points.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-3 py-2 text-muted">
                    No data for this range.
                  </td>
                </tr>
              ) : (
                series.points.map((point) => (
                  <tr key={point.key} className="border-b border-border last:border-0">
                    <th scope="row" className="px-3 py-2 font-normal text-ink">
                      {point.longLabel}
                    </th>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                      {point.minutes} m
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
