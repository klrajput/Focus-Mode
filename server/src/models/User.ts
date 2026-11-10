// server/src/models/User.ts — Mongo `users` collection (TECHNICAL_DESIGN §4, FR-001).
// One account owns devices, sessions, one allow-list and schedules; `role` is the sole source of
// admin authorisation and is never accepted from a request body (FR-019). `passwordHash` is
// bcrypt(cost 12) and `select: false`, so it cannot leak into an API response by accident — login
// must ask for it explicitly with `.select('+passwordHash')` (SEC-1).

import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import type { Role } from '@focus-mode/shared';
import { ROLES } from './enums.js';

/** Persisted user document (public shape is built by A5's controllers, never raw). */
export interface IUser {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  /** PDF default focus duration in minutes (1–480). */
  defaultDurationMin: number;
  /** IANA time zone used by insights/scheduler day boundaries (REQUIREMENTS §6). */
  timezone: string;
  isActive: boolean;
  /** Last successful login; `null` until the first one (admin list column). */
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [EMAIL_PATTERN, 'Invalid email address'],
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: [...ROLES], required: true, default: 'USER' },
    defaultDurationMin: {
      type: Number,
      required: true,
      default: 60,
      min: 1,
      max: 480,
      validate: {
        validator: (value: number) => Number.isInteger(value),
        message: 'defaultDurationMin must be an integer',
      },
    },
    timezone: { type: String, required: true, trim: true, default: 'UTC', maxlength: 64 },
    isActive: { type: Boolean, required: true, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { collection: 'users', timestamps: true },
);

// FR-001: one account per email; MongoDB enforces it, the register handler only maps the 11000.
userSchema.index({ email: 1 }, { unique: true });

export const User: Model<IUser> = model<IUser>('User', userSchema);
