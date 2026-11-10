// server/src/models/ScheduleRun.ts — Mongo `scheduleRuns` collection (REC addition, TECHNICAL_DESIGN
// §4; FR-012, FR-017). One row per due schedule occurrence: the scheduler creates it when the
// minute matches, then marks it STARTED when the agent confirms a focus start, or MISSED when no
// connected device could start it (which also produces the missed-run notification). The compound
// `{scheduleId, firedAt}` index is the idempotency guard that stops a schedule firing twice in the
// same minute; `deviceId` stays null for a MISSED run (no device acted). `sessionId` links the run
// to the focus session the agent confirms (`session.started` carries `scheduleRunId`, DEC-021) and
// stays null while dispatch is unconfirmed; `{status, firedAt}` serves the stale-run sweep.

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import { SCHEDULE_RUN_STATUSES, type ScheduleRunStatus } from './enums.js';

/** Persisted due-run record for one schedule occurrence. */
export interface IScheduleRun {
  scheduleId: Types.ObjectId;
  userId: Types.ObjectId;
  /** Device the run was dispatched to; null when the run was missed (no connected device). */
  deviceId: Types.ObjectId | null;
  /** The scheduled minute the run is for (UTC instant computed from user timezone). */
  firedAt: Date;
  status: ScheduleRunStatus;
  /**
   * Session that confirmed this run (DEC-021). `null` = the run was dispatched
   * (`scheduleDue` sent) but no scheduled focus started yet; set when the agent reports
   * `session.started` with this `scheduleRunId`.
   */
  sessionId: Types.ObjectId | null;
}

export type ScheduleRunDocument = HydratedDocument<IScheduleRun>;

const scheduleRunSchema = new Schema<IScheduleRun>(
  {
    scheduleId: { type: Schema.Types.ObjectId, ref: 'Schedule', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null },
    firedAt: { type: Date, required: true },
    status: {
      type: String,
      enum: [...SCHEDULE_RUN_STATUSES],
      required: true,
      default: 'STARTED',
    },
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', default: null },
  },
  { collection: 'scheduleRuns' },
);

// TECHNICAL_DESIGN §4: one run per (schedule, minute); also the scheduler's lookup path.
scheduleRunSchema.index({ scheduleId: 1, firedAt: 1 });
// Missed-run notifications and per-user run history read by owner.
scheduleRunSchema.index({ userId: 1, firedAt: -1 });
// DEC-021 stale-run sweep: dispatched-but-unconfirmed runs ordered by age (status + firedAt).
scheduleRunSchema.index({ status: 1, firedAt: 1 });

export const ScheduleRun: Model<IScheduleRun> = model<IScheduleRun>(
  'ScheduleRun',
  scheduleRunSchema,
);
