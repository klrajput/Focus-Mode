// server/src/utils/crypto.ts — the hashing/token primitives for pairing and device auth (T-040).
// Why: DEC-014 fixes the pairing digest in two stages (agent-side domain-separated SHA-256 of the
// 6-digit code, server-side HMAC-SHA256 with PAIR_PEPPER) and SEC-5/SEC-6 require that only hashes
// of the pairing code, enroll secret and device token are ever stored. Keeping these one-line
// primitives in one module means the wire derivation cannot drift between register/pair/poll and
// that no module compares secrets with a plain `===` (timing side channel).
// Invariants: hex is lowercase; comparisons are constant-time; random material is 256-bit from
// `node:crypto`; no secret is ever logged by these functions.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Domain separation for the agent-side code digest (DEC-014/C-01) — must match the Focus Agent. */
export const PAIRING_CODE_DOMAIN = 'focus-mode-pair-v1';

/** Bytes in the one-time enroll secret and in the long-lived device token (SEC-6: 256-bit). */
export const TOKEN_BYTES = 32;

/** Lowercase SHA-256 hex of a UTF-8 string. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Lowercase HMAC-SHA256 hex of a UTF-8 message with a UTF-8 key (DEC-014 stage 2). */
export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

/**
 * Stage 1 of DEC-014, as computed by the Focus Agent before `/agent/register`:
 * `SHA-256("focus-mode-pair-v1|" + code)` as lowercase hex.
 * The plaintext code never reaches the server from the agent; the user types it separately.
 */
export function computePairingCodeHmac(code: string): string {
  return sha256Hex(`${PAIRING_CODE_DOMAIN}|${code}`);
}

/**
 * Stage 2 of DEC-014, stored as `Device.pairTokenHash`: `HMAC-SHA256(PAIR_PEPPER, codeHmac)`.
 * The pepper lives only in server env, so a database leak cannot brute-force the 10^6 code space.
 */
export function computePairTokenHash(pairPepper: string, codeHmac: string): string {
  return hmacSha256Hex(pairPepper, codeHmac.toLowerCase());
}

/** 256-bit URL-safe random material (base64url without padding) for secrets and tokens. */
export function randomToken(byteLength: number = TOKEN_BYTES): string {
  return randomBytes(byteLength).toString('base64url');
}

/** Constant-time comparison of two hex digests; false for malformed input of any length. */
export function safeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length || left.length === 0) return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
