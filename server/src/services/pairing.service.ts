// server/src/services/pairing.service.ts — the REC-002 three-step pairing flow (T-040):
// agent pre-registers a code digest → user posts the typed code → agent polls once for its token.
// Why: the cloud must verify a code it never sees in plaintext while only hashes are stored. DEC-014
// fixes the two-stage derivation (agent SHA-256("focus-mode-pair-v1|"+code), server HMAC-SHA256
// with PAIR_PEPPER); the plaintext code never crosses the local channel and the device token is
// delivered exactly once, to the agent, never to the browser.
// Invariants: only hashes at rest (SEC-5/SEC-6); a pending code lives 10 min and is single-use;
// failed guesses are bounded (5 attempts per authenticated user then 410 for the rest of the TTL
// window — see comment on the attempt latch); a device token is only minted for an owner-bound
// device after the agent proves possession of its enroll secret; pairing is race-safe via atomic
// conditional updates, not read-then-write.

import { Types } from 'mongoose';
import {
  ERROR_CODES,
  type DevicePairInput,
  type DeviceRegisterInput,
  type EnrollPollInput,
} from '@focus-mode/shared';
import { env } from '../config/env.js';
import { Device } from '../models/Device.js';
import { AppError } from '../utils/AppError.js';
import {
  computePairTokenHash,
  computePairingCodeHmac,
  randomToken,
  safeEqualHex,
  sha256Hex,
} from '../utils/crypto.js';
import { isDuplicateKeyError } from '../utils/mongo-errors.js';
import { ensureAllowlistForUser, getAllowlistVersion } from './allowlist.service.js';
import { toPublicDevice, type PublicDevice } from './device.service.js';

/** SEC-5/DEC-014: a pending pairing code lives for 10 minutes. */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
/** SEC-5: a user gets 5 failed pairing guesses; the 6th invalidates pairing for the TTL window. */
export const PAIR_ATTEMPT_LIMIT = 5;
/** The attempt latch lives as long as the code it protects. */
const PAIR_ATTEMPT_WINDOW_MS = PAIRING_CODE_TTL_MS;

// User-facing messages are generic: they never reveal whether a code exists (no enumeration).
const CODE_TAKEN_MESSAGE =
  'That pairing code is already registered. The Focus Agent will show a new code.';
const INVALID_CODE_MESSAGE =
  'That pairing code is wrong or has expired. Check the 6 digits in your Focus Agent and try again.';
const CODE_EXPIRED_MESSAGE =
  'This pairing code expired. Your Focus Agent is showing a new code — enter that one.';
const ENROLLMENT_CONSUMED_MESSAGE =
  'This enrollment was already completed. Re-pair the device to receive a new token.';
const UNKNOWN_ENROLLMENT_MESSAGE = 'Unknown device or enrollment secret.';

export interface RegisterAgentResult {
  deviceId: string;
  enrollSecret: string;
}

export interface PairDeviceResult {
  device: PublicDevice;
}

export interface EnrollPollResult {
  deviceToken: string;
  userId: string;
  allowListVersion: number;
}

/**
 * Failed-attempt state for the pairing latch.
 *
 * Why per user and not per pending device: `/devices/pair` looks the pending device up *by* the
 * peppered digest of the typed code, so a wrong 6-digit guess cannot be attributed to any specific
 * pending device (the server never holds the plaintext code list). SEC-5's "≤5 attempts per code"
 * is therefore enforced as "≤5 failed guesses per authenticated user within the code TTL window";
 * the 6th attempt latches pairing for that user until the window expires, which is the observable
 * "the code is now permanently invalid" behaviour the contract describes (INTEGRATION_CONTRACTS
 * §1.9: 6th → 410 PAIRING_EXPIRED). Residual risk (documented for the W6 security review): a fresh
 * account can retry, bounded by the 10/min/user and 5/min/IP register rate limits plus the 10-min
 * code TTL. Single API instance assumption (TECHNICAL_DESIGN §8) — a scaled deployment would move
 * this map to a shared store.
 */
interface PairingAttemptState {
  failures: number;
  expiresAtMs: number;
}

const pairingAttempts = new Map<string, PairingAttemptState>();

function activeAttemptState(userId: string): PairingAttemptState | null {
  const state = pairingAttempts.get(userId);
  if (state === undefined) return null;
  if (state.expiresAtMs <= Date.now()) {
    pairingAttempts.delete(userId);
    return null;
  }
  return state;
}

/** 410 once the user has exhausted the 5 allowed guesses for the current TTL window. */
function assertPairingNotLatched(userId: string): void {
  const state = activeAttemptState(userId);
  if (state !== null && state.failures >= PAIR_ATTEMPT_LIMIT) {
    throw new AppError(ERROR_CODES.PAIRING_EXPIRED, CODE_EXPIRED_MESSAGE);
  }
}

function recordFailedPairingAttempt(userId: string): void {
  const current = activeAttemptState(userId);
  const state: PairingAttemptState = current ?? {
    failures: 0,
    expiresAtMs: Date.now() + PAIR_ATTEMPT_WINDOW_MS,
  };
  state.failures += 1;
  pairingAttempts.set(userId, state);
}

function clearPairingAttempts(userId: string): void {
  pairingAttempts.delete(userId);
}

/** SEC-5: the pepper is mandatory; a missing one is a server misconfiguration (500, not user error). */
function requirePairPepper(): string {
  if (env.PAIR_PEPPER === undefined) {
    throw new AppError(
      ERROR_CODES.INTERNAL,
      'Pairing is not configured on this server (PAIR_PEPPER).',
    );
  }
  return env.PAIR_PEPPER;
}

/**
 * Step 1 — `POST /agent/register` (public, rate-limited 5/min/IP).
 * Stores only the peppered digest of the agent's code digest plus the hash of a fresh enroll
 * secret; returns the one-time enroll secret to the agent (SEC-5/DEC-014).
 */
export async function registerPendingDevice(
  input: DeviceRegisterInput,
): Promise<RegisterAgentResult> {
  const pairTokenHash = computePairTokenHash(requirePairPepper(), input.codeHmac.toLowerCase());

  // Fast, friendly 409 before hitting the unique partial index (which still guards the race).
  const existing = await Device.exists({ pairTokenHash });
  if (existing !== null) {
    throw new AppError(ERROR_CODES.CONFLICT, CODE_TAKEN_MESSAGE);
  }

  const enrollSecret = randomToken();
  try {
    const device = await Device.create({
      ownerId: null,
      name: input.name,
      os: input.os,
      status: 'DISCONNECTED',
      agentVersion: input.agentVersion,
      pairTokenHash,
      pairExpiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
      pairAttempts: 0,
      enrollSecretHash: sha256Hex(enrollSecret),
      pairedAt: null,
      lastSeenAt: null,
      capabilities: null,
    });
    return { deviceId: String(device._id), enrollSecret };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError(ERROR_CODES.CONFLICT, CODE_TAKEN_MESSAGE);
    }
    throw error;
  }
}

/**
 * Step 3 — `POST /devices/pair` (authenticated USER, 10/min/user).
 * Recomputes the two-stage digest, enforces TTL + attempt limits, atomically claims the pending
 * device, seeds the user's allow-list and returns the public device shape (never the token).
 */
export async function pairDevice(
  userId: string,
  input: DevicePairInput,
): Promise<PairDeviceResult> {
  const pairTokenHash = computePairTokenHash(
    requirePairPepper(),
    computePairingCodeHmac(input.code),
  );

  assertPairingNotLatched(userId);

  const pending = await Device.findOne({ pairTokenHash });
  if (pending === null) {
    recordFailedPairingAttempt(userId);
    throw new AppError(ERROR_CODES.INVALID_PAIRING_CODE, INVALID_CODE_MESSAGE);
  }

  const expiresAtMs = pending.pairExpiresAt?.getTime() ?? 0;
  if (expiresAtMs <= Date.now()) {
    // Permanently invalidate the expired pending row (the partial TTL index also sweeps these).
    await Device.deleteOne({ _id: pending._id, pairTokenHash });
    throw new AppError(ERROR_CODES.PAIRING_EXPIRED, CODE_EXPIRED_MESSAGE);
  }

  const ownerId = new Types.ObjectId(userId);
  const claimed = await Device.findOneAndUpdate(
    { _id: pending._id, pairTokenHash, ownerId: null },
    {
      $set: {
        ownerId,
        name: input.name ?? pending.name,
        pairedAt: new Date(),
        status: 'DISCONNECTED',
        // Single-use code: cleared, and the TTL index no longer applies (partial filter on the hash).
        pairTokenHash: null,
        pairExpiresAt: null,
        pairAttempts: 0,
        lastSeenAt: null,
      },
    },
    { new: true },
  );
  if (claimed === null) {
    // Another user paired the same code between our lookup and claim.
    throw new AppError(ERROR_CODES.PAIRING_EXPIRED, CODE_EXPIRED_MESSAGE);
  }

  await ensureAllowlistForUser(ownerId);
  clearPairingAttempts(userId);
  return { device: toPublicDevice(claimed) };
}

/**
 * Step 5 — `POST /agent/enroll/poll` (agent-secret): verifies the enroll secret and delivers the
 * device token exactly once. The token is minted here (not at pair time) so only its SHA-256 hash
 * ever exists at rest while the plaintext can still be handed to the agent; the enroll-secret hash
 * is cleared in the same atomic update, making later polls 410 (single-use enrollment).
 */
export async function pollEnrollment(input: EnrollPollInput): Promise<EnrollPollResult> {
  const device = await Device.findById(input.deviceId);
  // An unpaired pending device must never reveal a token, and a wrong secret is indistinguishable
  // from an unknown device (404) so the endpoint cannot be used to enumerate pending devices.
  if (device === null || device.ownerId === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, UNKNOWN_ENROLLMENT_MESSAGE);
  }

  const presentedSecretHash = sha256Hex(input.enrollSecret);
  if (device.enrollSecretHash === null) {
    throw new AppError(ERROR_CODES.PAIRING_EXPIRED, ENROLLMENT_CONSUMED_MESSAGE);
  }
  if (!safeEqualHex(presentedSecretHash, device.enrollSecretHash)) {
    throw new AppError(ERROR_CODES.NOT_FOUND, UNKNOWN_ENROLLMENT_MESSAGE);
  }

  const deviceToken = randomToken();
  const claimed = await Device.findOneAndUpdate(
    { _id: device._id, enrollSecretHash: device.enrollSecretHash },
    { $set: { deviceTokenHash: sha256Hex(deviceToken), enrollSecretHash: null } },
    { new: true },
  );
  if (claimed === null || claimed.ownerId === null) {
    // `ownerId` cannot be null for a polled device (guarded above), but keep the invariant explicit.
    throw new AppError(ERROR_CODES.PAIRING_EXPIRED, ENROLLMENT_CONSUMED_MESSAGE);
  }

  return {
    deviceToken,
    userId: String(claimed.ownerId),
    allowListVersion: await getAllowlistVersion(claimed.ownerId),
  };
}
