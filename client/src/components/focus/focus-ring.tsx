/*
 * FocusRing — the /focus countdown ring (T-057, UX_SPEC §4.4/§10.4).
 * SVG only: the geometry is a 120-unit viewBox scaled by Tailwind width classes (220 / 280 / 320 px),
 * so there is no fixed pixel width that could overflow a 360 px viewport. Accessible name is the
 * full sentence; the visible digits are `aria-hidden` because the polite live region in the page
 * announces the same information at minute granularity.
 */

import { cn } from '../../lib/cn';
import { formatClock, spokenRemaining } from '../../focus/countdown';

const VIEWBOX = 120;
const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface FocusRingProps {
  remaining: number;
  /** Whole session length in seconds; drives the progress arc. */
  total: number;
  className?: string;
}

export function FocusRing({ remaining, total, className }: FocusRingProps) {
  const fraction = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;

  return (
    <div className={cn('relative aspect-square w-[220px] sm:w-[280px] lg:w-[320px]', className)}>
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        role="img"
        aria-label={`Focus session: ${spokenRemaining(remaining)}`}
        className="h-full w-full -rotate-90"
      >
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--fm-ring-track-color)"
          strokeWidth={4}
        />
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--fm-ring-progress-color)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p
          aria-hidden="true"
          className="font-mono text-[40px] leading-none font-semibold tabular-nums text-white sm:text-[48px]"
        >
          {formatClock(remaining)}
        </p>
        <p aria-hidden="true" className="mt-2 text-[13px] text-text-on-base-muted">
          remaining
        </p>
      </div>
    </div>
  );
}
