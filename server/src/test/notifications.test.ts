// server/src/test/notifications.test.ts — T-075 acceptance (FR-025, contract §3.1 #22–#23).
// Why: the bell must show the caller's notifications newest-first with an accurate unread badge, and
// opening one must mark it read exactly once. Notifications are created server-side (scheduler) so
// tests insert real documents through the model.
// Invariants asserted: owner scoping (foreign/malformed id → 404 NOT_FOUND, never 403/500);
// pagination envelope + additive `unreadCount` (delta C-22) counted over all pages; marking read is
// idempotent (keeps the first readAt) and decrements unreadCount; USER-only access (401/403).

import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Notification } from '../models/Notification.js';
import {
  bearer,
  clearTestDatabase,
  createDirectUser,
  createTestApp,
  registerTestUser,
  startTestDatabase,
  stopTestDatabase,
  TEST_PASSWORD,
} from './helpers.js';

let app: Express;
let accessToken: string;
let userId: string;

async function createNotification(
  ownerId: string,
  overrides: Partial<{
    type: 'SCHEDULE_MISSED' | 'SCHEDULE_STARTED' | 'DEVICE_DISCONNECTED' | 'SYSTEM';
    message: string;
    readAt: Date | null;
    createdAt: Date;
  }> = {},
) {
  const notification = await Notification.create({
    userId: new Types.ObjectId(ownerId),
    type: overrides.type ?? 'SCHEDULE_MISSED',
    message: overrides.message ?? 'Morning deep work was missed — no Focus Agent was connected.',
    readAt: overrides.readAt ?? null,
  });
  if (overrides.createdAt !== undefined) {
    // Deterministic ordering for assertions (timestamps would otherwise use the same millisecond).
    await Notification.updateOne(
      { _id: notification._id },
      { $set: { createdAt: overrides.createdAt } },
    );
  }
  return notification;
}

async function adminToken(): Promise<string> {
  const email = 'admin.notifications@demo.com';
  await createDirectUser({ email, role: 'ADMIN' });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: TEST_PASSWORD });
  return login.body.data.accessToken as string;
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
  userId = registration.response.body.data.user.id as string;
});

describe('GET /api/v1/notifications (contract §3.1 #22)', () => {
  it('returns the caller’s notifications newest-first with total + unreadCount', async () => {
    const read = await createNotification(userId, {
      message: 'Older, already read',
      readAt: new Date('2026-11-01T10:00:00.000Z'),
      createdAt: new Date('2026-11-01T09:00:00.000Z'),
    });
    const unread = await createNotification(userId, {
      message: 'Newer, unread',
      createdAt: new Date('2026-11-05T09:00:00.000Z'),
    });

    const response = await request(app).get('/api/v1/notifications').set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
      unreadCount: 1,
    });
    expect(response.body.data.items.map((item: { id: string }) => item.id)).toEqual([
      String(unread._id),
      String(read._id),
    ]);
    const item = response.body.data.items[0] as Record<string, unknown>;
    expect(Object.keys(item).sort()).toEqual(['createdAt', 'id', 'message', 'readAt', 'type']);
    expect(item).toMatchObject({ type: 'SCHEDULE_MISSED', readAt: null });
    expect(String(item.createdAt)).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('paginates with page/limit and keeps unreadCount global (not page-scoped)', async () => {
    await createNotification(userId, { createdAt: new Date('2026-11-03T09:00:00.000Z') });
    await createNotification(userId, { createdAt: new Date('2026-11-04T09:00:00.000Z') });
    await createNotification(userId, { createdAt: new Date('2026-11-05T09:00:00.000Z') });

    const pageTwo = await request(app)
      .get('/api/v1/notifications?page=2&limit=1')
      .set(bearer(accessToken));

    expect(pageTwo.status).toBe(200);
    expect(pageTwo.body.data).toMatchObject({
      page: 2,
      limit: 1,
      total: 3,
      totalPages: 3,
      unreadCount: 3,
    });
    expect(pageTwo.body.data.items).toHaveLength(1);
  });

  it('never lists another user’s notifications', async () => {
    const other = await createDirectUser();
    await createNotification(String(other._id));

    const response = await request(app).get('/api/v1/notifications').set(bearer(accessToken));

    expect(response.body.data.total).toBe(0);
    expect(response.body.data.items).toEqual([]);
  });

  it('requires authentication (401) and rejects ADMIN tokens (403)', async () => {
    const unauthenticated = await request(app).get('/api/v1/notifications');
    const asAdmin = await request(app)
      .get('/api/v1/notifications')
      .set(bearer(await adminToken()));

    expect(unauthenticated.status).toBe(401);
    expect(asAdmin.status).toBe(403);
    expect(asAdmin.body.error.code).toBe('FORBIDDEN');
  });
});

describe('PATCH /api/v1/notifications/:id/read (contract §3.1 #23)', () => {
  it('marks the notification read once (idempotent, first readAt kept) and decrements unreadCount', async () => {
    const notification = await createNotification(userId);

    const first = await request(app)
      .patch(`/api/v1/notifications/${notification._id}/read`)
      .set(bearer(accessToken));
    const second = await request(app)
      .patch(`/api/v1/notifications/${notification._id}/read`)
      .set(bearer(accessToken));

    expect(first.status).toBe(200);
    expect(first.body.data.id).toBe(String(notification._id));
    expect(String(first.body.data.readAt)).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(second.status).toBe(200);
    expect(second.body.data.readAt).toBe(first.body.data.readAt);

    const list = await request(app).get('/api/v1/notifications').set(bearer(accessToken));
    expect(list.body.data.unreadCount).toBe(0);
  });

  it('answers 404 for another user’s notification and for a malformed id', async () => {
    const other = await createDirectUser();
    const foreign = await createNotification(String(other._id));

    const foreignResponse = await request(app)
      .patch(`/api/v1/notifications/${foreign._id}/read`)
      .set(bearer(accessToken));
    const malformed = await request(app)
      .patch('/api/v1/notifications/not-an-object-id/read')
      .set(bearer(accessToken));

    expect(foreignResponse.status).toBe(404);
    expect(foreignResponse.body.error.code).toBe('NOT_FOUND');
    expect(malformed.status).toBe(404);
    expect(malformed.body.error.code).toBe('NOT_FOUND');
  });

  it('requires authentication (401) and rejects ADMIN tokens (403)', async () => {
    const notification = await createNotification(userId);

    const unauthenticated = await request(app).patch(
      `/api/v1/notifications/${notification._id}/read`,
    );
    const asAdmin = await request(app)
      .patch(`/api/v1/notifications/${notification._id}/read`)
      .set(bearer(await adminToken()));

    expect(unauthenticated.status).toBe(401);
    expect(asAdmin.status).toBe(403);
  });
});
