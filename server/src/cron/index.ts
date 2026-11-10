// server/src/cron/index.ts — starts/stops every periodic server job in one place (T-063/T-068).
// Why: `server.ts` should not know scheduler/reaper internals; it only calls `startCronJobs()` after
// the HTTP server + agent hub are ready and `stopCronJobs()` during graceful shutdown (jobs are
// unref'ed, but stopping them deterministically before Mongo disconnects avoids write races).
// Invariants: start is idempotent (returns false when already running); stop is idempotent and awaits
// the node-cron task so a tick in flight is not abandoned mid-write; no interval keeps the process
// alive on its own.

import type { ScheduledTask } from 'node-cron';
import { logger } from '../config/logger.js';
import { startReaper, type ReaperDeps } from './reaper.js';
import { startScheduler, startStaleRunSweeper, type SchedulerDeps } from './scheduler.js';

export interface StartCronJobsOptions {
  scheduler?: {
    cronExpression?: string;
    deps?: SchedulerDeps;
  };
  reaper?: {
    intervalMs?: number;
    deps?: ReaperDeps;
  };
  /** DEC-021 stale-run sweep cadence (default: every 60 s). */
  scheduleRunSweepIntervalMs?: number;
}

interface RunningCronJobs {
  scheduler: ScheduledTask;
  reaper: NodeJS.Timeout;
  staleRunSweeper: NodeJS.Timeout;
}

let runningJobs: RunningCronJobs | null = null;

/** Start the scheduler minute tick, the stale-run sweep and the session reaper (idempotent). */
export function startCronJobs(options: StartCronJobsOptions = {}): boolean {
  if (runningJobs !== null) {
    logger.warn('cron jobs already started — ignoring duplicate start');
    return false;
  }

  const schedulerTask = startScheduler(options.scheduler ?? {});
  const reaperTimer = startReaper(options.reaper ?? {});
  const staleRunSweeper = startStaleRunSweeper({
    intervalMs: options.scheduleRunSweepIntervalMs,
  });

  runningJobs = { scheduler: schedulerTask, reaper: reaperTimer, staleRunSweeper };
  logger.info('cron jobs started (scheduler, stale-run sweep, session reaper)');
  return true;
}

/** Stop every periodic job and wait for an in-flight scheduler tick (idempotent). */
export async function stopCronJobs(): Promise<void> {
  const jobs = runningJobs;
  if (jobs === null) return;
  runningJobs = null;

  clearInterval(jobs.reaper);
  clearInterval(jobs.staleRunSweeper);
  await jobs.scheduler.stop();
  logger.info('cron jobs stopped');
}

/** Test/introspection helper: are the periodic jobs currently registered? */
export function areCronJobsRunning(): boolean {
  return runningJobs !== null;
}
