/*
 * AgentHelpCard — the "Can't reach your Focus Agent" card (UX_SPEC §6.3, T-045 / S-4).
 * Shown after a failed local-channel connect; it explains the Chrome/Edge/Firefox local-network
 * permission, tells Safari users that ws://127.0.0.1 is blocked from an HTTPS page, and lists the
 * three things to check. It is dismissible and never claims a connection the link does not have.
 */

import { AlertTriangle, Download } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Card, CardBody } from '../ui/card';
import { Button } from '../ui/button';

export interface AgentHelpCardProps {
  onDismiss: () => void;
}

/** Safari (incl. iOS) cannot open a loopback WebSocket from an HTTPS dashboard (§6.3). */
function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent;
  if (!/safari/i.test(userAgent)) return false;
  return !/chrome|chromium|crios|edg|fxios|firefox|android/i.test(userAgent);
}

const BROWSER_HELP: ReadonlyArray<{ browser: string; instruction: string }> = [
  {
    browser: 'Chrome / Edge',
    instruction:
      'Settings → Privacy and security → Site settings → Local network access → allow this site, then Reload.',
  },
  {
    browser: 'Firefox 147+',
    instruction: 'When the "Local network access" prompt appears, choose Allow.',
  },
];

const TROUBLESHOOTING: readonly string[] = [
  'Start your Focus Agent and leave it running — its tray icon should be visible.',
  'Does the agent window show a pairing code or "Paired"?',
  'Reload this page. If it still fails, restart the Focus Agent.',
];

export function AgentHelpCard({ onDismiss }: AgentHelpCardProps) {
  const safari = isSafari();

  return (
    <Card ariaLabelledBy="agent-help-title" className="mb-4 border-amber-strong/40 bg-amber-subtle">
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-text" />
            <div className="min-w-0">
              <h2
                id="agent-help-title"
                className="text-[20px] leading-[1.3] font-semibold break-words text-ink"
              >
                Allow this site to reach your Focus Agent
              </h2>

              {safari ? (
                <p className="mt-2 text-[15px] leading-[1.55] text-ink">
                  <strong className="font-semibold">
                    Your browser can&apos;t connect to the Focus Agent.
                  </strong>{' '}
                  Safari can&apos;t open a local WebSocket from an HTTPS page. Use Chrome, Edge or
                  Firefox for the dashboard.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-[15px] leading-[1.55] text-ink">
                    Your browser may ask for permission to access devices on your local network.
                    Choose Allow — the connection stays on this computer (
                    <code className="font-mono text-[13px]">ws://127.0.0.1:4545</code>) and never
                    leaves it.
                  </p>

                  <h3 className="mt-4 text-[15px] font-semibold text-ink">By browser</h3>
                  <dl className="mt-2 space-y-2">
                    {BROWSER_HELP.map((entry) => (
                      <div key={entry.browser} className="min-w-0 text-[13px] leading-[1.45]">
                        <dt className="font-semibold text-ink">{entry.browser}</dt>
                        <dd className="text-muted">{entry.instruction}</dd>
                      </div>
                    ))}
                    <div className="min-w-0 text-[13px] leading-[1.45]">
                      <dt className="font-semibold text-ink">Safari</dt>
                      <dd className="text-muted">
                        Safari can&apos;t open a local WebSocket from an HTTPS page. Open this
                        dashboard in Chrome, Edge or Firefox to connect your Focus Agent.
                      </dd>
                    </div>
                  </dl>
                </>
              )}

              <h3 className="mt-4 text-[15px] font-semibold text-ink">Still not connecting?</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-[1.45] text-muted">
                {TROUBLESHOOTING.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={() => window.location.reload()}>
                  Reload page
                </Button>
                <Link
                  to="/#downloads-heading"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm font-medium text-ink hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
                >
                  <Download aria-hidden="true" className="h-4 w-4" />
                  Open download page
                </Link>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            className="-mt-1 -mr-2 flex min-h-11 shrink-0 items-center rounded-[var(--radius-control)] px-2 text-[13px] font-medium text-muted hover:bg-primary-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
          >
            Dismiss
          </button>
        </div>
      </CardBody>
    </Card>
  );
}
