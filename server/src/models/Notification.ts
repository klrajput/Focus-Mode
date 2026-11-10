// server/src/models/Notification.ts — Mongo `notifications` collection (REC addition,
// TECHNICAL_DESIGN §4; FR-012/FR-017). In-app alerts for the dashboard bell: a missed scheduled
// run, a device that dropped off, or a system message. `readAt` is null until the user opens it
// (PATCH /notifications/:id/read). The `{userId, createdAt:-1}` index serves the newest-first list;
// messages are plain strings with no window titles/URLs (INV-6) and no secrets (NFR-016).

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import { NOTIFICATION_TYPES, type NotificationType } from './enums.js';

/** Persisted in-app notification. */
export interface INotification {
  userId: Types.ObjectId;
  type: NotificationType;
  /** Human-readable, no PII beyond the user's own app/schedule names (NFR-013). */
  message: string;
  /** When the user read it; null = unread. */
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationDocument = HydratedDocument<INotification>;

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: [...NOTIFICATION_TYPES], required: true },
    message: { type: String, required: true, trim: true, minlength: 1, maxlength: 500 },
    readAt: { type: Date, default: null },
  },
  { collection: 'notifications', timestamps: true },
);

// TECHNICAL_DESIGN §4: newest-first per user (GET /notifications).
notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification: Model<INotification> = model<INotification>(
  'Notification',
  notificationSchema,
);
