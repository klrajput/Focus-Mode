// cloud/register.ts — pairing-code pre-registration with the cloud (T-042, DEC-014, REC-002).
// The 6-digit code is generated locally (pairing.ts) and never leaves this machine: only its
// domain-separated SHA-256 digest `sha256("focus-mode-pair-v1|" + code)` (lowercase hex) is POSTed
// to `/agent/register`, which is why a database leak without the server pepper cannot brute-force
// the code. Nothing here logs the plaintext code or the enroll secret.

import { createHash } from 'node:crypto';
import {
  deviceRegisterSchema,
  displayNameSchema,
  enrollSecretSchema,
  objectIdSchema,
  type OsName,
} from '@focus-mode/shared';
import { z } from 'zod';
import { noopLogger, type Logger } from '../log.js';
import {
  apiUrl,
  CloudApiError,
  postJson,
  readSuccessEnvelope,
  type CloudHttpResponse,
} from './transport.js';

/** DEC-014 domain separation: the same 6 digits always map to the same digest. */
export const PAIRING_DIGEST_DOMAIN = 'focus-mode-pair-v1|';
export const AGENT_REGISTER_PATH = '/agent/register';

/** Raised on `409 CONFLICT`, when another pending device already registered this digest. */
export class PairingCodeCollisionError extends Error {
  constructor(message = 'Another pending device already uses this pairing code digest') {
    super(message);
    this.name = 'PairingCodeCollisionError';
  }
}

/** `POST /agent/register` response data (hand-typed until contracts-v1.1 adds response schemas). */
const registrationDataSchema = z.strictObject({
  deviceId: objectIdSchema,
  enrollSecret: enrollSecretSchema,
});

export interface DeviceRegistration {
  readonly deviceId: string;
  readonly enrollSecret: string;
}

/** DEC-014 digest — 64-char lowercase SHA-256 hex of `"focus-mode-pair-v1|" + code`. */
export function computePairingCodeDigest(code: string): string {
  return createHash('sha256')
    .update(PAIRING_DIGEST_DOMAIN + code, 'utf8')
    .digest('hex');
}

/**
 * Device display name sent to the cloud (contract C-06: the machine hostname). Hostnames can be
 * shorter than 2 or longer than 60 characters, so they are normalised to the shared bounds and a
 * neutral fallback is used instead of failing registration.
 */
export function deviceNameFromHostname(hostname: string): string {
  const collapsed = hostname.trim().replace(/\s+/g, ' ');
  if (collapsed.length < 2) return 'Focus Agent';
  return collapsed.slice(0, 60);
}

export interface RegisterDeviceOptions {
  readonly baseUrl: string;
  /** Plaintext code from pairing.ts — hashed immediately and never logged. */
  readonly code: string;
  readonly os: OsName;
  readonly name: string;
  readonly agentVersion: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly logger?: Logger;
}

/**
 * POST /agent/register → `{deviceId, enrollSecret}` (201). Throws `PairingCodeCollisionError`
 * for `409` so the caller can rotate the code, `CloudApiError` for other HTTP failures and
 * `CloudNetworkError` when the API is unreachable (both retryable).
 */
export async function registerDevice(options: RegisterDeviceOptions): Promise<DeviceRegistration> {
  const logger = options.logger ?? noopLogger;
  const body = deviceRegisterSchema.parse({
    codeHmac: computePairingCodeDigest(options.code),
    os: options.os,
    name: displayNameSchema.parse(options.name),
    agentVersion: options.agentVersion,
  });

  const response: CloudHttpResponse = await postJson({
    url: apiUrl(options.baseUrl, AGENT_REGISTER_PATH),
    body,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });

  if (response.status === 409) {
    throw new PairingCodeCollisionError();
  }

  const data = readSuccessEnvelope(response, AGENT_REGISTER_PATH);
  const parsed = registrationDataSchema.safeParse(data);
  if (!parsed.success) {
    throw new CloudApiError(
      response.status,
      undefined,
      'Agent registration returned an unexpected payload',
    );
  }
  // Log the assigned device id only — the digest, code and enroll secret are never logged.
  logger.debug('Pairing digest registered with the cloud', { deviceId: parsed.data.deviceId });
  return { deviceId: parsed.data.deviceId, enrollSecret: parsed.data.enrollSecret };
}
