// server/src/utils/device-token.ts — the one-way representation of a long-lived device token.
// Why: SEC-6 requires the cloud to store only a hash of the device bearer token (256-bit random,
// minted once at `/agent/enroll/poll`). Both the agent-link hub (WS upgrade auth) and the REST
// device-token middleware (`GET /agent/allowlist`) must compare the same digest, so the hashing
// lives here instead of being duplicated.
// Invariants: SHA-256 hex only; the plaintext token never leaves the agent; comparisons are
// constant-time (see `safeEqualHex` in utils/crypto.ts) wherever a stored hash is compared.

import { createHash } from 'node:crypto';

/** SHA-256 hex of a device bearer token — the only representation stored or compared (SEC-6). */
export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
