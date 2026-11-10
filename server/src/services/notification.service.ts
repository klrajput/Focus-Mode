// server/src/services/notification.service.ts — the in-app notification bell API (T-075, FR-025).
// Why: the scheduler/reaper already create notifications (missed scheduled runs, etc.); this module
// exposes them to the owner, newest first, plus the unread count the bell badge needs and a
// mark-as-read action. Every query is owner-scoped, so a foreign notification id behaves exactly
// like a missing one (404, NFR-003).
// Invariants: only the frozen `{id,type,message,readAt,createdAt}` shape leaves the server (no user
// ids/DB internals); marking read is idempotent and keeps the original `readAt`; `unreadCount` is
// over ALL of the user's notifications, not just the current page (additive W5 field, delta C-22).

import { OBJECT_ID_PATTERN, ERROR_CODES, type Paginated } from '@focus-mode/shared';
import { Notification, type NotificationDocument } from '../models/Notification.js';
import { AppError } from '../utils/AppError.js';
import { buildPaginated, pageSkip, type PageLimitQuery } from '../utils/pagination.js';
import { toIsoString } from '../utils/serialize.js';

/** `notification` wire shape (INTEGRATION_CONTRACTS §3.3). */
export interface PublicNotification {
  id: string;
  type: string;
  message: string;
  readAt: string | null;
  createdAt: string | null;
}

/** Paginated notifications plus the bell's unread counter (additive W5 field). */
export interface NotificationPage extends Paginated<PublicNotification> {
  unreadCount: number;
}

interface NotificationLike {
  _id: unknown;
  type: string;
  message: string;
  readAt: Date | null;
  createdAt?: unknown;
}

/** Whitelist + serialise one notification document. */
export function toPublicNotification(notification: NotificationLike): PublicNotification {
  return {
    id: String(notification._id),
    type: notification.type,
    message: notification.message,
    readAt: toIsoString(notification.readAt),
    createdAt: toIsoString(notification.createdAt),
  };
}

/** GET /notifications — newest-first page of the caller's notifications + unread count. */
export async function listNotifications(
  userId: string,
  query: PageLimitQuery,
): Promise<NotificationPage> {
  const filter = { userId };
  const [total, unreadCount, notifications] = await Promise.all([
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId, readAt: null }),
    Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(pageSkip(query.page, query.limit))
      .limit(query.limit)
      .lean(),
  ]);

  return {
    ...buildPaginated(
      notifications.map((notification) => toPublicNotification(notification)),
      query.page,
      query.limit,
      total,
    ),
    unreadCount,
  };
}

/** PATCH /notifications/:id/read — owner-scoped and idempotent (keeps the first readAt). */
export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<PublicNotification> {
  // A malformed id is a 404, not a 500 CastError (contract §1.5: unknown id → NOT_FOUND).
  if (!OBJECT_ID_PATTERN.test(notificationId)) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Notification not found.');
  }
  const notification: NotificationDocument | null = await Notification.findOne({
    _id: notificationId,
    userId,
  });
  if (notification === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Notification not found.');
  }
  if (notification.readAt === null) {
    notification.readAt = new Date();
    await notification.save();
  }
  return toPublicNotification(notification);
}
