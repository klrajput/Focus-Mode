// server/src/models/Session.ts — Mongo `sessions` collection (TECHNICAL_DESIGN §4, FR-010/FR-024).
// A session is the single source of truth for analytics (REQUIREMENTS §6 focus minutes) and for
// the "one active focus per device" invariant. The partial unique index on `{deviceId}` restricted
// to `status: 'ACTIVE'` makes FR-024 a database guarantee: a second ACTIVE insert for the same
// device fails with duplicate-key 11000 (API maps it to 409 ALREADY_FOCUSING), while any number of
// finished sessions per device stay allowed. `clientSessionId` is the agent's idempotency key
// (REC-006), unique per user so repeated cloud reports cannot duplicate a session.

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import type { EndReason, FocusSource, SessionStatus } from '@focus-mode/shared';
import { END_REASONS, FOCUS_SOURCES, SESSION_STATUSES } from './enums.js';

/** RFC-9562 UUID shape the agent generates once per focus run (REC-006). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Persisted focus session. */
export interface ISession {
  userId: Types.ObjectId;
  deviceId: Types.ObjectId;
  startedAt: Date;
  endedAt: Date | null;
  /** Requested duration in minutes (1–480). */
  plannedMinutes: number;
  /** Real focus minutes, fractional, rounded to 0.1 by the API; 0 while ACTIVE. */
  actualMinutes: number;
  status: SessionStatus;
  source: FocusSource;
  /** Agent-generated UUID; idempotency key for cloud reports. */
  clientSessionId: string;
  endReason: EndReason | null;
  /** Last agent heartbeat while ACTIVE; the reaper finalises silent sessions from it. */
  lastHeartbeatAt: Date | null;
}

export type SessionDocument = HydratedDocument<ISession>;

const integerBetween =
  (min: number, max: number) =>
  (value: number): boolean =>
    Number.isInteger(value) && value >= min && value <= max;

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    plannedMinutes: {
      type: Number,
      required: true,
      min: 1,
      max: 480,
      validate: { validator: integerBetween(1, 480), message: 'plannedMinutes must be an integer' },
    },
    actualMinutes: { type: Number, required: true, default: 0, min: 0, max: 1440 },
    status: { type: String, enum: [...SESSION_STATUSES], required: true, default: 'ACTIVE' },
    source: { type: String, enum: [...FOCUS_SOURCES], required: true, default: 'MANUAL' },
    clientSessionId: {
      type: String,
      required: true,
      match: [UUID_PATTERN, 'clientSessionId must be a UUID'],
    },
    endReason: { type: String, enum: [...END_REASONS], default: null },
    lastHeartbeatAt: { type: Date, default: null },
  },
  { collection: 'sessions' },
);

// TECHNICAL_DESIGN §4 indexes (each one is exercised by server/src/models/Session.test.ts).
sessionSchema.index({ userId: 1, deviceId: 1 });
sessionSchema.index({ userId: 1, clientSessionId: 1 }, { unique: true });
sessionSchema.index({ userId: 1, startedAt: -1 });
// FR-024: at most one ACTIVE session per device. Partial so finished sessions are unconstrained.
sessionSchema.index(
  { deviceId: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);
// Extra index for A5's reaper: ACTIVE sessions ordered by heartbeat age (TECHNICAL_DESIGN §8).
sessionSchema.index({ status: 1, lastHeartbeatAt: 1 });

export const Session: Model<ISession> = model<ISession>('Session', sessionSchema);
