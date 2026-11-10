// server/src/cron/reaper.ts — the stale-session reaper (T-068, FR-028/TECHNICAL_DESIGN §8).
// Why: analytics must stay honest. If a Focus Agent dies mid-session (crash, kill -9, power loss),
// the session would otherwise stay ACTIVE forever and inflate `actualMinutes`/completion stats.
// The hub already marks a device DISCONNECTED after 45 s without a heartbeat, so every 5 minutes the
// reaper finalises ACTIVE sessions whose heartbeat is older than 2 × the 15 s agent cadence **and**
// whose device is currently offline: `endedAt = lastHeartbeatAt`, `actualMinutes` bounded by that
// window, status CANCELLED, `endReason: CRASH_RECOVERY`.
// Invariants: a session whose device is connected/FOCUSING is never reaped (the agent is authoritative
// via the heartbeat path); terminal sessions are untouched; the update is guarded by `status ACTIVE`
// so a racing agent report always wins (REC-006); no notification is fabricated here.

import { isDeviceConnected } from '../realtime/agentHub.js';
import { Session } from '../models/Session.js';
import { logger } from '../config/logger.js';

/** Contract §5.1: the agent heartbeat cadence. */
export const HEARTBEAT_INTERVAL_MS = 15 * 1000;
/** "older than 2× heartbeat interval" (task-29 AC / TECHNICAL_DESIGN §8). */
export const REAPER_STALE_AFTER_MS = 2 * HEARTBEAT_INTERVAL_MS;
/** TECHNICAL_DESIGN §8: the reaper runs every 5 minutes. */
export const REAPER_INTERVAL_MS = 5 * 60 * 1000;
/** Upper bound for one reaper pass (keeps a large backlog bounded per run). */
const REAPER_BATCH_LIMIT = 200;
const MINUTE_PRECISION = 10;
const MAX_ACTUAL_MINUTES = 1440;

/** Dependencies are injectable so tests can freeze the clock and device-presence source. */
export interface ReaperDeps {
  now?: () => Date;
  isDeviceConnected?: (deviceId: string) => boolean;
}

export interface ReaperResult {
  /** Sessions scanned (ACTIVE at query time). */
  scanned: number;
  /** Sessions finalised as CANCELLED/CRASH_RECOVERY by this pass. */
  reaped: number;
}

function roundMinutes(value: number): number {
  return Math.round(value * MINUTE_PRECISION) / MINUTE_PRECISION;
}

/** Focus minutes bounded by the heartbeat window, rounded to 0.1 (REQUIREMENTS §6). */
export function boundedActualMinutes(startedAt: Date, lastHeartbeatAt: Date): number {
  const elapsedMinutes = Math.max(0, (lastHeartbeatAt.getTime() - startedAt.getTime()) / 60000);
  return roundMinutes(Math.min(elapsedMinutes, MAX_ACTUAL_MINUTES));
}

/**
 * Finalise stale ACTIVE sessions of offline devices. Returns real counts (no optimistic claims);
 * per-session failures are logged and do not abort the pass.
 */
export async function reapStaleSessions(deps: ReaperDeps = {}): Promise<ReaperResult> {
  const now = deps.now?.() ?? new Date();
  const connected = deps.isDeviceConnected ?? isDeviceConnected;
  const result: ReaperResult = { scanned: 0, reaped: 0 };

  const candidates = await Session.find({ status: 'ACTIVE' })
    .select('_id userId deviceId startedAt lastHeartbeatAt')
    .limit(REAPER_BATCH_LIMIT)
    .lean();
  result.scanned = candidates.length;

  for (const session of candidates) {
    const deviceId = String(session.deviceId);
    if (connected(deviceId)) continue;

    const lastHeartbeatAt = session.lastHeartbeatAt ?? session.startedAt;
    if (now.getTime() - lastHeartbeatAt.getTime() <= REAPER_STALE_AFTER_MS) continue;

    try {
      const updated = await Session.findOneAndUpdate(
        { _id: session._id, status: 'ACTIVE' },
        {
          $set: {
            status: 'CANCELLED',
            endReason: 'CRASH_RECOVERY',
            endedAt: lastHeartbeatAt,
            actualMinutes: boundedActualMinutes(session.startedAt, lastHeartbeatAt),
          },
        },
        { new: true },
      );
      if (updated === null) continue; // the agent finalised it between the read and the update
      result.reaped += 1;
      logger.warn(
        {
          sessionId: String(session._id),
          deviceId,
          lastHeartbeatAt: lastHeartbeatAt.toISOString(),
        },
        'stale ACTIVE session reaped (CRASH_RECOVERY) — analytics kept honest',
      );
    } catch (error) {
      logger.error({ err: error, sessionId: String(session._id) }, 'session reaper failed');
    }
  }

  return result;
}

/** Start the 5-minute reaper interval (unref'ed so it never keeps the process alive by itself). */
export function startReaper(
  options: { intervalMs?: number; deps?: ReaperDeps } = {},
): NodeJS.Timeout {
  const timer = setInterval(() => {
    void reapStaleSessions(options.deps)
      .then((result) => {
        if (result.reaped > 0) logger.info(result, 'session reaper completed');
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'session reaper pass failed');
      });
  }, options.intervalMs ?? REAPER_INTERVAL_MS);
  timer.unref();
  return timer;
}
