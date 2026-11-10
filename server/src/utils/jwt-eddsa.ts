// server/src/utils/jwt-eddsa.ts — RFC 8037 EdDSA (Ed25519) JWT encode/verify for device
// attestation (T-043, REC-003/DEC-013).
// Why: the frozen attestation algorithm is EdDSA (DEC-013/C-09), but `jsonwebtoken@9.0.3` does NOT
// support EdDSA (its `SUPPORTED_ALGS` list excludes it), and no JOSE library is installed. Node's
// `node:crypto` signs/verifies Ed25519 natively, so this module produces the standard three-part
// JWT (`base64url(header).base64url(payload).base64url(signature)`) that any JOSE implementation
// can verify — the Focus Agent verifies it, and the server tests re-verify with node:crypto.
// Invariants: only EdDSA/Ed25519 keys are accepted (never RSA/HMAC); the header alg is pinned and
// re-checked on verify; signing failures are 500 INTERNAL (server misconfiguration) while invalid
// tokens are 401 UNAUTHENTICATED; no key material is ever logged here.

import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { ERROR_CODES } from '@focus-mode/shared';
import { AppError } from './AppError.js';

const ATTESTATION_ALGORITHM = 'EdDSA';
const ED25519_KEY_TYPE = 'ed25519';

interface JwsHeader {
  alg: typeof ATTESTATION_ALGORITHM;
  typ: 'JWT';
}

/** A decoded (signature-checked) EdDSA JWT. Claim checks are the caller's responsibility. */
export interface EdDsaToken {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

function encodeJsonSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJsonSegment(segment: string, kind: 'header' | 'payload'): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw invalidToken(`Attestation ${kind} is not valid base64url JSON.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalidToken(`Attestation ${kind} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function invalidToken(message: string): AppError {
  return new AppError(ERROR_CODES.UNAUTHENTICATED, message);
}

function loadEd25519PrivateKey(pem: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new AppError(ERROR_CODES.INTERNAL, 'ATTEST_PRIVATE_KEY is not a valid PEM private key.');
  }
  if (key.type !== 'private' || key.asymmetricKeyType !== ED25519_KEY_TYPE) {
    throw new AppError(ERROR_CODES.INTERNAL, 'ATTEST_PRIVATE_KEY must be an Ed25519 (EdDSA) key.');
  }
  return key;
}

function loadEd25519PublicKey(pem: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch {
    throw new AppError(ERROR_CODES.INTERNAL, 'ATTEST_PUBLIC_KEY is not a valid PEM public key.');
  }
  if (key.asymmetricKeyType !== ED25519_KEY_TYPE) {
    throw new AppError(ERROR_CODES.INTERNAL, 'ATTEST_PUBLIC_KEY must be an Ed25519 (EdDSA) key.');
  }
  return key;
}

/** Sign a JWT payload as an EdDSA/Ed25519 JWS (compact serialization). */
export function signEdDsaJwt(payload: Record<string, unknown>, privateKeyPem: string): string {
  const header: JwsHeader = { alg: ATTESTATION_ALGORITHM, typ: 'JWT' };
  const signingInput = `${encodeJsonSegment(header)}.${encodeJsonSegment(payload)}`;
  const signature = sign(
    null,
    Buffer.from(signingInput, 'utf8'),
    loadEd25519PrivateKey(privateKeyPem),
  );
  return `${signingInput}.${signature.toString('base64url')}`;
}

/**
 * Verify an EdDSA/Ed25519 JWT signature and return its header/payload.
 * Used by tests and by any server-side consumer that must check the token it just shaped; the
 * claims (`sub`, `aud`, `nonce`, `exp`) are validated by the party that knows their context.
 */
export function verifyEdDsaJwt(token: string, publicKeyPem: string): EdDsaToken {
  const segments = token.split('.');
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  if (segments.length !== 3 || !encodedHeader || !encodedPayload || !encodedSignature) {
    throw invalidToken('Attestation must have exactly three JWT segments.');
  }

  const header = decodeJsonSegment(encodedHeader, 'header');
  if (header.alg !== ATTESTATION_ALGORITHM) {
    throw invalidToken(`Unsupported attestation algorithm: ${String(header.alg)}.`);
  }

  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8');
  const signatureOk = verify(
    null,
    signingInput,
    loadEd25519PublicKey(publicKeyPem),
    Buffer.from(encodedSignature, 'base64url'),
  );
  if (!signatureOk) throw invalidToken('Attestation signature is invalid.');

  return { header, payload: decodeJsonSegment(encodedPayload, 'payload') };
}
