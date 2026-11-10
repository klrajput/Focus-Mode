// server/src/test/w6-followup-hardening.test.ts — task-38 follow-up fixes from A9's W6 review.
// Why: A9's independent attack on the running stack found no Critical/High but three Mediums whose
// root causes are tested here against the real app + a real MongoDB:
//   F-02 deep-JSON call-stack exhaustion (unauthenticated 500) → iterative operator walk,
//   F-03 deactivated accounts keeping device credentials / session reporting / scheduled focus,
//   F-01 malformed ObjectId path params must be 404 (re-confirmed on the merged W6 tree),
//   F-06 `/agent/enroll/poll` carries the public rate limiter.
// Invariants asserted: adversarial nesting depth (4k/12k/20k) is always a 400 envelope — never a
// 500; ~50-deep legitimate payloads still get normal validation; a deactivated account loses device
// tokens (403 ACCOUNT_DISABLED), cannot persist agent-reported sessions, and gets no scheduleDue /
// no MISSED noise; admin deactivation revokes the target's devices; malformed ids never 500.

import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { runSchedulerTick } from '../cron/scheduler.js';
import { Device } from '../models/Device.js';
import { Notification } from '../models/Notification.js';
import { Schedule } from '../models/Schedule.js';
import { ScheduleRun } from '../models/ScheduleRun.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { reportSessionStarted } from '../services/session.service.js';
import {
  bearer,
  clearTestDatabase,
  createDirectUser,
  createPairedTestDevice,
  createTestApp,
  createTestDevice,
  createTestSchedule,
  registerTestUser,
  startTestDatabase,
  stopTestDatabase,
  TEST_PASSWORD,
} from './helpers.js';

// The unpair-all/deactivation hooks push `revoked` through the hub; mock it so no socket is needed
// and the calls can be asserted. Extra no-ops keep the mocked module shape compatible with scheduler
// default imports (tests pass explicit deps).
vi.mock('../realtime/agentHub.js', () => ({
  revokeDevice: vi.fn(async () => true),
  isDeviceConnected: vi.fn(() => false),
  sendScheduleDue: vi.fn(() => false),
  getPresence: vi.fn(() => null),
}));
import { revokeDevice } from '../realtime/agentHub.js';

const TEST_NONCE = 'nonce-0123456789abcdef';
const NOW = new Date('2026-11-10T03:30:00.000Z'); // Tuesday 09:00 Asia/Kolkata

let app: Express;
let accessToken: string;
let userId: string;

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Independent local-time formatter (the scheduler's implementation is not used as its own oracle). */
function localParts(instant: Date, timeZone: string): { day: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return { day: WEEKDAY_INDEX[get('weekday')] ?? 0, time: `${get('hour')}:${get('minute')}` };
}

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password });
  return response.body.data?.accessToken as string;
}

async function adminToken(): Promise<string> {
  const email = 'admin.followup@demo.com';
  await createDirectUser({ email, role: 'ADMIN' });
  return login(email, TEST_PASSWORD);
}

function jsonRequest(payload: string) {
  return request(app)
    .post('/api/v1/auth/login')
    .set('Content-Type', 'application/json')
    .send(payload);
}

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
  vi.mocked(revokeDevice).mockClear();
  app = createTestApp();
  const registration = await registerTestUser(app);
  accessToken = registration.response.body.data.accessToken as string;
  userId = registration.response.body.data.user.id as string;
});

// ---------------------------------------------------------------------------
// F-02 — deep JSON must never exhaust the call stack (A9 Medium)
// ---------------------------------------------------------------------------
describe('F-02 deep JSON is rejected, never a 500 (iterative operator walk)', () => {
  const deepArray = (depth: number): string => `${'['.repeat(depth)}"x"${']'.repeat(depth)}`;
  const deepObject = (depth: number): string => `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;

  it('rejects 4k/12k/20k-deep arrays and 4k/8k-deep objects with 400 VALIDATION_ERROR', async () => {
    const payloads = [
      deepArray(4_000),
      deepArray(12_000),
      deepArray(20_000),
      deepObject(4_000),
      deepObject(8_000),
    ];

    for (const payload of payloads) {
      expect(payload.length).toBeLessThan(100 * 1024); // still inside the body limit (so it reaches the walk)
      const response = await jsonRequest(payload);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(response.body)).not.toContain('Maximum call stack');
      expect(JSON.stringify(response.body)).not.toContain('stack');
      expect(response.headers['content-type']).toContain('application/json');
    }
  });

  it('finds an operator hidden below 4k levels of nesting (iterative, not recursive)', async () => {
    const payload = `${'{"a":'.repeat(4_000)}{"$where":1}${'}'.repeat(4_000)}`;

    const response = await jsonRequest(payload);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Request contains forbidden keys');
    expect(JSON.stringify(response.body.error.details).length).toBeGreaterThan(1_000);
  });

  it('still validates a legitimately deep-ish (50 levels) payload normally', async () => {
    let nested: Record<string, unknown> = { value: 'ok' };
    for (let level = 0; level < 50; level += 1) nested = { nested };

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'kabir@demo.com', password: 'Kabir@123', extra: nested });

    expect(response.status).toBe(400); // strict schema rejects the unknown field…
    expect(response.body.error.code).toBe('VALIDATION_ERROR'); // …normally, not with a 500
    expect(response.body.error.details).toContainEqual(expect.objectContaining({ path: 'extra' }));
  });

  it('keeps shallow operator rejection as before (regression)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password: 'anything' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Request contains forbidden keys');
  });
});

// ---------------------------------------------------------------------------
// F-01 — malformed ObjectIds are 404 on the merged W6 tree (A9 re-confirmation)
// ---------------------------------------------------------------------------
describe('F-01 malformed ObjectId path params are 404, not 500', () => {
  it('returns 404 NOT_FOUND for the four A9 routes with `not-an-objectid`', async () => {
    const requests = [
      request(app).delete('/api/v1/devices/not-an-objectid').set(bearer(accessToken)),
      request(app)
        .post('/api/v1/devices/not-an-objectid/attest')
        .set(bearer(accessToken))
        .send({ nonce: TEST_NONCE }),
      request(app).patch('/api/v1/sessions/not-an-objectid').set(bearer(accessToken)).send({
        status: 'COMPLETED',
        endedAt: new Date().toISOString(),
        actualMinutes: 1,
        endReason: 'COMPLETED',
      }),
      request(app).post('/api/v1/allowlist/preset/not-an-objectid').set(bearer(accessToken)),
    ];

    for (const pending of requests) {
      const response = await pending;
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(JSON.stringify(response.body)).not.toContain('CastError');
      expect(JSON.stringify(response.body)).not.toContain('stack');
    }
  });
});

// ---------------------------------------------------------------------------
// F-03a — deactivated owner loses device-token access
// ---------------------------------------------------------------------------
describe('F-03a device-token auth re-checks the owner isActive', () => {
  it('answers 403 ACCOUNT_DISABLED for a valid device token of a deactivated account', async () => {
    const paired = await createPairedTestDevice(app, accessToken);
    const before = await request(app)
      .get('/api/v1/agent/allowlist')
      .set(bearer(paired.deviceToken));
    expect(before.status).toBe(200);

    await User.updateOne({ _id: userId }, { $set: { isActive: false } });

    const after = await request(app).get('/api/v1/agent/allowlist').set(bearer(paired.deviceToken));

    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe('ACCOUNT_DISABLED');
    expect(after.body.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// F-03b — deactivated owner cannot persist agent-reported sessions
// ---------------------------------------------------------------------------
describe('F-03b agent session reports are refused for a deactivated owner', () => {
  it('throws ACCOUNT_DISABLED and persists nothing', async () => {
    const paired = await createPairedTestDevice(app, accessToken);
    await User.updateOne({ _id: userId }, { $set: { isActive: false } });

    await expect(
      reportSessionStarted(userId, {
        deviceId: paired.deviceId,
        clientSessionId: randomUUID(),
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        plannedMinutes: 25,
        source: 'MANUAL',
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED', status: 403 });
    expect(await Session.countDocuments()).toBe(0);
  });

  it('control: an active owner still gets the session persisted (dashboard-closed FR-027)', async () => {
    const paired = await createPairedTestDevice(app, accessToken);
    const clientSessionId = randomUUID();

    const result = await reportSessionStarted(userId, {
      deviceId: paired.deviceId,
      clientSessionId,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      plannedMinutes: 25,
      source: 'MANUAL',
    });

    expect(result.created).toBe(true);
    expect(await Session.countDocuments({ clientSessionId })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F-03c — scheduler skips inactive users (no dispatch, no MISSED spam)
// ---------------------------------------------------------------------------
describe('F-03c scheduler ignores schedules of deactivated users', () => {
  it('does not dispatch, record a run/notification or claim lastRunAt for an inactive owner', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata', isActive: false });
    const local = localParts(NOW, 'Asia/Kolkata');
    const schedule = await createTestSchedule({
      userId: user._id,
      days: [local.day],
      startTime: local.time,
    });
    await createTestDevice({ ownerId: user._id });
    const sends: unknown[] = [];

    const result = await runSchedulerTick({
      now: () => NOW,
      isDeviceConnected: () => true,
      sendScheduleDue: (_deviceId, payload) => {
        sends.push(payload);
        return true;
      },
      getAllowlistVersion: async () => 1,
    });

    expect(result).toEqual({ due: 0, dispatched: 0, missed: 0 });
    expect(sends).toHaveLength(0);
    expect(await ScheduleRun.countDocuments()).toBe(0);
    expect(await Notification.countDocuments()).toBe(0);
    expect((await Schedule.findById(schedule._id).lean())?.lastRunAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F-03d — admin deactivation revokes the account's devices
// ---------------------------------------------------------------------------
describe('F-03d admin deactivation revokes device credentials', () => {
  it('deletes the target’s devices, pushes revoked and blocks the target login', async () => {
    const admin = await adminToken();
    const targetEmail = 'deactivated.target@demo.com';
    const target = await createDirectUser({ email: targetEmail });
    const first = await createTestDevice({ ownerId: target._id, name: 'Target Mac A' });
    const second = await createTestDevice({ ownerId: target._id, name: 'Target Mac B' });

    const response = await request(app)
      .patch(`/api/v1/admin/users/${String(target._id)}`)
      .set(bearer(admin))
      .send({ isActive: false });

    expect(response.status).toBe(200);
    expect(response.body.data.isActive).toBe(false);
    expect(vi.mocked(revokeDevice)).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(revokeDevice)
        .mock.calls.map(([deviceId]) => deviceId)
        .sort(),
    ).toEqual([first.deviceId, second.deviceId].sort());
    expect(await Device.countDocuments({ ownerId: target._id })).toBe(0);

    const targetLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: targetEmail, password: TEST_PASSWORD });
    expect(targetLogin.status).toBe(403);
    expect(targetLogin.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('does not revoke devices when the admin only renames or reactivates a user', async () => {
    const admin = await adminToken();
    const target = await createDirectUser({ email: 'renamed.target@demo.com' });
    const device = await createTestDevice({ ownerId: target._id });

    const response = await request(app)
      .patch(`/api/v1/admin/users/${String(target._id)}`)
      .set(bearer(admin))
      .send({ name: 'Renamed Target', isActive: true });

    expect(response.status).toBe(200);
    expect(vi.mocked(revokeDevice)).not.toHaveBeenCalled();
    expect(await Device.findById(device.deviceId)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F-06 — `/agent/enroll/poll` is behind the public rate limiter (Low, re-confirmed)
// ---------------------------------------------------------------------------
describe('F-06 /agent/enroll/poll rate limiter', () => {
  it('serves the RateLimit headers on the poll route', async () => {
    const response = await request(app)
      .post('/api/v1/agent/enroll/poll')
      .send({
        deviceId: new Types.ObjectId().toHexString(),
        enrollSecret: 'x'.repeat(43),
      });

    // Unknown-but-well-formed enrollment → 404 NOT_FOUND; the point here is that the limiter ran.
    expect(response.status).toBe(404);
    const policy = response.headers['ratelimit-policy'] ?? response.headers['ratelimit'];
    expect(policy).toBeDefined();
  });
});
