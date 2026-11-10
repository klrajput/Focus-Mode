// server/src/models/Schedule.ts — Mongo `schedules` collection (TECHNICAL_DESIGN §4, FR-012).
// A recurring local-time focus plan: `days` is a non-empty subset of 0–6 (0 = Sunday) and
// `startTime` is 24h `HH:mm` interpreted in the owning user's IANA timezone. `lastRunAt` is the
// scheduler's idempotency guard so a schedule fires at most once per matching minute; the compound
// `{enabled, days}` index is what the once-a-minute cron scans (TECHNICAL_DESIGN §8).

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

/** 24-hour clock, `HH:mm` (REQUIREMENTS §7). */
const START_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Persisted recurring schedule. */
export interface ISchedule {
  userId: Types.ObjectId;
  /** Name shown on the schedules page and in missed-run notifications. */
  name: string;
  /** 0 = Sunday … 6 = Saturday; non-empty and unique. */
  days: number[];
  startTime: string;
  durationMin: number;
  enabled: boolean;
  /** Last time the scheduler created a run for this schedule (idempotency key). */
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ScheduleDocument = HydratedDocument<ISchedule>;

const daysValidator = (days: number[]): boolean =>
  days.length >= 1 &&
  days.length <= 7 &&
  days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
  new Set(days).size === days.length;

const scheduleSchema = new Schema<ISchedule>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    days: {
      type: [Number],
      required: true,
      validate: [
        { validator: daysValidator, message: 'days must be a non-empty unique subset of 0-6' },
      ],
    },
    startTime: {
      type: String,
      required: true,
      match: [START_TIME_PATTERN, 'startTime must be 24-hour HH:mm'],
    },
    durationMin: {
      type: Number,
      required: true,
      min: 1,
      max: 480,
      validate: {
        validator: (value: number) => Number.isInteger(value),
        message: 'durationMin must be an integer',
      },
    },
    enabled: { type: Boolean, required: true, default: true },
    lastRunAt: { type: Date, default: null },
  },
  { collection: 'schedules', timestamps: true },
);

// TECHNICAL_DESIGN §4: the scheduler scans enabled schedules by weekday; the user list query and
// seed upsert filter on the owner, so keep an owner-first index too.
scheduleSchema.index({ enabled: 1, days: 1 });
scheduleSchema.index({ userId: 1, createdAt: -1 });

export const Schedule: Model<ISchedule> = model<ISchedule>('Schedule', scheduleSchema);
