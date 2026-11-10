// server/src/models/Device.ts — Mongo `devices` collection (TECHNICAL_DESIGN §4, FR-003/FR-026).
// A device row starts life *pending* (`ownerId: null`, only `pairTokenHash`/`enrollSecretHash`
// stored) while the Focus Agent shows its 6-digit code, and becomes paired when the user types
// that code (DEC-014). Token material is never stored in clear: `pairTokenHash` (peppered HMAC),
// `deviceTokenHash` (SHA-256) and `enrollSecretHash` are hashes only (SEC-5/SEC-6). The partial
// unique index on `pairTokenHash` guarantees one pending device per code without forcing paired
// devices to keep a value.

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import type { DeviceStatus, OsName } from '@focus-mode/shared';
import { DEVICE_STATUSES, OS_NAMES } from './enums.js';

/** Agent-reported local capabilities (`hello.capabilities` from TECHNICAL_DESIGN §6.2). */
export interface IDeviceCapabilities {
  focus: 'full' | 'partial' | 'unsupported';
  reasons?: string[];
}

/** Persisted device document; `ownerId` is null only while pairing is pending. */
export interface IDevice {
  ownerId: Types.ObjectId | null;
  name: string;
  os: OsName;
  pairedAt: Date | null;
  lastSeenAt: Date | null;
  status: DeviceStatus;
  /** HMAC-SHA256(PAIR_PEPPER, codeHmac) hex — DEC-014; cleared on successful pairing. */
  pairTokenHash: string | null;
  pairExpiresAt: Date | null;
  /** Failed user attempts for this code; SEC-5 invalidates the code after 5. */
  pairAttempts: number;
  /** SHA-256 of the long-lived device bearer token (SEC-6); never the token itself. */
  deviceTokenHash: string | null;
  /** SHA-256 of the one-time enroll secret the agent keeps (DEC-014 step 2). */
  enrollSecretHash: string | null;
  capabilities: IDeviceCapabilities | null;
  agentVersion: string;
}

export type DeviceDocument = HydratedDocument<IDevice>;

const capabilitiesSchema = new Schema<IDeviceCapabilities>(
  {
    focus: { type: String, enum: ['full', 'partial', 'unsupported'], required: true },
    reasons: { type: [String], default: undefined },
  },
  { _id: false, versionKey: false },
);

/** Pairing-code hash is a SHA-256/HMAC hex digest; the shape is frozen by DEC-014. */
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

const deviceSchema = new Schema<IDevice>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    os: { type: String, enum: [...OS_NAMES], required: true },
    pairedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
    status: {
      type: String,
      enum: [...DEVICE_STATUSES],
      required: true,
      default: 'DISCONNECTED',
    },
    pairTokenHash: { type: String, default: null, match: [SHA256_HEX_PATTERN, 'Invalid hash'] },
    pairExpiresAt: { type: Date, default: null },
    pairAttempts: { type: Number, required: true, default: 0, min: 0 },
    deviceTokenHash: { type: String, default: null },
    enrollSecretHash: { type: String, default: null },
    capabilities: { type: capabilitiesSchema, default: null },
    agentVersion: { type: String, required: true, trim: true, maxlength: 32 },
  },
  { collection: 'devices' },
);

// TECHNICAL_DESIGN §4 indexes: owner lookup plus a partial unique pairing-code digest so a code
// can never point at two pending devices while paired devices (hash cleared/unset) are exempt.
deviceSchema.index({ ownerId: 1 });
deviceSchema.index(
  { pairTokenHash: 1 },
  { unique: true, partialFilterExpression: { pairTokenHash: { $type: 'string' } } },
);
// Token-enrollment lookups (`/agent/enroll/poll` hashes the secret and finds the pending device).
deviceSchema.index(
  { deviceTokenHash: 1 },
  { partialFilterExpression: { deviceTokenHash: { $type: 'string' } } },
);
deviceSchema.index(
  { enrollSecretHash: 1 },
  { partialFilterExpression: { enrollSecretHash: { $type: 'string' } } },
);
// Pending rows expire with their 10-minute code (SEC-5). The partial filter keeps paired devices
// (which no longer carry `pairTokenHash`) out of the TTL sweep entirely.
deviceSchema.index(
  { pairExpiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { pairTokenHash: { $type: 'string' } } },
);

export const Device: Model<IDevice> = model<IDevice>('Device', deviceSchema);
