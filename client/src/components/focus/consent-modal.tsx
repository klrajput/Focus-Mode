/*
 * ConsentModal — the explicit pre-session confirmation of UX_SPEC §5 (T-056, FR-009).
 *
 * The copy is fixed by A3: this file renders it verbatim and parameterises only the duration, the
 * end time, the device label, the allow-listed labels and the running-app list. There is exactly
 * one confirming action ("Confirm — start focus"); Cancel, Escape and the backdrop cancel. Nothing
 * in this component talks to the Focus Agent — `onConfirm` is the only bridge, and the caller sends
 * `enterFocus` only from there, so no message can leave before the user confirms.
 */

import { useEffect, useMemo, useState } from 'react';

import { formatClockTime } from '../../lib/format';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

/** Once the agent has not answered `listApps`, the modal stops waiting and omits the count. */
const ASIDE_TIMEOUT_MS = 4000;
const MAX_ASIDE_LABELS = 5;

export interface ConsentModalProps {
  open: boolean;
  durationMin: number;
  /** The paired device name when the dashboard knows it; `null` keeps the wording device-neutral. */
  deviceName: string | null;
  allowListLabels: readonly string[];
  /** Labels of the apps that will step aside, or `null` while the agent has not answered. */
  asideLabels: readonly string[] | null;
  /** "Keep new apps aside" toggle, default ON (UX_SPEC §5). */
  reaside: boolean;
  onReasideChange: (value: boolean) => void;
  /** Asks the agent for its running-app list (REC-007) — labels only, never titles (INV-6). */
  onRequestAsideCandidates: () => void;
  onCancel: () => void;
  /** "Change" in the duration row: return to the duration chips. */
  onChangeDuration: () => void;
  onConfirm: () => void;
  sending?: boolean;
  /** Shown in place of the footer action when the local channel refuses the message. */
  error?: string | null;
}

function asideSentence(labels: readonly string[]): string {
  if (labels.length === 0) return "Right now that's 0 apps: nothing else is open.";
  const shown = labels.slice(0, MAX_ASIDE_LABELS).join(', ');
  const rest = labels.length - MAX_ASIDE_LABELS;
  const suffix = rest > 0 ? `, and ${rest} more` : '';
  const noun = labels.length === 1 ? 'app' : 'apps';
  return `Right now that's ${labels.length} ${noun}: ${shown}${suffix}.`;
}

export function ConsentModal({
  open,
  durationMin,
  deviceName,
  allowListLabels,
  asideLabels,
  reaside,
  onReasideChange,
  onRequestAsideCandidates,
  onCancel,
  onChangeDuration,
  onConfirm,
  sending = false,
  error = null,
}: ConsentModalProps) {
  const [waitedTooLong, setWaitedTooLong] = useState(false);

  // Ask for the running-app list when the modal opens; give up quietly if the agent has no answer.
  useEffect(() => {
    if (!open) {
      setWaitedTooLong(false);
      return;
    }

    onRequestAsideCandidates();
    const timer = setTimeout(() => setWaitedTooLong(true), ASIDE_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // The request is intentionally sent once per open, not on every parent render: the callback is
    // a stable provider method, so `open` is the only trigger we want here.
  }, [open]);

  const endsAt = useMemo(
    () => formatClockTime(new Date(Date.now() + durationMin * 60_000)),
    [durationMin, open],
  );

  const allowListText = allowListLabels.length === 0 ? 'none yet' : allowListLabels.join(', ');

  return (
    <Dialog
      open={open}
      title={`Start a ${durationMin}-minute focus session?`}
      description={`This is exactly what will happen on ${
        deviceName ?? 'this computer'
      }. You can end it at any time.`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} loading={sending} loadingLabel="Starting…">
            Confirm — start focus
          </Button>
        </>
      }
    >
      <div className="space-y-5 text-[15px] leading-[1.45] text-ink">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2">
          <p className="min-w-0 text-[13px] text-ink">
            Duration: <span className="font-medium">{durationMin} minutes</span> — ends at {endsAt}.
          </p>
          <Button variant="secondary" size="sm" onClick={onChangeDuration} disabled={sending}>
            Change
          </Button>
        </div>

        <section aria-labelledby="consent-stays-open">
          <h3 id="consent-stays-open" className="text-[15px] font-semibold text-ink">
            These stay open
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-ink">
            <li>All web browsers (Chrome, Edge, Firefox, Safari and others)</li>
            <li>The Focus Agent</li>
            <li>
              System essentials: Task Manager (Windows) / Activity Monitor (macOS), File Explorer
              (Windows) / Finder (macOS), the Dock / taskbar, System Settings
            </li>
            <li>Your allow-listed apps: {allowListText}</li>
          </ul>
        </section>

        <section aria-labelledby="consent-steps-aside">
          <h3 id="consent-steps-aside" className="text-[15px] font-semibold text-ink">
            These will step aside
          </h3>
          <p className="mt-2 text-[13px] text-ink">
            Other open apps will be minimised or hidden so they&apos;re out of the way. They are not
            closed. Nothing is deleted or quit.
          </p>
          {asideLabels === null ? (
            waitedTooLong ? null : (
              <p role="status" className="mt-1 text-[13px] text-muted">
                Checking which apps are open…
              </p>
            )
          ) : (
            <p className="mt-1 text-[13px] text-ink">{asideSentence(asideLabels)}</p>
          )}
        </section>

        <section aria-labelledby="consent-new-apps">
          <h3 id="consent-new-apps" className="text-[15px] font-semibold text-ink">
            Keep new apps aside
          </h3>
          <div className="mt-2 flex items-start gap-2">
            <input
              id="consent-reaside"
              type="checkbox"
              role="switch"
              checked={reaside}
              disabled={sending}
              onChange={(event) => onReasideChange(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
            />
            <div className="min-w-0 text-[13px]">
              <label htmlFor="consent-reaside" className="font-medium text-ink">
                Keep new apps aside
              </label>
              <p className="mt-0.5 text-ink">
                On: apps that open or jump to the front during the session also step aside.
              </p>
              <p className="mt-0.5 text-muted">Off: a newly opened app stays in front.</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="consent-end-any-time">
          <h3 id="consent-end-any-time" className="text-[15px] font-semibold text-ink">
            You can end focus any time
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-ink">
            <li>End Focus on this dashboard</li>
            <li>End Focus in the Focus Agent tray menu</li>
            <li>Quit the Focus Agent — it restores your windows first</li>
          </ul>
        </section>

        <p className="text-[13px] leading-[1.45] text-muted">
          Focus starts only after you confirm. This summary is shown before every session. The Focus
          Agent never moves a window without your consent.
        </p>

        {error === null ? null : (
          <p role="alert" className={cn('text-[13px] font-medium text-danger-text')}>
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
