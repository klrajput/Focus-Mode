/*
 * StartFocusCard — the dashboard's one primary action (T-056, FR-005/FR-007/FR-009, UX_SPEC §4.3).
 *
 * The card never starts a session by itself:
 *   Start Focus → ConsentModal (§5 copy, one Confirm) → `enterFocus` with the consent record.
 * Every blocked case has a visible reason for the button's `aria-describedby` (no dead click):
 * agent unreachable, agent not paired, session already running, or `capabilities.focus = unsupported`
 * (Wayland and friends). The copy for those reasons is A3's approved set from `copy/errors.ts`.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Timer } from 'lucide-react';

import { useAgentLink } from '../../agent/agent-link-provider';
import { useAuth } from '../../auth/auth-context';
import { useAllowlist } from '../../hooks/use-allowlist';
import { useDevices } from '../../hooks/use-devices';
import { ERROR_MESSAGES, FOCUS_REJECTED_MESSAGES } from '../../copy/errors';
import { pairedDeviceName } from '../../focus/paired-device';
import { newClientSessionId } from '../../focus/session-id';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { ConsentModal } from './consent-modal';
import {
  DurationChips,
  INVALID_DURATION_COPY,
  MAX_DURATION_MIN,
  MIN_DURATION_MIN,
} from './duration-chips';

/** Shown under the button when the local channel could not take the message at all. */
const UNREACHABLE_COPY =
  "We couldn't reach your Focus Agent. Make sure it is running, then try again.";

function defaultDuration(preferred: number | undefined): number | null {
  if (preferred === undefined) return 25;
  if (
    Number.isInteger(preferred) &&
    preferred >= MIN_DURATION_MIN &&
    preferred <= MAX_DURATION_MIN
  ) {
    return preferred;
  }
  return 25;
}

export function StartFocusCard() {
  const agent = useAgentLink();
  const { user } = useAuth();
  const navigate = useNavigate();
  const allowlistQuery = useAllowlist();
  const devicesQuery = useDevices({ limit: 20, sort: '-lastSeenAt' });

  const [durationMin, setDurationMin] = useState<number | null>(() =>
    defaultDuration(user?.defaultDurationMin),
  );
  const [consentOpen, setConsentOpen] = useState(false);
  const [reaside, setReaside] = useState(true);
  const [sendError, setSendError] = useState<string | null>(null);

  // The profile value is the honest default once it loads (the demo seed is 60 minutes).
  useEffect(() => {
    if (user === null) return;
    setDurationMin(defaultDuration(user.defaultDurationMin));
  }, [user?.defaultDurationMin]);

  const allowList = allowlistQuery.data?.userApps ?? [];
  const protectedApps = allowlistQuery.data?.protectedApps ?? [];
  const deviceName = pairedDeviceName(devicesQuery.data?.items ?? []);

  const asideLabels = useMemo(() => {
    if (agent.runningApps === null) return null;
    const keep = new Set([
      ...allowList.map((app) => app.key),
      ...protectedApps.map((app) => app.key),
    ]);
    return agent.runningApps
      .filter((app) => app.running && !keep.has(app.key))
      .map((app) => app.label);
  }, [agent.runningApps, allowList, protectedApps]);

  const allowListLabels = useMemo(() => allowList.map((app) => app.label), [allowList]);

  const unsupported = agent.capabilities?.focus === 'unsupported';

  // F-101 (A3 review, MED safety): starting focus while the allow-list is unknown would send
  // `userApps: []` and tell the user "none yet" when the truth is "unknown". Block until it is
  // known — protected apps are always safe, but the user's own apps are not guessable.
  const allowlistPending = allowlistQuery.isPending;
  const allowlistFailed = allowlistQuery.isError;
  const allowlistUnknown = allowlistPending || allowlistFailed;

  const blockedReason: string | null = unsupported
    ? FOCUS_REJECTED_MESSAGES.UNSUPPORTED
    : agent.status === 'FOCUSING'
      ? ERROR_MESSAGES.ALREADY_FOCUSING
      : agent.connecting && agent.status === 'DISCONNECTED'
        ? 'Connecting to your Focus Agent…'
        : agent.status === 'DISCONNECTED'
          ? ERROR_MESSAGES.NO_DEVICE_CONNECTED
          : agent.status === 'IDLE'
            ? FOCUS_REJECTED_MESSAGES.NOT_PAIRED
            : durationMin === null
              ? INVALID_DURATION_COPY
              : allowlistPending
                ? 'Loading your allow-list…'
                : allowlistFailed
                  ? "Couldn't load your allow-list. Retry before starting focus."
                  : null;

  const attentionNeeded = unsupported || agent.status === 'DISCONNECTED' || agent.status === 'IDLE';

  function openConsent(): void {
    setSendError(null);
    setConsentOpen(true);
  }

  function confirmStart(): void {
    if (durationMin === null) return;
    if (allowlistUnknown) {
      // Defensive: the consent modal cannot open in this state, but never start blind.
      setSendError('Your allow-list is not available yet. Retry before starting focus.');
      return;
    }
    const sent = agent.startFocus({
      durationMin,
      allowList,
      reaside,
      clientSessionId: newClientSessionId(),
    });

    if (!sent) {
      setSendError(UNREACHABLE_COPY);
      return;
    }

    setSendError(null);
    setConsentOpen(false);
  }

  return (
    <Card ariaLabelledBy="start-focus-heading">
      <CardHeader
        title="Start a focus session"
        titleId="start-focus-heading"
        description="One action, one focus block. You can end it at any time."
      />

      <CardBody>
        <DurationChips
          value={durationMin}
          onChange={setDurationMin}
          disabled={agent.status === 'FOCUSING' || unsupported}
        />

        <p className="mt-4 text-[13px] text-muted">
          Allow-listed:{' '}
          <span className="text-ink">
            {allowlistPending
              ? 'loading…'
              : allowlistFailed
                ? 'unknown — retry before starting'
                : allowListLabels.length === 0
                  ? 'none yet — protected apps only'
                  : allowListLabels.slice(0, 4).join(' · ') +
                    (allowListLabels.length > 4 ? ` · and ${allowListLabels.length - 4} more` : '')}
          </span>
        </p>

        {allowlistQuery.isError ? (
          // F-107: a failed allow-list fetch blocks Start, so it must interrupt (alert), not wait
          // for the next polite turn. Same sentence as before.
          <p role="alert" className="mt-1 text-[13px] text-danger-text">
            We couldn&apos;t load your allow-list. Check your connection and try again.
          </p>
        ) : null}

        {attentionNeeded ? (
          <p className="mt-4 flex items-start gap-2 rounded-[var(--radius-control)] border border-border bg-surface p-3 text-[13px] leading-[1.45] text-ink">
            <Timer aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-focus-strong" />
            <span>
              Connect the Focus Agent to start a session. The Focus Agent moves windows aside — the
              dashboard never touches your operating system.
            </span>
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            onClick={openConsent}
            disabled={blockedReason !== null}
            aria-describedby="start-focus-reason"
            leadingIcon={<Play aria-hidden="true" className="h-4 w-4" />}
          >
            Start Focus
          </Button>

          {agent.status === 'FOCUSING' ? (
            <Button variant="secondary" onClick={() => navigate('/focus')}>
              Go to Focus
            </Button>
          ) : null}

          <p id="start-focus-reason" className="max-w-prose text-[13px] text-muted">
            {blockedReason === null
              ? 'You can review exactly what happens before it starts.'
              : blockedReason}
          </p>
        </div>
      </CardBody>

      <ConsentModal
        open={consentOpen}
        durationMin={durationMin ?? 25}
        deviceName={deviceName}
        allowListLabels={allowListLabels}
        asideLabels={asideLabels}
        reaside={reaside}
        onReasideChange={setReaside}
        onRequestAsideCandidates={agent.requestRunningApps}
        onCancel={() => setConsentOpen(false)}
        onChangeDuration={() => setConsentOpen(false)}
        onConfirm={confirmStart}
        error={sendError}
      />
    </Card>
  );
}
