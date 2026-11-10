/*
 * `/focus` — the calm live session view (T-057, FR-006/FR-007/FR-009, UX_SPEC §4.4).
 *
 * Everything here is derived from the Focus Agent's truth: the ring counts down from `endsAt`, and
 * the only action is End Focus, which sends the local `exitFocus` control message. When the local
 * link drops mid-session the page keeps the session visible (the agent keeps running it and ends it
 * on time) and shows the ratified "Lost contact" banner with a Reconnect action — F-02.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timer, WifiOff } from 'lucide-react';

import { useAgentLink } from '../agent/agent-link-provider';
import { Button } from '../components/ui/button';
import { Card, CardBody } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { FocusRing } from '../components/focus/focus-ring';
import { PageHeader } from '../components/ui/page-header';
import { useAllowlist } from '../hooks/use-allowlist';
import { useDevices } from '../hooks/use-devices';
import { announcementFor } from '../focus/countdown';
import { END_UNREACHABLE_COPY, LINK_LOST_COPY } from '../focus/copy';
import { pairedDeviceName } from '../focus/paired-device';
import { useCountdown } from '../focus/use-countdown';
import { formatClockTime, formatDuration, formatDateTime } from '../lib/format';

/** The "stays open" categories are the fixed §5 consent promises, not invented device data. */
const STAYS_OPEN_CATEGORIES = [
  'All web browsers',
  'The Focus Agent',
  'System essentials',
] as const;

export function FocusPage() {
  const agent = useAgentLink();
  const navigate = useNavigate();
  const devicesQuery = useDevices({ limit: 20, sort: '-lastSeenAt' });
  const allowlistQuery = useAllowlist();

  const session = agent.session;
  const remaining = useCountdown(session?.endsAt ?? null);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // The polite live region speaks at minute granularity plus the 30 s / 10 s marks (UX_SPEC §10.4).
  useEffect(() => {
    const text = announcementFor(remaining);
    if (text !== null) setAnnouncement(text);
  }, [remaining]);

  useEffect(() => {
    if (session === null) setEnding(false);
  }, [session]);

  // Safety net: a silent agent must not leave the button in "Ending…" for ever.
  useEffect(() => {
    if (!ending) return;
    const timer = setTimeout(() => {
      setEnding(false);
      setEndError(END_UNREACHABLE_COPY);
    }, 15_000);
    return () => clearTimeout(timer);
  }, [ending]);

  function endFocus(): void {
    setEndError(null);
    setEnding(true);
    const sent = agent.endFocus();
    if (!sent) {
      setEnding(false);
      setEndError(END_UNREACHABLE_COPY);
    }
  }

  const deviceName = pairedDeviceName(devicesQuery.data?.items ?? []);
  const allowListLabels = (allowlistQuery.data?.userApps ?? []).map((app) => app.label);

  return (
    <>
      {session === null ? (
        <PageHeader
          title="Focus"
          description="Focus on one thing. Everything else steps aside — visibly and reversibly."
        />
      ) : null}

      {/* Ratified §4.4 error state: the bar/page must keep warning instead of vanishing. */}
      {agent.linkLost && session !== null ? (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-card)] border border-amber-strong bg-amber-subtle p-4"
        >
          <p className="flex min-w-0 items-start gap-2 text-[15px] leading-[1.45] text-amber-text">
            <WifiOff aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{LINK_LOST_COPY}</span>
          </p>
          <Button variant="secondary" onClick={agent.refresh}>
            Reconnect
          </Button>
        </div>
      ) : null}

      {session !== null ? (
        <section
          aria-label="Focus session"
          className="rounded-[var(--radius-card)] border border-border bg-base px-4 py-6 text-white sm:px-6"
        >
          {/* The calm view has no page title bar; keep exactly one h1 for screen readers. */}
          <h1 className="sr-only">Focus</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-text-on-base-muted">
            <span className="font-semibold tracking-wide text-focus-on-base uppercase">
              Focusing
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatDuration(session.plannedMinutes)} planned</span>
            <span aria-hidden="true">·</span>
            <span>{session.source === 'SCHEDULE' ? 'Schedule' : 'Manual'}</span>
            <span aria-hidden="true">·</span>
            <span>started {formatClockTime(new Date(session.startedAt))}</span>
            {deviceName === null ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span className="min-w-0 truncate">device: {deviceName}</span>
              </>
            )}
          </div>

          <div className="mt-6 flex flex-col items-center">
            <FocusRing
              remaining={remaining}
              total={Math.max(1, session.plannedMinutes * 60)}
            />

            {/* Announced only at minute granularity / 30 s / 10 s — never every second. */}
            <p role="timer" aria-live="polite" className="sr-only">
              {announcement}
            </p>

            <div className="mt-6 w-full max-w-prose space-y-4">
              <div>
                <h2 className="text-[13px] font-semibold tracking-wide text-text-on-base-muted uppercase">
                  Stays open
                </h2>
                <p className="mt-1 text-[15px] text-white">
                  {[...STAYS_OPEN_CATEGORIES, ...allowListLabels].join(' · ')}
                </p>
              </div>

              <div>
                <h2 className="text-[13px] font-semibold tracking-wide text-text-on-base-muted uppercase">
                  Stepped aside
                </h2>
                <p className="mt-1 text-[15px] text-white">
                  Minimised, not closed
                  {agent.lastStartReaside === null
                    ? ''
                    : ` · re-aside: ${agent.lastStartReaside ? 'on' : 'off'}`}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                size="md"
                variant="on-base"
                onClick={endFocus}
                loading={ending}
                loadingLabel="Ending…"
                className="h-12 px-6 text-base"
              >
                End Focus
              </Button>
            </div>

            {endError === null ? null : (
              <p role="alert" className="mt-3 max-w-prose text-[13px] text-danger-on-base">
                {endError}
              </p>
            )}

            <p className="mt-4 max-w-prose text-center text-[13px] leading-[1.45] text-text-on-base-muted">
              You can also end from the Focus Agent tray menu, or by quitting it.
            </p>
          </div>
        </section>
      ) : null}

      {session === null && agent.lastEnded !== null ? (
        <Card ariaLabelledBy="focus-ended-heading">
          <CardBody>
            <h2
              id="focus-ended-heading"
              className="text-[20px] leading-[1.3] font-semibold text-ink"
            >
              Focus ended — your windows are back.
            </h2>
            <dl className="mt-4 grid gap-3 text-[15px] sm:grid-cols-2">
              <div>
                <dt className="text-[13px] text-muted">Focused time</dt>
                <dd className="text-ink">{formatDuration(agent.lastEnded.actualMinutes)}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted">Ended</dt>
                <dd className="text-ink">{formatDateTime(agent.lastEnded.at)}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted">Reason</dt>
                <dd className="text-ink">
                  {agent.lastEnded.reason === 'COMPLETED' ? 'Completed' : 'Ended early'}
                </dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                onClick={() => {
                  agent.dismissEndedSession();
                  navigate('/dashboard');
                }}
              >
                Back to dashboard
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {session === null && agent.lastEnded === null && agent.connecting ? (
        <Card>
          <CardBody>
            <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 py-8">
              <span className="sr-only">Checking your session with the Focus Agent…</span>
              <span
                aria-hidden="true"
                className="h-[220px] w-[220px] rounded-full border-[10px] border-skeleton"
              />
              <p className="text-[15px] text-muted">Checking your session with the Focus Agent…</p>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {session === null && agent.lastEnded === null && !agent.connecting ? (
        <EmptyState
          icon={Timer}
          title="No focus session is running."
          description="Start a session from the dashboard once your Focus Agent is connected. This page will then show the countdown, what is staying open and an always-available End Focus."
          action={
            <>
              <Button onClick={() => navigate('/dashboard')}>Start a session</Button>
              <Button variant="secondary" onClick={() => navigate('/devices')}>
                Open Devices
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );
}
