// server/src/test/sessions.test.ts — T-060 acceptance (FR-010/FR-024/FR-028, REC-006).
// Why: sessions are the analytics source of truth and carry the "one ACTIVE session per device"
// invariant, while the agent and dashboard may both report the same run — so idempotency, the
// ALREADY_FOCUSING conflict and the "actualMinutes never exceed elapsed time" cap are the core
// behaviours to prove. These tests drive the real app + real MongoDB (no service stubs) and assert
// the frozen `session` wire shape from INTEGRATION_CONTRACTS §3.3.
// Invariants asserted: create 201 / replay 200 / mismatched idempotency key 409; second ACTIVE per
// device 409; foreign device or session → 404; finalise idempotent; conflicting finalise → 409;
// actualMinutes capped by elapsed time and rounded to 0.1; owner-scoped filters + pagination + sort.

import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import {
  bearer,
  clearTestDatabase,
  createPairedTestDevice,
  createTestApp,
  registerTestUser,
  startTestDatabase,
  stopTestDatabase,
} from './helpers.js';

const SESSION_FIELDS = [
  'actualMinutes',
  'clientSessionId',
  'deviceId',
  'endedAt',
  'endReason',
  'id',
  'lastHeartbeatAt',
  'plannedMinutes',
  'source',
  'startedAt',
  'status',
];

let app: Express;
let accessToken: string;
let deviceId: string;

interface CreateOverrides {
  deviceId?: string;
  durationMin?: number;
  startedAt?: Date;
  clientSessionId?: string;
  source?: 'MANUAL' | 'SCHEDULE';
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function sessionPayload(overrides: CreateOverrides = {}) {
  return {
    deviceId: overrides.deviceId ?? deviceId,
    durationMin: overrides.durationMin ?? 30,
    startedAt: (overrides.startedAt ?? minutesAgo(5)).toISOString(),
    clientSessionId: overrides.clientSessionId ?? randomUUID(),
    source: overrides.source ?? 'MANUAL',
  };
}

async function createSession(overrides: CreateOverrides = {}) {
  const payload = sessionPayload(overrides);
  const response = await request(app)
    .post('/api/v1/sessions')
    .set(bearer(accessToken))
    .send(payload);
  return { response, payload };
}

function finalisePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: 'COMPLETED',
    endedAt: new Date().toISOString(),
    actualMinutes: 30,
    endReason: 'COMPLETED',
    ...overrides,
  };
}

async function finalise(sessionId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return request(app)
    .patch(`/api/v1/sessions/${sessionId}`)
    .set(bearer(accessToken))
    .send(finalisePayload(overrides));
}

async function adminToken(): Promise<string> {
  await User.create({
    name: 'Admin Test',
    email: 'admin.sessions@demo.com',
    passwordHash: await bcrypt.hash('Admin@123', 12),
    role: 'ADMIN',
  });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin.sessions@demo.com', password: 'Admin@123' });
  return login.body.data.accessToken as string;
}

async function otherUserToken(): Promise<{ token: string; userId: string }> {
  const registration = await registerTestUser(app, { email: 'other.sessions@demo.com' });
  return {
    token: registration.response.body.data.accessToken as string,
    userId: registration.response.body.data.user.id as string,
  };
}

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
  app = createTestApp();
  const registration = await registerTestUser(app);
  accessToken = registration.response.body.data.accessToken as string;
  const paired = await createPairedTestDevice(app, accessToken);
  deviceId = paired.deviceId;
});

describe('POST /api/v1/sessions (contract §3.1 #12, REC-006)', () => {
  it('creates an ACTIVE session (201) with the frozen session shape', async () => {
    const { response, payload } = await createSession();

    expect(response.status).toBe(201);
    const session = response.body.data as Record<string, unknown>;
    expect(Object.keys(session).sort()).toEqual([...SESSION_FIELDS].sort());
    expect(session).toMatchObject({
      deviceId: payload.deviceId,
      clientSessionId: payload.clientSessionId,
      plannedMinutes: 30,
      actualMinutes: 0,
      status: 'ACTIVE',
      source: 'MANUAL',
      endedAt: null,
      endReason: null,
    });
    expect(session.id).toMatch(/^[a-f0-9]{24}$/);
    expect(session.startedAt).toBe(payload.startedAt);
    expect(await Session.countDocuments()).toBe(1);
  });

  it('is idempotent by {userId, clientSessionId}: identical replay returns the same session (200)', async () => {
    const { response: first, payload } = await createSession();
    const replay = await request(app)
      .post('/api/v1/sessions')
      .set(bearer(accessToken))
      .send(payload);

    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(await Session.countDocuments()).toBe(1);
  });

  it('rejects a conflicting replay of the same clientSessionId with 409 CONFLICT', async () => {
    const { payload } = await createSession();

    const conflicting = await request(app)
      .post('/api/v1/sessions')
      .set(bearer(accessToken))
      .send({ ...payload, durationMin: 60 });

    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.code).toBe('CONFLICT');
  });

  it('answers 409 ALREADY_FOCUSING for a second ACTIVE session on the same device (FR-024)', async () => {
    await createSession();
    const second = await createSession();

    expect(second.response.status).toBe(409);
    expect(second.response.body.error.code).toBe('ALREADY_FOCUSING');
    expect(second.response.body.error.message).toBe(
      'This device already has an active focus session.',
    );
    expect(await Session.countDocuments()).toBe(1);
  });

  it('allows a new session on the same device after the first one is finalised', async () => {
    const first = await createSession();
    await finalise(first.response.body.data.id);

    const second = await createSession();

    expect(second.response.status).toBe(201);
    expect(await Session.countDocuments()).toBe(2);
  });

  it('answers 404 for a device owned by another user', async () => {
    const other = await otherUserToken();
    const response = await request(app)
      .post('/api/v1/sessions')
      .set(bearer(other.token))
      .send(sessionPayload());

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a startedAt too far in the future with 400 VALIDATION_ERROR', async () => {
    const { response } = await createSession({
      startedAt: new Date(Date.now() + 10 * 60_000),
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toContainEqual(
      expect.objectContaining({ path: 'startedAt' }),
    );
  });

  it('validates the body with the frozen schema (bad UUID, duration bounds, unknown field)', async () => {
    const badUuid = await request(app)
      .post('/api/v1/sessions')
      .set(bearer(accessToken))
      .send({ ...sessionPayload(), clientSessionId: 'not-a-uuid' });
    const badDuration = await request(app)
      .post('/api/v1/sessions')
      .set(bearer(accessToken))
      .send({ ...sessionPayload(), durationMin: 481 });
    const unknownField = await request(app)
      .post('/api/v1/sessions')
      .set(bearer(accessToken))
      .send({ ...sessionPayload(), status: 'COMPLETED' });

    expect(badUuid.status).toBe(400);
    expect(badDuration.status).toBe(400);
    expect(unknownField.status).toBe(400);
    expect(unknownField.body.error.details).toContainEqual(
      expect.objectContaining({ path: 'status' }),
    );
  });
});

describe('PATCH /api/v1/sessions/:id (contract §3.1 #13)', () => {
  it('finalises once, capping actualMinutes by elapsed time and rounding to 0.1', async () => {
    const { response: created } = await createSession({ startedAt: minutesAgo(20) });
    const sessionId = created.body.data.id as string;
    const endedAt = minutesAgo(10); // exactly 10 minutes of elapsed time

    const response = await finalise(sessionId, {
      endedAt: endedAt.toISOString(),
      actualMinutes: 100, // asks for more than the session actually spanned
      status: 'COMPLETED',
      endReason: 'COMPLETED',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: sessionId,
      status: 'COMPLETED',
      endReason: 'COMPLETED',
      endedAt: endedAt.toISOString(),
      actualMinutes: 10,
    });
  });

  it('rounds fractional actualMinutes down to the nearest 0.1 minute', async () => {
    const { response: created } = await createSession({ startedAt: minutesAgo(20) });
    const response = await finalise(created.body.data.id as string, {
      endedAt: minutesAgo(10).toISOString(),
      actualMinutes: 10.04,
    });

    expect(response.body.data.actualMinutes).toBe(10);
  });

  it('keeps an identical repeat idempotent (200, no double count)', async () => {
    const { response: created } = await createSession({ startedAt: minutesAgo(20) });
    const sessionId = created.body.data.id as string;
    const payload = finalisePayload({
      endedAt: minutesAgo(10).toISOString(),
      actualMinutes: 10,
    });

    const first = await request(app)
      .patch(`/api/v1/sessions/${sessionId}`)
      .set(bearer(accessToken))
      .send(payload);
    const second = await request(app)
      .patch(`/api/v1/sessions/${sessionId}`)
      .set(bearer(accessToken))
      .send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect((await Session.findById(sessionId).lean())?.actualMinutes).toBe(10);
  });

  it('answers 409 CONFLICT when rewriting an already-finalised session with different values', async () => {
    const { response: created } = await createSession({ startedAt: minutesAgo(20) });
    const sessionId = created.body.data.id as string;
    await finalise(sessionId, { endedAt: minutesAgo(10).toISOString(), actualMinutes: 10 });

    const conflicting = await finalise(sessionId, {
      endedAt: minutesAgo(5).toISOString(),
      actualMinutes: 15,
      status: 'CANCELLED',
      endReason: 'USER',
    });

    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.code).toBe('CONFLICT');
  });

  it('cannot reopen a finalised session (ACTIVE is not a terminal status)', async () => {
    const { response: created } = await createSession({ startedAt: minutesAgo(20) });
    const sessionId = created.body.data.id as string;
    await finalise(sessionId, { endedAt: minutesAgo(10).toISOString(), actualMinutes: 10 });

    const reopen = await finalise(sessionId, { status: 'ACTIVE', actualMinutes: 0 });

    expect(reopen.status).toBe(400);
    expect(reopen.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects endedAt before startedAt with 400 VALIDATION_ERROR', async () => {
    const { response: created } = await createSession({ startedAt: minutesAgo(5) });

    const response = await finalise(created.body.data.id as string, {
      endedAt: minutesAgo(10).toISOString(),
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toContainEqual(
      expect.objectContaining({ path: 'endedAt' }),
    );
  });

  it('answers 404 for a session owned by another user', async () => {
    const { response: created } = await createSession();
    const other = await otherUserToken();

    const response = await request(app)
      .patch(`/api/v1/sessions/${created.body.data.id}`)
      .set(bearer(other.token))
      .send(finalisePayload());

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/v1/sessions (contract §3.1 #14, NFR-009)', () => {
  it('returns only the caller’s sessions with the paginated shape', async () => {
    await createSession({ startedAt: minutesAgo(30) });
    const other = await otherUserToken();
    const otherDevice = await createPairedTestDevice(app, other.token);
    await request(app)
      .post('/api/v1/sessions')
      .set(bearer(other.token))
      .send(sessionPayload({ deviceId: otherDevice.deviceId }));

    const response = await request(app).get('/api/v1/sessions').set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].id).toMatch(/^[a-f0-9]{24}$/);
  });

  it('filters by status, source and startedAt range, and paginates', async () => {
    const older = await createSession({ startedAt: minutesAgo(60), source: 'SCHEDULE' });
    await finalise(older.response.body.data.id, {
      endedAt: minutesAgo(30).toISOString(),
      actualMinutes: 30,
      status: 'CANCELLED',
      endReason: 'USER',
    });
    const secondDevice = await createPairedTestDevice(app, accessToken);
    await createSession({ deviceId: secondDevice.deviceId, startedAt: minutesAgo(2) });

    const cancelled = await request(app)
      .get('/api/v1/sessions?status=CANCELLED')
      .set(bearer(accessToken));
    const scheduled = await request(app)
      .get('/api/v1/sessions?source=SCHEDULE')
      .set(bearer(accessToken));
    const recent = await request(app)
      .get(`/api/v1/sessions?from=${minutesAgo(5).toISOString()}`)
      .set(bearer(accessToken));
    const paged = await request(app)
      .get('/api/v1/sessions?page=2&limit=1')
      .set(bearer(accessToken));

    expect(cancelled.body.data.total).toBe(1);
    expect(cancelled.body.data.items[0].status).toBe('CANCELLED');
    expect(scheduled.body.data.total).toBe(1);
    expect(scheduled.body.data.items[0].source).toBe('SCHEDULE');
    expect(recent.body.data.total).toBe(1);
    expect(paged.body.data).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2 });
  });

  it('sorts by the whitelisted sort values', async () => {
    await createSession({ startedAt: minutesAgo(30), durationMin: 25 });
    const secondDevice = await createPairedTestDevice(app, accessToken);
    await createSession({
      deviceId: secondDevice.deviceId,
      startedAt: minutesAgo(10),
      durationMin: 60,
    });

    const ascending = await request(app)
      .get('/api/v1/sessions?sort=startedAt')
      .set(bearer(accessToken));
    const byPlanned = await request(app)
      .get('/api/v1/sessions?sort=-plannedMinutes')
      .set(bearer(accessToken));

    expect(
      ascending.body.data.items.map((item: { plannedMinutes: number }) => item.plannedMinutes),
    ).toEqual([25, 60]);
    expect(byPlanned.body.data.items[0].plannedMinutes).toBe(60);
  });

  it('rejects an inverted date range and a non-whitelisted sort with 400', async () => {
    const inverted = await request(app)
      .get(`/api/v1/sessions?from=${new Date().toISOString()}&to=${minutesAgo(60).toISOString()}`)
      .set(bearer(accessToken));
    const badSort = await request(app)
      .get('/api/v1/sessions?sort=passwordHash')
      .set(bearer(accessToken));

    expect(inverted.status).toBe(400);
    expect(badSort.status).toBe(400);
  });
});

describe('GET /api/v1/sessions/active (dashboard refresh helper)', () => {
  it('returns null when nothing is active and the current ACTIVE session otherwise', async () => {
    const empty = await request(app).get('/api/v1/sessions/active').set(bearer(accessToken));
    expect(empty.status).toBe(200);
    expect(empty.body.data.session).toBeNull();

    const { response } = await createSession();
    const active = await request(app).get('/api/v1/sessions/active').set(bearer(accessToken));

    expect(active.body.data.session.id).toBe(response.body.data.id);
  });
});

describe('authorisation (contract §1.2, USER label)', () => {
  it('requires authentication (401) and rejects ADMIN tokens (403)', async () => {
    const unauthenticated = await request(app).get('/api/v1/sessions');
    expect(unauthenticated.status).toBe(401);

    const asAdmin = await request(app)
      .get('/api/v1/sessions')
      .set(bearer(await adminToken()));
    expect(asAdmin.status).toBe(403);
    expect(asAdmin.body.error.code).toBe('FORBIDDEN');
  });
});
