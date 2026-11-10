/*
 * `clientSessionId` generator (REC-006, INTEGRATION_CONTRACTS §4.5).
 * The same UUID is sent in `enterFocus` and reused as the `POST /sessions` idempotency key, so a
 * retried start can never create two sessions. Every modern browser ships `crypto.randomUUID`;
 * the manual v4 fallback keeps old WebViews (and some jsdom versions) working without a polyfill
 * dependency, and it is never used to generate a secret (attestation nonces come from the agent).
 */

function manualUuidV4(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 version 4 + variant 10xx.
  const [b6 = 0, b8 = 0] = [bytes[6], bytes[8]];
  bytes[6] = (b6 & 0x0f) | 0x40;
  bytes[8] = (b8 & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A fresh RFC 4122 v4 UUID, matching the frozen `uuidSchema` used by both channels. */
export function newClientSessionId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return manualUuidV4();
}
