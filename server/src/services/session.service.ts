// server/src/services/session.service.ts — focus-session lifecycle (T-060, FR-010/FR-024/REC-006).
// Why: a session is the analytics source of truth AND the "one active focus per device" invariant.
// The dashboard creates it when the Focus Agent confirms `focusStarted`, finalises it when the
// agent reports `focusEnded`, and the agent may report the same session over the cloud channel:
// `{userId, clientSessionId}` is therefore the idempotency key (REC-006) — a repeated create returns
// the same session (never a duplicate), and a repeated finalise with identical values stays a 200.
// Invariants: only the owner sees/touches a session (foreign id = 404, NFR-003); a second ACTIVE
// session for one device is 409 ALREADY_FOCUSING (pre-check + the model's partial unique index);
// `actualMinutes` is capped by the elapsed time and rounded to 0.1 (REQUIREMENTS §6); terminal
// sessions can never be reopened or silently rewritten (conflicting finalise = 409 CONFLICT).

import { Types } from 'mongoose';
import {
  ERROR_CODES,
  type EndReason,
  type FocusSource,
  type Paginated,
  type SessionCreateInput,
  type SessionListQuery,
  type SessionPatchInput,
  type SessionStatus,
  type TerminalSessionStatus,
} from '@focus-mode/shared';
import { Device } from '../models/Device.js';
import { Session, type SessionDocument } from '../models/Session.js';
import { AppError } from '../utils/AppError.js';
import { duplicateKeyFields, isDuplicateKeyError } from '../utils/mongo-errors.js';
import { buildPaginated, pageSkip } from '../utils/pagination.js';
import { escapeRegex } from '../utils/search.js';
import { toObjectIdOrNotFound } from '../utils/object-id.js';
import { toIsoString } from '../utils/serialize.js';

/** Clock-skew tolerance for a `startedAt`/`endedAt` in the future (device clocks may drift). */
export const FUTURE_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
/** REQUIREMENTS §6: actual minutes are rounded to 0.1. */
const MINUTE_PRECISION = 10;
/** Shared `actualMinutesSchema` upper bound; the elapsed-time cap is stricter in practice. */
const MAX_ACTUAL_MINUTES = 1440;
const ALREADY_FOCUSING_MESSAGE = 'This device already has an active focus session.';
const IDEMPOTENCY_CONFLICT_MESSAGE =
  'This clientSessionId was already used with different session values.';

/** `session` wire shape (INTEGRATION_CONTRACTS §3.3). */
export interface PublicSession {
  id: string;
  deviceId: string;
  startedAt: string;
  endedAt: string | null;
  plannedMinutes: number;
  actualMinutes: number;
  status: SessionStatus;
  source: FocusSource;
  clientSessionId: string;
  endReason: EndReason | null;
  lastHeartbeatAt: string | null;
}

interface SessionLike {
  _id: unknown;
  deviceId: unknown;
  startedAt: Date;
  endedAt: Date | null;
  plannedMinutes: number;
  actualMinutes: number;
  status: SessionStatus;
  source: FocusSource;
  clientSessionId: string;
  endReason: EndReason | null;
  lastHeartbeatAt: Date | null;
}

/** Whitelist + serialise a session document for API responses. */
export function toPublicSession(session: SessionLike): PublicSession {
  return {
    id: String(session._id),
    deviceId: String(session.deviceId),
    startedAt: toIsoString(session.startedAt) ?? '',
    endedAt: toIsoString(session.endedAt),
    plannedMinutes: session.plannedMinutes,
    actualMinutes: session.actualMinutes,
    status: session.status,
    source: session.source,
    clientSessionId: session.clientSessionId,
    endReason: session.endReason,
    lastHeartbeatAt: toIsoString(session.lastHeartbeatAt),
  };
}

function toObjectId(value: string): Types.ObjectId {
  // W6/SEC-9: malformed path/owner ids are 404s from a safe parser, never a cast 500.
  return toObjectIdOrNotFound(value);
}

function roundMinutes(value: number): number {
  return Math.round(value * MINUTE_PRECISION) / MINUTE_PRECISION;
}

/** REC-006: does an existing session describe the same create request? */
function matchesCreateBody(session: SessionLike, input: SessionCreateInput): boolean {
  return (
    String(session.deviceId) === input.deviceId &&
    session.plannedMinutes === input.durationMin &&
    session.startedAt.getTime() === new Date(input.startedAt).getTime() &&
    session.source === input.source
  );
}

/** REQUIREMENTS §6: never claim more focused minutes than the session actually spanned. */
function capActualMinutes(startedAt: Date, endedAt: Date, requested: number): number {
  const elapsedMinutes = Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 60000);
  return roundMinutes(Math.min(requested, elapsedMinutes, MAX_ACTUAL_MINUTES));
}

export interface CreateSessionResult {
  session: PublicSession;
  /** false when the request replayed an existing `{userId, clientSessionId}` (REC-006). */
  created: boolean;
}

/** POST /sessions — create or replay idempotently. */
export async function createSession(
  userId: string,
  input: SessionCreateInput,
): Promise<CreateSessionResult> {
  const ownerObjectId = toObjectId(userId);
  const deviceObjectId = toObjectId(input.deviceId);

  const device = await Device.findOne({ _id: deviceObjectId, ownerId: ownerObjectId });
  if (device === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Device not found.');
  }

  const startedAt = new Date(input.startedAt);
  if (startedAt.getTime() > Date.now() + FUTURE_TIMESTAMP_TOLERANCE_MS) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [
      { path: 'startedAt', message: 'startedAt cannot be in the future' },
    ]);
  }

  // REC-006: the agent and the dashboard may both report the same session.
  const existing = await Session.findOne({
    userId: ownerObjectId,
    clientSessionId: input.clientSessionId,
  });
  if (existing !== null) {
    if (!matchesCreateBody(existing, input)) {
      throw new AppError(ERROR_CODES.CONFLICT, IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    return { session: toPublicSession(existing), created: false };
  }

  // FR-024: clear, friendly 409 before the database partial-unique index has to catch the race.
  const active = await Session.exists({ deviceId: deviceObjectId, status: 'ACTIVE' });
  if (active !== null) {
    throw new AppError(ERROR_CODES.ALREADY_FOCUSING, ALREADY_FOCUSING_MESSAGE);
  }

  try {
    const created = await Session.create({
      userId: ownerObjectId,
      deviceId: deviceObjectId,
      startedAt,
      plannedMinutes: input.durationMin,
      actualMinutes: 0,
      status: 'ACTIVE',
      source: input.source,
      clientSessionId: input.clientSessionId,
      endReason: null,
      // Baseline for the W4 reaper (FR-028) until the agent's first heartbeat arrives.
      lastHeartbeatAt: startedAt,
    });
    return { session: toPublicSession(created), created: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const fields = duplicateKeyFields(error);
    if (fields.includes('clientSessionId')) {
      // Lost the idempotency race to another report of the same session.
      const raced = await Session.findOne({
        userId: ownerObjectId,
        clientSessionId: input.clientSessionId,
      });
      if (raced !== null && matchesCreateBody(raced, input)) {
        return { session: toPublicSession(raced), created: false };
      }
      throw new AppError(ERROR_CODES.CONFLICT, IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    // Partial unique `{deviceId}` on ACTIVE sessions = FR-024.
    throw new AppError(ERROR_CODES.ALREADY_FOCUSING, ALREADY_FOCUSING_MESSAGE);
  }
}

/** Idempotent terminal-branch comparison for PATCH (same values → 200, different → 409). */
function matchesFinaliseBody(
  session: SessionLike,
  input: SessionPatchInput,
  cappedActualMinutes: number,
  endedAt: Date,
): boolean {
  return (
    session.status === input.status &&
    session.endedAt?.getTime() === endedAt.getTime() &&
    roundMinutes(session.actualMinutes) === cappedActualMinutes &&
    session.endReason === input.endReason
  );
}

/** PATCH /sessions/:id — finalise exactly once (idempotent replay), cap actualMinutes by elapsed. */
export async function finaliseSession(
  userId: string,
  sessionId: string,
  input: SessionPatchInput,
): Promise<PublicSession> {
  const ownerObjectId = toObjectId(userId);
  const session = await Session.findOne({ _id: toObjectId(sessionId), userId: ownerObjectId });
  if (session === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Session not found.');
  }

  const endedAt = new Date(input.endedAt);
  if (endedAt.getTime() < session.startedAt.getTime()) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [
      { path: 'endedAt', message: 'endedAt cannot be before startedAt' },
    ]);
  }
  if (endedAt.getTime() > Date.now() + FUTURE_TIMESTAMP_TOLERANCE_MS) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [
      { path: 'endedAt', message: 'endedAt cannot be in the future' },
    ]);
  }
  const actualMinutes = capActualMinutes(session.startedAt, endedAt, input.actualMinutes);

  if (session.status !== 'ACTIVE') {
    if (matchesFinaliseBody(session, input, actualMinutes, endedAt)) {
      return toPublicSession(session);
    }
    throw new AppError(
      ERROR_CODES.CONFLICT,
      'This session was already finalised with different values.',
    );
  }

  const updated = await Session.findOneAndUpdate(
    { _id: session._id, userId: ownerObjectId, status: 'ACTIVE' },
    {
      $set: {
        status: input.status,
        endedAt,
        actualMinutes,
        endReason: input.endReason,
      },
    },
    { new: true },
  );

  if (updated === null) {
    // Raced with another finalise call: apply the idempotency rule to the winner's document.
    const raced = await Session.findOne({ _id: session._id, userId: ownerObjectId });
    if (raced === null) throw new AppError(ERROR_CODES.NOT_FOUND, 'Session not found.');
    if (matchesFinaliseBody(raced, input, actualMinutes, endedAt)) {
      return toPublicSession(raced);
    }
    throw new AppError(
      ERROR_CODES.CONFLICT,
      'This session was already finalised with different values.',
    );
  }

  return toPublicSession(updated as unknown as SessionLike);
}

/** Frozen `sessionsSortSchema` → Mongo sort (whitelisted; the schema already rejected the rest). */
function resolveSessionSort(sort: string): { [field: string]: 1 | -1 } {
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  return { [field]: descending ? -1 : 1 };
}

/** GET /sessions — owner-scoped list with from/to/status/source filters and pagination (NFR-009). */
export async function listSessions(
  userId: string,
  query: SessionListQuery,
): Promise<Paginated<PublicSession>> {
  const ownerObjectId = toObjectId(userId);
  const filter: Record<string, unknown> = { userId: ownerObjectId };

  if (query.from !== undefined || query.to !== undefined) {
    const startedAtRange: Record<string, Date> = {};
    if (query.from !== undefined) startedAtRange.$gte = new Date(query.from);
    if (query.to !== undefined) startedAtRange.$lte = new Date(query.to);
    filter.startedAt = startedAtRange;
  }
  if (query.status !== undefined) filter.status = query.status;
  if (query.source !== undefined) filter.source = query.source;

  // `search` matches the device name (sessions carry no user text field of their own).
  if (query.search !== undefined) {
    const devices = await Device.find({
      ownerId: ownerObjectId,
      name: { $regex: escapeRegex(query.search), $options: 'i' },
    })
      .select('_id')
      .lean();
    filter.deviceId = { $in: devices.map((device) => device._id) };
  }

  const [total, sessions] = await Promise.all([
    Session.countDocuments(filter),
    Session.find(filter)
      .sort(resolveSessionSort(query.sort))
      .skip(pageSkip(query.page, query.limit))
      .limit(query.limit)
      .lean(),
  ]);

  return buildPaginated(
    sessions.map((session) => toPublicSession(session)),
    query.page,
    query.limit,
    total,
  );
}

/** GET /sessions/active — the caller's current ACTIVE focus session, or null (dashboard refresh). */
export async function getActiveSession(userId: string): Promise<PublicSession | null> {
  const session: SessionDocument | null = await Session.findOne({
    userId: toObjectId(userId),
    status: 'ACTIVE',
  }).sort({ startedAt: -1 });
  return session === null ? null : toPublicSession(session);
}

// ---------------------------------------------------------------------------
// Agent cloud reporting (T-069 server half, REC-006 / FR-027)
// ---------------------------------------------------------------------------

/**
 * The agent's `session.started` cloud report. It goes through the SAME service as the dashboard's
 * `POST /sessions`, so a dashboard create + an agent report for one `clientSessionId` produce ONE
 * session (idempotent), and an agent-only report (dashboard closed, FR-027) still persists it.
 * Throws the same AppErrors as the REST path; the hub logs conflicts instead of closing the socket.
 */
export interface ReportedSessionStart {
  deviceId: string;
  clientSessionId: string;
  startedAt: string;
  plannedMinutes: number;
  source: FocusSource;
}

export async function reportSessionStarted(
  userId: string,
  input: ReportedSessionStart,
): Promise<CreateSessionResult> {
  return createSession(userId, {
    deviceId: input.deviceId,
    durationMin: input.plannedMinutes,
    startedAt: input.startedAt,
    clientSessionId: input.clientSessionId,
    source: input.source,
  });
}

/** The agent's `session.ended` cloud report; null when no matching session exists (never fabricated). */
export interface ReportedSessionEnd {
  clientSessionId: string;
  endedAt: string;
  actualMinutes: number;
  status: TerminalSessionStatus;
  endReason: EndReason;
}

export async function reportSessionEnded(
  userId: string,
  input: ReportedSessionEnd,
): Promise<PublicSession | null> {
  const session = await Session.findOne({
    userId: toObjectId(userId),
    clientSessionId: input.clientSessionId,
  }).select('_id');
  if (session === null) return null;
  return finaliseSession(userId, String(session._id), {
    status: input.status,
    endedAt: input.endedAt,
    actualMinutes: input.actualMinutes,
    endReason: input.endReason,
  });
}
