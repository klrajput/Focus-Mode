// link/attestation.ts — verification of the cloud-signed attestation that unlocks dashboard
// control (T-044, REC-003, SEC-7). EdDSA/Ed25519 only (DEC-013): the JWT must be bound to the
// single-use challenge nonce, to this device (`aud`) and to its paired owner (`sub`), must not be
// older than 60 s, and is verified with the public key cached from `GET /agent/attest-key`.
// Every failure is fail-closed and becomes `authError{UNAUTHENTICATED|FORBIDDEN}`.

import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { noopLogger, type Logger } from '../log.js';
import { apiUrl, getJson, readSuccessEnvelope } from '../cloud/transport.js';

/** Contract §4.4: attestation lifetime is 60 s (SEC-7). */
export const ATTESTATION_MAX_TTL_SECONDS = 60;
export const ATTEST_KEY_PATH = '/agent/attest-key';
/** The public key rotates rarely; contract §4.4 asks for a ~10-minute cache. */
export const DEFAULT_KEY_CACHE_TTL_MS = 10 * 60 * 1000;

export interface AttestationBinding {
  readonly deviceId: string;
  readonly userId: string;
}

export interface AttestationExpectation extends AttestationBinding {
  /** The nonce this agent issued in its `challenge` frame (single use). */
  readonly nonce: string;
}

export type AttestationRejectionReason =
  | 'NOT_PAIRED'
  | 'MALFORMED_TOKEN'
  | 'UNSUPPORTED_ALGORITHM'
  | 'KEY_UNAVAILABLE'
  | 'KEY_UNUSABLE'
  | 'BAD_SIGNATURE'
  | 'EXPIRED'
  | 'TTL_TOO_LONG'
  | 'NOT_YET_VALID'
  | 'AUDIENCE_MISMATCH'
  | 'SUBJECT_MISMATCH'
  | 'NONCE_MISMATCH';

export type AttestationVerification =
  | {
      readonly ok: true;
      readonly deviceId: string;
      readonly userId: string;
      readonly expiresAt: Date;
    }
  | {
      readonly ok: false;
      readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN';
      readonly reason: AttestationRejectionReason;
      readonly message: string;
    };

function reject(
  code: 'UNAUTHENTICATED' | 'FORBIDDEN',
  reason: AttestationRejectionReason,
  message: string,
): AttestationVerification {
  return { ok: false, code, reason, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeJsonSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export interface VerifyAttestationJwtOptions {
  readonly token: string;
  /** PEM from `GET /agent/attest-key` (single-line or multi-line PEM). */
  readonly publicKeyPem: string;
  readonly expected: AttestationExpectation;
  readonly now: Date;
  readonly maxTtlSeconds?: number;
}

/**
 * Pure EdDSA attestation verifier. Checks, in order: compact JWT shape → header alg pinned to
 * `EdDSA` → signature (with an Ed25519 key) → `exp` window → `aud`/`sub`/`nonce` binding.
 * The check order means an unsigned claim is never trusted, not even for error messages.
 */
export function verifyAttestationJwt(
  options: VerifyAttestationJwtOptions,
): AttestationVerification {
  const maxTtlSeconds = options.maxTtlSeconds ?? ATTESTATION_MAX_TTL_SECONDS;
  const parts = options.token.split('.');
  if (parts.length !== 3) {
    return reject('UNAUTHENTICATED', 'MALFORMED_TOKEN', 'The attestation is not a compact JWT.');
  }
  const encodedHeader = parts[0];
  const encodedPayload = parts[1];
  const encodedSignature = parts[2];
  if (
    encodedHeader === undefined ||
    encodedPayload === undefined ||
    encodedSignature === undefined ||
    encodedHeader.length === 0 ||
    encodedPayload.length === 0 ||
    encodedSignature.length === 0
  ) {
    return reject('UNAUTHENTICATED', 'MALFORMED_TOKEN', 'The attestation is not a compact JWT.');
  }

  const header = decodeJsonSegment(encodedHeader);
  if (!isRecord(header)) {
    return reject('UNAUTHENTICATED', 'MALFORMED_TOKEN', 'The attestation header is not JSON.');
  }
  // SEC-7/DEC-013: algorithm is pinned, so `none`/HS256 confusion can never be attempted.
  if (header.alg !== 'EdDSA') {
    return reject(
      'UNAUTHENTICATED',
      'UNSUPPORTED_ALGORITHM',
      'Only EdDSA (Ed25519) attestations are accepted.',
    );
  }

  const claims = decodeJsonSegment(encodedPayload);
  if (!isRecord(claims)) {
    return reject('UNAUTHENTICATED', 'MALFORMED_TOKEN', 'The attestation payload is not JSON.');
  }

  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(options.publicKeyPem);
  } catch {
    return reject(
      'UNAUTHENTICATED',
      'KEY_UNUSABLE',
      'The attestation public key could not be parsed.',
    );
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    return reject(
      'UNAUTHENTICATED',
      'KEY_UNUSABLE',
      'The attestation public key is not an Ed25519 key.',
    );
  }

  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8');
  let signatureValid = false;
  try {
    signatureValid = verifySignature(
      null,
      signingInput,
      publicKey,
      Buffer.from(encodedSignature, 'base64url'),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return reject('UNAUTHENTICATED', 'BAD_SIGNATURE', 'The attestation signature is invalid.');
  }

  const expiresAtSeconds = claims['exp'];
  if (typeof expiresAtSeconds !== 'number' || !Number.isFinite(expiresAtSeconds)) {
    return reject('UNAUTHENTICATED', 'MALFORMED_TOKEN', 'The attestation has no expiry.');
  }
  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  if (expiresAtSeconds <= nowSeconds) {
    return reject('UNAUTHENTICATED', 'EXPIRED', 'The attestation has expired.');
  }
  if (expiresAtSeconds - nowSeconds > maxTtlSeconds) {
    return reject(
      'UNAUTHENTICATED',
      'TTL_TOO_LONG',
      `The attestation lives longer than ${maxTtlSeconds} seconds.`,
    );
  }
  const notBefore = claims['nbf'];
  if (typeof notBefore === 'number' && notBefore > nowSeconds) {
    return reject('UNAUTHENTICATED', 'NOT_YET_VALID', 'The attestation is not valid yet.');
  }

  if (claims['aud'] !== options.expected.deviceId) {
    return reject(
      'UNAUTHENTICATED',
      'AUDIENCE_MISMATCH',
      'The attestation is not bound to this device.',
    );
  }
  if (claims['sub'] !== options.expected.userId) {
    // FORBIDDEN: correctly signed, but for someone else's account.
    return reject('FORBIDDEN', 'SUBJECT_MISMATCH', 'The attestation belongs to another account.');
  }
  if (claims['nonce'] !== options.expected.nonce) {
    return reject(
      'UNAUTHENTICATED',
      'NONCE_MISMATCH',
      'The attestation does not match this challenge.',
    );
  }

  return {
    ok: true,
    deviceId: options.expected.deviceId,
    userId: options.expected.userId,
    expiresAt: new Date(expiresAtSeconds * 1000),
  };
}

// ---------------------------------------------------------------------------
// Public-key fetch + cache
// ---------------------------------------------------------------------------

const attestKeyDataSchema = z.strictObject({
  publicKey: z.string().min(1).max(8192),
  algorithm: z.literal('EdDSA'),
});

export interface FetchAttestKeyOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** `GET /agent/attest-key` → PEM (contract §3.1 #40). */
export async function fetchAttestKey(options: FetchAttestKeyOptions): Promise<string> {
  const response = await getJson({
    url: apiUrl(options.baseUrl, ATTEST_KEY_PATH),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  const data = readSuccessEnvelope(response, ATTEST_KEY_PATH);
  const parsed = attestKeyDataSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('The attestation key endpoint returned an unexpected payload');
  }
  return parsed.data.publicKey;
}

export interface AttestationGateOptions {
  readonly baseUrl: string;
  /** Current pairing identity, or null while unpaired (then no attestation can ever pass). */
  readonly getBinding: () => AttestationBinding | null;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly keyCacheTtlMs?: number;
  readonly maxTtlSeconds?: number;
  readonly logger?: Logger;
  /** Test seam; defaults to `fetchAttestKey`. */
  readonly fetchPublicKey?: () => Promise<string>;
}

export interface AttestationRequest {
  readonly token: string;
  readonly nonce: string;
}

/**
 * Verifier used by `link/server.ts`. Caches the Ed25519 public key for ~10 minutes so a local
 * handshake does not depend on a cloud round-trip, and never caches a failed fetch.
 */
export class AttestationGate {
  readonly #options: AttestationGateOptions;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #keyCacheTtlMs: number;
  readonly #fetchPublicKey: () => Promise<string>;
  #publicKey: string | undefined;
  #fetchedAtMs = 0;

  constructor(options: AttestationGateOptions) {
    this.#options = options;
    this.#logger = options.logger ?? noopLogger;
    this.#now = options.now ?? (() => new Date());
    this.#keyCacheTtlMs = options.keyCacheTtlMs ?? DEFAULT_KEY_CACHE_TTL_MS;
    this.#fetchPublicKey =
      options.fetchPublicKey ??
      (() =>
        fetchAttestKey({
          baseUrl: options.baseUrl,
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
          ...(options.requestTimeoutMs === undefined
            ? {}
            : { timeoutMs: options.requestTimeoutMs }),
        }));
  }

  async verify(request: AttestationRequest): Promise<AttestationVerification> {
    const binding = this.#options.getBinding();
    if (binding === null) {
      return reject(
        'UNAUTHENTICATED',
        'NOT_PAIRED',
        'This Focus Agent is not paired, so control is unavailable.',
      );
    }

    let publicKeyPem: string;
    try {
      publicKeyPem = await this.#getPublicKey();
    } catch (error) {
      this.#logger.warn(
        'Could not load the attestation public key',
        error instanceof Error ? error.message : 'unknown error',
      );
      return reject(
        'UNAUTHENTICATED',
        'KEY_UNAVAILABLE',
        'The attestation public key could not be loaded.',
      );
    }

    return verifyAttestationJwt({
      token: request.token,
      publicKeyPem,
      expected: { nonce: request.nonce, deviceId: binding.deviceId, userId: binding.userId },
      now: this.#now(),
      ...(this.#options.maxTtlSeconds === undefined
        ? {}
        : { maxTtlSeconds: this.#options.maxTtlSeconds }),
    });
  }

  /** Drops the cached key (e.g. after a `revoked` re-pair). */
  invalidateKey(): void {
    this.#publicKey = undefined;
    this.#fetchedAtMs = 0;
  }

  async #getPublicKey(): Promise<string> {
    const cached = this.#publicKey;
    if (cached !== undefined && this.#now().getTime() - this.#fetchedAtMs < this.#keyCacheTtlMs) {
      return cached;
    }
    const publicKey = await this.#fetchPublicKey();
    this.#publicKey = publicKey;
    this.#fetchedAtMs = this.#now().getTime();
    return publicKey;
  }
}
