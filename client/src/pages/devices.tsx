/*
 * `/devices` (UX_SPEC §4.5, T-046 / FR-003).
 * Lists real devices from `GET /devices` with all four NFR-007 states, refreshes in the background
 * while the page is open (a pairing is picked up within ~5 s), and offers the two real mutations:
 * Pair a device (6-digit code → `POST /devices/pair` → local `paired` nudge) and Unpair
 * (`DELETE /devices/:id` after confirmation). No device is ever invented and no badge is shown
 * before the API/agent reports it.
 */

import { useState } from 'react';
import { MonitorSmartphone, Plus, ShieldCheck } from 'lucide-react';

import { useAgentLink } from '../agent/agent-link-provider';
import type { Device } from '../api/types';
import { PairDialog } from '../components/devices/pair-dialog';
import { UnpairDialog } from '../components/devices/unpair-dialog';
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

/** Presence can change without a page reload (agent start/poll); 5 s keeps FR-003 crisp. */
const DEVICE_REFETCH_INTERVAL_MS = 5000;

const FOCUS_CAPABILITY_LABEL: Readonly<Record<string, string>> = Object.freeze({
  full: 'Full',
  partial: 'Partial',
  unsupported: 'Unsupported',
});

function DeviceCard({ device, onUnpair }: { device: Device; onUnpair: (device: Device) => void }) {
  const capability = device.capabilities?.focus;

  return (
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
              {device.pairedAt === null ? 'Not paired yet' : formatDateTime(device.pairedAt)}
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

        {capability === undefined ? null : (
          <p className="mt-3 text-[13px] text-muted">
            Window control: {FOCUS_CAPABILITY_LABEL[capability] ?? capability}
            {capability === 'unsupported'
              ? ' — this system cannot step windows aside, so Start is unavailable.'
              : null}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => onUnpair(device)}>
            Unpair
          </Button>
          <p className="flex items-start gap-2 text-[13px] text-muted">
            <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-focus-strong" />
            <span>
              Unpairing revokes this device&apos;s token and restores any running focus session.
            </span>
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

export function DevicesPage() {
  const agent = useAgentLink();
  const devicesQuery = useDevices(
    { limit: 20, sort: '-lastSeenAt' },
    { refetchInterval: DEVICE_REFETCH_INTERVAL_MS },
  );
  const devices = devicesQuery.data?.items ?? [];

  const [pairOpen, setPairOpen] = useState(false);
  const [unpairTarget, setUnpairTarget] = useState<Device | null>(null);

  function openPairDialog(): void {
    setPairOpen(true);
  }

  function handlePaired(): void {
    // Step 4 of the pairing protocol: a nudge only (REC-002) — the agent still polls the cloud.
    agent.notifyPaired();
    void devicesQuery.refetch();
  }

  function handleUnpaired(): void {
    void devicesQuery.refetch();
  }

  return (
    <>
      <PageHeader
        title="Devices"
        description="The Focus Agent is the only component that touches your operating system."
        actions={
          <Button onClick={openPairDialog}>
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
          action={<Button onClick={openPairDialog}>Pair a device</Button>}
          footnote="Already installed? Open the Focus Agent and come back — this updates automatically when it connects."
        />
      ) : null}

      {devicesQuery.isSuccess && devices.length > 0 ? (
        <ul className="grid gap-4">
          {devices.map((device) => (
            <li key={device.id} className="min-w-0">
              <DeviceCard device={device} onUnpair={setUnpairTarget} />
            </li>
          ))}
        </ul>
      ) : null}

      <PairDialog open={pairOpen} onClose={() => setPairOpen(false)} onPaired={handlePaired} />
      <UnpairDialog
        device={unpairTarget}
        onClose={() => setUnpairTarget(null)}
        onUnpaired={handleUnpaired}
      />
    </>
  );
}
