// server/src/test/schedules.test.ts — T-062 acceptance (FR-012, REQUIREMENTS §7).
// Why: schedules are durable user-owned plans that W4's scheduler will fire from the user's timezone;
// this slice must persist them with exact validation and never execute or fake a run (T-063 is W4).
// Invariants asserted: create 201 with the frozen `schedule` shape; validation matrix (days subset,
// HH:mm, duration bounds, name bounds, strict objects); owner-scoped list sorted by startTime with
// pagination; partial update; delete returns `{id}`; every cross-user id is 404 (NFR-003).

import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { User } from '../models/User.js';
import {
  bearer,
  clearTestDatabase,
  createTestApp,
  registerTestUser,
  startTestDatabase,
  stopTestDatabase,
} from './helpers.js';

const SCHEDULE_FIELDS = [
  'createdAt',
  'days',
  'durationMin',
  'enabled',
  'id',
  'lastRunAt',
  'name',
  'startTime',
];

let app: Express;
let accessToken: string;

function schedulePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Morning deep work',
    days: [1, 2, 3, 4, 5],
    startTime: '09:00',
    durationMin: 50,
    enabled: true,
    ...overrides,
  };
}

async function createSchedule(overrides: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/schedules')
    .set(bearer(accessToken))
    .send(schedulePayload(overrides));
}

async function otherUserToken(): Promise<string> {
  const registration = await registerTestUser(app, { email: 'other.schedules@demo.com' });
  return registration.response.body.data.accessToken as string;
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
});

describe('POST /api/v1/schedules (contract §3.1 #18)', () => {
  it('creates a schedule (201) with the frozen shape and no fake run', async () => {
    const response = await createSchedule({ days: [3, 1] });

    expect(response.status).toBe(201);
    const schedule = response.body.data as Record<string, unknown>;
    expect(Object.keys(schedule).sort()).toEqual([...SCHEDULE_FIELDS].sort());
    expect(schedule).toMatchObject({
      name: 'Morning deep work',
      days: [1, 3],
      startTime: '09:00',
      durationMin: 50,
      enabled: true,
      lastRunAt: null,
    });
    expect(schedule.id).toMatch(/^[a-f0-9]{24}$/);
    expect(typeof schedule.createdAt).toBe('string');
  });

  it('defaults enabled to true when omitted', async () => {
    const response = await request(app)
      .post('/api/v1/schedules')
      .set(bearer(accessToken))
      .send({ name: 'Evening review', days: [0], startTime: '20:30', durationMin: 25 });

    expect(response.status).toBe(201);
    expect(response.body.data.enabled).toBe(true);
  });

  it('rejects the validation matrix from the frozen schema', async () => {
    const invalidPages = [
      { days: [] },
      { days: [1, 1] },
      { days: [7] },
      { startTime: '9:00' },
      { startTime: '24:00' },
      { durationMin: 0 },
      { durationMin: 481 },
      { name: 'A' },
      { hacker: true },
      { enabled: 'yes' },
    ];

    for (const overrides of invalidPages) {
      const response = await createSchedule(overrides);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('GET /api/v1/schedules (contract §3.1 #17)', () => {
  it('lists only the caller’s schedules, ordered by startTime, with pagination', async () => {
    await createSchedule({ name: 'Late block', startTime: '18:00' });
    await createSchedule({ name: 'Early block', startTime: '07:30' });
    const other = await otherUserToken();
    await request(app).post('/api/v1/schedules').set(bearer(other)).send(schedulePayload());

    const response = await request(app).get('/api/v1/schedules').set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
    expect(response.body.data.items.map((item: { startTime: string }) => item.startTime)).toEqual([
      '07:30',
      '18:00',
    ]);

    const paged = await request(app)
      .get('/api/v1/schedules?page=2&limit=1')
      .set(bearer(accessToken));
    expect(paged.body.data).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2 });
  });

  it('rejects out-of-range pagination and unknown query params', async () => {
    const badLimit = await request(app).get('/api/v1/schedules?limit=101').set(bearer(accessToken));
    const unknownQuery = await request(app)
      .get('/api/v1/schedules?sort=createdAt')
      .set(bearer(accessToken));

    expect(badLimit.status).toBe(400);
    expect(unknownQuery.status).toBe(400);
  });
});

describe('PATCH /api/v1/schedules/:id (contract §3.1 #19)', () => {
  it('updates a subset of fields and leaves the rest untouched', async () => {
    const created = await createSchedule();
    const scheduleId = created.body.data.id as string;

    const response = await request(app)
      .patch(`/api/v1/schedules/${scheduleId}`)
      .set(bearer(accessToken))
      .send({ enabled: false, durationMin: 25 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: scheduleId,
      name: 'Morning deep work',
      days: [1, 2, 3, 4, 5],
      startTime: '09:00',
      durationMin: 25,
      enabled: false,
    });
  });

  it('rejects an empty update and non-whitelisted fields (lastRunAt is scheduler-owned)', async () => {
    const created = await createSchedule();
    const scheduleId = created.body.data.id as string;

    const empty = await request(app)
      .patch(`/api/v1/schedules/${scheduleId}`)
      .set(bearer(accessToken))
      .send({});
    const runAt = await request(app)
      .patch(`/api/v1/schedules/${scheduleId}`)
      .set(bearer(accessToken))
      .send({ lastRunAt: new Date().toISOString() });

    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    expect(runAt.status).toBe(400);
    expect(runAt.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 404 for a schedule owned by another user', async () => {
    const created = await createSchedule();
    const other = await otherUserToken();

    const response = await request(app)
      .patch(`/api/v1/schedules/${created.body.data.id}`)
      .set(bearer(other))
      .send({ enabled: false });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /api/v1/schedules/:id (contract §3.1 #20)', () => {
  it('deletes the caller’s schedule and returns the frozen {id} payload', async () => {
    const created = await createSchedule();
    const scheduleId = created.body.data.id as string;

    const response = await request(app)
      .delete(`/api/v1/schedules/${scheduleId}`)
      .set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { id: scheduleId } });

    const afterDelete = await request(app).get('/api/v1/schedules').set(bearer(accessToken));
    expect(afterDelete.body.data.total).toBe(0);
  });

  it('answers 404 on a second delete and for a foreign schedule', async () => {
    const created = await createSchedule();
    const scheduleId = created.body.data.id as string;
    const other = await otherUserToken();

    const foreign = await request(app).delete(`/api/v1/schedules/${scheduleId}`).set(bearer(other));
    await request(app).delete(`/api/v1/schedules/${scheduleId}`).set(bearer(accessToken));
    const second = await request(app)
      .delete(`/api/v1/schedules/${scheduleId}`)
      .set(bearer(accessToken));

    expect(foreign.status).toBe(404);
    expect(second.status).toBe(404);
  });
});

describe('authorisation (contract §1.2, USER label)', () => {
  it('requires authentication (401) and rejects ADMIN tokens (403)', async () => {
    const unauthenticated = await request(app).get('/api/v1/schedules');
    expect(unauthenticated.status).toBe(401);

    await User.create({
      name: 'Admin Test',
      email: 'admin.schedules@demo.com',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin.schedules@demo.com', password: 'Admin@123' });
    const asAdmin = await request(app)
      .get('/api/v1/schedules')
      .set(bearer(login.body.data.accessToken as string));

    expect(asAdmin.status).toBe(403);
    expect(asAdmin.body.error.code).toBe('FORBIDDEN');
  });
});
