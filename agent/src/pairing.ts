// pairing.ts — the 6-digit pairing code that is shown ONLY in the Focus Agent window (DEC-003).
// The plaintext code never crosses the local WebSocket, never appears in a log and is never
// persisted; W2's cloud client (T-042) computes the domain-separated SHA-256 digest from it
// (DEC-014) and registers the device. This module is display state only.

import { randomInt } from 'node:crypto';

/** RFC-style pairing-code TTL: 10 minutes, enforced authoritatively by the cloud (SEC-5). */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export interface PairingCode {
  /** Six ASCII digits, e.g. `482916`. Render only — never log, never put on the wire. */
  readonly value: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export type RandomDigitSource = (min: number, max: number) => number;

/** Builds a zero-padded 6-digit code using the OS CSPRNG. */
export function generatePairingCode(
  now: Date = new Date(),
  random: RandomDigitSource = randomInt,
): PairingCode {
  const value = String(random(0, 1_000_000)).padStart(6, '0');
  return {
    value,
    issuedAt: new Date(now.getTime()),
    expiresAt: new Date(now.getTime() + PAIRING_CODE_TTL_MS),
  };
}

/** True once the code should no longer be offered to the user. */
export function isPairingCodeExpired(code: PairingCode, now: Date = new Date()): boolean {
  return now.getTime() >= code.expiresAt.getTime();
}

/** Redacted representation for any log line; the digits are never included. */
export function pairCodeLogLabel(code: PairingCode): string {
  return `pairing code issued ${code.issuedAt.toISOString()} (redacted)`;
}
