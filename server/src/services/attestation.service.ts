// server/src/services/attestation.service.ts — issues the short-lived device attestation JWT
// (T-043, REC-003/SEC-7/DEC-013). Why: the dashboard proves to the local Focus Agent that it is a
// page acting for the device's owner; the cloud signs a single-use, nonce-bound, 60 s EdDSA
// attestation that the agent verifies with the public key from `GET /agent/attest-key` before it
// accepts any control message. Claims are frozen: `sub` = userId, `aud` = deviceId, `nonce`,
// `iat`/`exp` (60 s). Invariants: the private key never leaves the server; keys come from validated
// env; a misconfigured/invalid/mismatched keypair fails loudly (500 INTERNAL, logged server-side)
// instead of signing tokens no agent can verify; no key material is logged or returned here except
// the public key (by design).

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { ERROR_CODES } from '@focus-mode/shared';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { signEdDsaJwt } from '../utils/jwt-eddsa.js';

/** REC-003/DEC-013: EdDSA (Ed25519), 60 s TTL. */
export const ATTESTATION_ALGORITHM = 'EdDSA';
export const ATTESTATION_TTL_SECONDS = 60;

/** Attestation issuer claim; the agent does not need to enforce it, it aids operator debugging. */
const ATTESTATION_ISSUER = 'focus-mode-api';

/** Success payload of `GET /agent/attest-key` (contract §3.1 #40). */
export interface AttestationPublicKey {
  publicKey: string;
  algorithm: typeof ATTESTATION_ALGORITHM;
}

/** Success payload of `POST /devices/:id/attest` (contract §3.1 #11). */
export interface DeviceAttestation {
  attestation: string;
  expiresAt: string;
  algorithm: typeof ATTESTATION_ALGORITHM;
}

export interface SignAttestationInput {
  userId: string;
  deviceId: string;
  nonce: string;
}

/** Cached public key PEM (loaded once per process; validated together with the private key). */
let cachedPublicKeyPem: string | null = null;

/** The public key the Focus Agent caches at startup; never the private key (SEC-7). */
export function getAttestationPublicKey(): AttestationPublicKey {
  return { publicKey: loadVerifiedKeyPair().publicKeyPem, algorithm: ATTESTATION_ALGORITHM };
}

/**
 * W6/SEC-7, delta C-26 replay cache: every (userId, deviceId, nonce) tuple may be signed once per TTL.
 * Process-local (single API instance, TECHNICAL_DESIGN §8) and insertion-ordered so the map can
 * be pruned deterministically; it never holds the attestation itself, only expiring tick counts.
 */
const nonceExpiryByKey = new Map<string, number>();
const NONCE_CACHE_MAX_ENTRIES = 5_000;

/** Test-only: clear the replay cache (like the rate-limit stores, it is process-local). */
export function resetAttestationNonceCache(): void {
  nonceExpiryByKey.clear();
}

function attestationNonceKey(input: SignAttestationInput): string {
  return `${input.userId}:${input.deviceId}:${input.nonce}`;
}

function assertNonceUnused(input: SignAttestationInput, nowMs: number): void {
  for (const [key, expiresAtMs] of nonceExpiryByKey) {
    if (expiresAtMs <= nowMs) nonceExpiryByKey.delete(key);
  }
  const key = attestationNonceKey(input);
  if (nonceExpiryByKey.has(key)) {
    throw new AppError(ERROR_CODES.CONFLICT, 'This attestation nonce was already used.');
  }
  if (nonceExpiryByKey.size >= NONCE_CACHE_MAX_ENTRIES) {
    // Bounded memory under a flood: drop the oldest entries (Map keeps insertion order).
    let toDrop = Math.ceil(NONCE_CACHE_MAX_ENTRIES / 4);
    for (const oldest of nonceExpiryByKey.keys()) {
      nonceExpiryByKey.delete(oldest);
      toDrop -= 1;
      if (toDrop <= 0) break;
    }
  }
  nonceExpiryByKey.set(key, nowMs + ATTESTATION_TTL_SECONDS * 1000);
}

/** Injectable clock (tests only); the HTTP controller always uses the real clock. */
export interface SignAttestationDeps {
  now?: () => number;
}

/** Sign the nonce-bound, 60 s attestation the dashboard sends over the local channel. */
export function signDeviceAttestation(
  input: SignAttestationInput,
  deps: SignAttestationDeps = {},
): DeviceAttestation {
  const nowMs = deps.now?.() ?? Date.now();
  assertNonceUnused(input, nowMs);
  const { privateKeyPem } = loadVerifiedKeyPair();
  const issuedAtSeconds = Math.floor(nowMs / 1000);
  const expiresAtSeconds = issuedAtSeconds + ATTESTATION_TTL_SECONDS;

  const attestation = signEdDsaJwt(
    {
      sub: input.userId,
      aud: input.deviceId,
      nonce: input.nonce,
      iat: issuedAtSeconds,
      exp: expiresAtSeconds,
      iss: ATTESTATION_ISSUER,
    },
    privateKeyPem,
  );

  return {
    attestation,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    algorithm: ATTESTATION_ALGORITHM,
  };
}

interface VerifiedKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

/**
 * Load and self-check the EdDSA keypair once: both keys must parse as Ed25519 and must belong to
 * the same pair (probe sign + verify). Any failure is a 500 INTERNAL — a deployment problem, never
 * a user error — and is logged by the central error handler.
 */
function loadVerifiedKeyPair(): VerifiedKeyPair {
  const privateKeyPem = env.ATTEST_PRIVATE_KEY;
  const configuredPublicKeyPem = env.ATTEST_PUBLIC_KEY;
  if (privateKeyPem === undefined || configuredPublicKeyPem === undefined) {
    throw new AppError(
      ERROR_CODES.INTERNAL,
      'Device attestation is not configured on this server (ATTEST_PRIVATE_KEY/ATTEST_PUBLIC_KEY).',
    );
  }

  if (cachedPublicKeyPem !== null) {
    return { privateKeyPem, publicKeyPem: cachedPublicKeyPem };
  }

  try {
    const privateKey = createPrivateKey(privateKeyPem);
    const publicKey = createPublicKey(configuredPublicKeyPem);
    const probe = Buffer.from('focus-mode attestation keypair probe', 'utf8');
    const probeSignature = sign(null, probe, privateKey);
    if (!verify(null, probe, publicKey, probeSignature)) {
      throw new AppError(ERROR_CODES.INTERNAL, 'Attestation keypair does not match (SEC-7).');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      ERROR_CODES.INTERNAL,
      'Attestation keys are not a valid Ed25519 PEM keypair.',
    );
  }

  cachedPublicKeyPem = configuredPublicKeyPem;
  return { privateKeyPem, publicKeyPem: cachedPublicKeyPem };
}
