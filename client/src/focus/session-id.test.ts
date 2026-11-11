/*
 * `newClientSessionId` tests (REC-006, INTEGRATION_CONTRACTS §4.5).
 * The id is both `enterFocus`'s session id and the `POST /sessions` idempotency key, so it must
 * always be a well-formed RFC 4122 v4 UUID — even in a WebView without `crypto.randomUUID` — and
 * two calls must never collide.
 */

import { describe, expect, it, vi } from 'vitest';

import { newClientSessionId } from './session-id';

/** Lower-case v4 UUID: version nibble `4`, variant nibble `8|9|a|b`. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function versionOf(id: string): string {
  return id[14] ?? '';
}

function variantOf(id: string): string {
  return id[19] ?? '';
}

describe('newClientSessionId', () => {
  it('uses crypto.randomUUID when the browser provides it', () => {
    const randomUUID = vi.fn(() => '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f');
    vi.stubGlobal('crypto', { randomUUID });

    expect(newClientSessionId()).toBe('3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('falls back to crypto.getRandomValues when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 37) % 256;
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    const id = newClientSessionId();

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(id).toMatch(UUID_V4);
    expect(versionOf(id)).toBe('4');
    expect(['8', '9', 'a', 'b']).toContain(variantOf(id));
  });

  it('falls back to Math.random when the platform has no Web Crypto at all', () => {
    vi.stubGlobal('crypto', undefined);

    const id = newClientSessionId();

    expect(id).toMatch(UUID_V4);
  });

  it('still returns a valid id when randomUUID throws (insecure context)', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xab);
      return bytes;
    });
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        throw new Error('randomUUID is only available in a secure context');
      },
      getRandomValues,
    });

    const id = newClientSessionId();

    expect(id).toMatch(UUID_V4);
    expect(versionOf(id)).toBe('4');
    // 0xab & 0x3f | 0x80 = 0xab, so the variant nibble is 'a'.
    expect(variantOf(id)).toBe('a');
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it('honours only the version/variant nibbles of the random bytes', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xff);
        return bytes;
      },
    });

    const id = newClientSessionId();

    // 0xff & 0x0f | 0x40 = 0x4f, 0xff & 0x3f | 0x80 = 0xbf.
    expect(id.slice(14, 18)).toBe('4fff');
    expect(variantOf(id)).toBe('b');
    expect(id).toMatch(UUID_V4);
  });

  it('produces unique, correctly shaped ids across many calls', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newClientSessionId()));

    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(id).toMatch(UUID_V4);
      expect(id).toHaveLength(36);
    }
  });

  it('never returns the nil UUID', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(newClientSessionId()).not.toBe('00000000-0000-0000-0000-000000000000');
    }
  });
});
