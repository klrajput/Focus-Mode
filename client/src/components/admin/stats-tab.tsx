/*
 * Admin → Stats (UX_SPEC §4.10, INTEGRATION_CONTRACTS §3.1 #36, FR-019).
 * Aggregate counts only: users, devices, sessions and focused minutes. The endpoint has no
 * per-user session detail by contract (PDF §6), so this tab cannot show one.
 */

import { ChartColumn } from 'lucide-react';

import { useAdminStats } from '../../hooks/use-admin-stats';
import { formatMinutes } from '../../lib/format';
import { errorCodeOf } from '../../lib/route-state';
import { Card, CardBody } from '../ui/card';
import { ErrorState } from '../ui/error-state';
import { Skeleton } from '../ui/loading';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
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

export function StatsTab() {
  const statsQuery = useAdminStats();
  const stats = statsQuery.data;

  return (
    <Card ariaLabelledBy="stats-heading">
      <div className="border-b border-border px-5 py-4">
        <h2
          id="stats-heading"
          className="flex items-center gap-2 text-[20px] leading-[1.3] font-semibold text-ink"
        >
          <ChartColumn aria-hidden="true" className="h-5 w-5 text-muted" />
          Stats
        </h2>
        <p className="mt-0.5 text-[13px] text-muted">
          Aggregate counts only — no per-user session detail is shown.
        </p>
      </div>

      <CardBody>
        {statsQuery.isPending ? (
          <div
            role="status"
            aria-live="polite"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <span className="sr-only">Loading aggregate stats…</span>
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
        ) : null}

        {statsQuery.isError ? (
          <ErrorState
            title="We couldn't load admin data."
            message="Check your connection and try again."
            code={errorCodeOf(statsQuery.error)}
            onRetry={() => void statsQuery.refetch()}
          />
        ) : null}

        {statsQuery.isSuccess && stats !== undefined ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Users" value={String(stats.users)} hint={`${stats.activeUsers} active`} />
            <Stat
              label="Devices"
              value={String(stats.devices)}
              hint={`${stats.connectedDevices} connected`}
            />
            <Stat
              label="Sessions"
              value={String(stats.sessions)}
              hint={`${stats.activeSessions} running now`}
            />
            <Stat
              label="Focused time"
              value={formatMinutes(stats.focusMinutes)}
              hint="All finished sessions"
            />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
