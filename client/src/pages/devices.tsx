/*
 * `/devices` (UX_SPEC §4.5, T-032 owns pairing/unpairing).
 * W1 lists real devices from `GET /devices` with all four NFR-007 states. Pairing is disabled with
 * a visible reason because the pair dialog and the code exchange land with T-032 — the dashboard
 * never invents a device or a "connected" badge.
 */

import { MonitorSmartphone, Plus, ShieldCheck } from 'lucide-react';

import { DeviceStatusBadge } from '../components/status/status-badges';
import { Button } from '../components/ui/button';
import { Card, CardBody } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { ErrorState } from '../components/ui/error-state';
import { Skeleton } from '../components/ui/loading';
import { PageHeader } from '../components/ui/page-header';
import { useDevices } from '../hooks/use-devices';
import { formatDateTime, formatOs } from '../lib/format';
import { errorCodeOf } from '../lib/route-state';

export function DevicesPage() {
  const devicesQuery = useDevices({ limit: 20, sort: '-lastSeenAt' });
  const devices = devicesQuery.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Devices"
        description="The Focus Agent is the only component that touches your operating system."
        actions={
          <Button
            disabled
            title="Pairing lands in W2 (T-032): it needs the Focus Agent code exchange over the cloud API."
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Pair a device
          </Button>
        }
      />

      {devicesQuery.isPending ? (
        <div role="status" aria-live="polite" className="space-y-3">
          <span className="sr-only">Loading your devices…</span>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : null}

      {devicesQuery.isError ? (
        <ErrorState
          title="We couldn't load your devices."
          message="Check your connection and try again."
          code={errorCodeOf(devicesQuery.error)}
          onRetry={() => void devicesQuery.refetch()}
        />
      ) : null}

      {devicesQuery.isSuccess && devices.length === 0 ? (
        <EmptyState
          icon={MonitorSmartphone}
          title="No device connected — start your Focus Agent"
          description="1. Download the Focus Agent. 2. Open it — it shows a 6-digit pairing code. 3. Enter that code here."
          footnote="Already installed? Open the Focus Agent and come back — this updates automatically when it connects. Pairing and the download links land with T-032 (W2)."
        />
      ) : null}

      {devicesQuery.isSuccess && devices.length > 0 ? (
        <ul className="grid gap-4">
          {devices.map((device) => (
            <li key={device.id} className="min-w-0">
              <Card>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-[20px] leading-[1.3] font-semibold text-ink">
                        {device.name}
                      </h2>
                      <p className="mt-1 text-[13px] text-muted">
                        {formatOs(device.os)} · Focus Agent {device.agentVersion}
                      </p>
                    </div>
                    <DeviceStatusBadge status={device.status} />
                  </div>

                  <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="text-muted">Paired</dt>
                      <dd className="text-ink">
                        {device.pairedAt === null
                          ? 'Not paired yet'
                          : formatDateTime(device.pairedAt)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted">Last seen</dt>
                      <dd className="text-ink">
                        {device.lastSeenAt === null
                          ? 'Not seen since pairing'
                          : formatDateTime(device.lastSeenAt)}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-4 flex items-start gap-2 text-[13px] text-muted">
                    <ShieldCheck
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-focus-strong"
                    />
                    <span>
                      Unpairing and the pairing dialog land with T-032; until then this list is
                      read-only.
                    </span>
                  </p>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
