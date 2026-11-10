// server/src/controllers/notifications.controller.ts — notification bell handlers (T-075, FR-025).
// Why: the dashboard bell needs a newest-first page plus the unread count; opening a notification
// marks it read. Both handlers are owner-scoped in the service (foreign id = 404, NFR-003).
// Invariants: USER-only (contract §3.1 #22–#23 access label); response uses the NFR-009 paginated
// envelope with the additive `unreadCount`; marking read is idempotent.

import type { RequestHandler } from 'express';
import { ERROR_CODES, type ApiSuccess } from '@focus-mode/shared';
import { getAuthenticatedUser } from '../middlewares/auth.js';
import { getValidatedQuery } from '../middlewares/validate.js';
import {
  listNotifications,
  markNotificationRead,
  type NotificationPage,
  type PublicNotification,
} from '../services/notification.service.js';
import { AppError } from '../utils/AppError.js';
import type { PageLimitQuery } from '../utils/pagination.js';

type RouteParams = Record<string, string>;

/** GET /api/v1/notifications — 200 paginated notifications + unreadCount (#22). */
export const list: RequestHandler<RouteParams, ApiSuccess<NotificationPage>> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const query = getValidatedQuery<PageLimitQuery>(res);
  const data = await listNotifications(user.id, query);
  res.status(200).json({ success: true, data });
};

/** PATCH /api/v1/notifications/:id/read — 200 the now-read notification (#23). */
export const markRead: RequestHandler<RouteParams, ApiSuccess<PublicNotification>> = async (
  req,
  res,
) => {
  const user = getAuthenticatedUser(req);
  const notificationId = req.params.id;
  if (notificationId === undefined) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Notification not found.');
  }
  const data = await markNotificationRead(user.id, notificationId);
  res.status(200).json({ success: true, data });
};
