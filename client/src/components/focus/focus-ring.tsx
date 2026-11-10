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

/**
 * F-104: stroke width lives in viewBox units, so it scales with the ring (R7). Each value is the
 * §1.3 token expressed at the size that breakpoint renders: `--fm-ring-stroke-sm` 10 px at 220 px
 * = 5.45 units, 11 px at 280 px = 4.71, `--fm-ring-stroke-lg` 12 px at 320 px = 4.5. A fixed 4
 * units was ~7 px at 220 px, visibly thinner than the token. The class (CSS) wins over the
 * presentation attribute, which is kept as the no-CSS fallback.
 */
const STROKE_CLASSES = '[stroke-width:5.45] sm:[stroke-width:4.71] lg:[stroke-width:4.5]';
const STROKE_FALLBACK = 5.45;

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
          strokeWidth={STROKE_FALLBACK}
          className={STROKE_CLASSES}
        />
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--fm-ring-progress-color)"
          strokeWidth={STROKE_FALLBACK}
          className={STROKE_CLASSES}
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
