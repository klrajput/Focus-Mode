// shared/src/schemas/device.ts — device pairing, attestation and device-list payloads (FR-003,
// FR-026, REC-002, REC-003). The 6-digit code is typed into the dashboard and posted to the cloud
// only; it never crosses the local channel (DEC-003, asserted in protocol.test.ts).
// Strict objects: unknown fields rejected (NFR-013).

import { z } from 'zod';
import {
  agentVersionSchema,
  displayNameSchema,
  nonceSchema,
  objectIdSchema,
  osSchema,
} from './common.js';

/** HMAC-SHA256 output as lowercase/uppercase hex (server pepper derivation owned by T-040). */
export const codeHmacSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, 'codeHmac must be a 64-character hex SHA-256 digest');

/** 6 digits, kept as a string so leading zeros survive. */
export const pairingCodeSchema = z
  .string()
  .regex(/^\d{6}$/, 'Pairing code must be exactly 6 digits');

/** Agent-only enrollment secret delivered back on poll; URL-safe random material. */
export const enrollSecretSchema = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Enroll secret must be 32-128 URL-safe characters');

/** POST /agent/register — TECHNICAL_DESIGN §5.1 step 1. */
export const deviceRegisterSchema = z.strictObject({
  codeHmac: codeHmacSchema,
  os: osSchema,
  name: displayNameSchema,
  agentVersion: agentVersionSchema,
});

/** POST /devices/pair — TECHNICAL_DESIGN §5.1 step 3. */
export const devicePairSchema = z.strictObject({
  code: pairingCodeSchema,
  name: displayNameSchema.optional(),
});

/** POST /devices/:id/attest — the nonce comes from the agent `challenge` message. */
export const attestRequestSchema = z.strictObject({
  nonce: nonceSchema,
});

/** POST /agent/enroll/poll — TECHNICAL_DESIGN §5.1 step 4. */
export const enrollPollSchema = z.strictObject({
  deviceId: objectIdSchema,
  enrollSecret: enrollSecretSchema,
});

export const devicesSortSchema = z.enum([
  'name',
  '-name',
  'lastSeenAt',
  '-lastSeenAt',
  'createdAt',
  '-createdAt',
]);

/** GET /devices list query (NFR-009). */
export const deviceListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: devicesSortSchema.default('-lastSeenAt'),
  search: z.string().trim().min(1).max(100).optional(),
});

export type DeviceRegisterInput = z.infer<typeof deviceRegisterSchema>;
export type DevicePairInput = z.infer<typeof devicePairSchema>;
export type AttestRequestInput = z.infer<typeof attestRequestSchema>;
export type EnrollPollInput = z.infer<typeof enrollPollSchema>;
export type DeviceListQuery = z.infer<typeof deviceListQuerySchema>;
