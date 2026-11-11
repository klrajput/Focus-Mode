// server/src/utils/crypto.test.ts — W7 (task-46) unit coverage for the hashing/token primitives.
// Why: `utils/crypto.ts` was reached only through the pairing happy path, so the two rejection
// branches of `safeEqualHex` (length mismatch, empty/non-hex input) never ran — and those branches
// are the reason no module has to guard secret comparisons itself (SEC-6, timing side channel).
// Invariants asserted: the digests match an independent `node:crypto` oracle (so the derivation
// cannot silently drift from the Focus Agent's DEC-014 stage 1), the HMAC lowercases the code digest
// before keying, and `safeEqualHex` answers `false` for anything that is not two equal-length hex
// digests of non-zero length instead of throwing.

import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PAIRING_CODE_DOMAIN,
  TOKEN_BYTES,
  computePairTokenHash,
  computePairingCodeHmac,
  hmacSha256Hex,
  randomToken,
  safeEqualHex,
  sha256Hex,
} from './crypto.js';

describe('SHA-256 / HMAC primitives', () => {
  it('hashes lowercase hex and matches an independent digest oracle', () => {
    const digest = sha256Hex('focus');

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).toBe(createHash('sha256').update('focus', 'utf8').digest('hex'));
    // Known-answer check of the empty string (the classic SHA-256 KAT).
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('byte-exact UTF-8: an accented name hashes differently from its ASCII lookalike', () => {
    expect(sha256Hex('Kabir')).not.toBe(sha256Hex('Kabír'));
  });

  it('HMAC-SHA256 matches an independent oracle for the same key/message', () => {
    const digest = hmacSha256Hex('pepper', 'message');

    expect(digest).toBe(createHmac('sha256', 'pepper').update('message', 'utf8').digest('hex'));
    expect(digest).not.toBe(hmacSha256Hex('pepper2', 'message'));
  });
});

describe('DEC-014 pairing digest', () => {
  it('domain-separates stage 1 exactly as the Focus Agent does', () => {
    const code = '000042';

    expect(computePairingCodeHmac(code)).toBe(
      createHash('sha256').update(`${PAIRING_CODE_DOMAIN}|${code}`, 'utf8').digest('hex'),
    );
    expect(PAIRING_CODE_DOMAIN).toBe('focus-mode-pair-v1');
  });

  it('is deterministic per code but different across codes (leading zeros preserved)', () => {
    expect(computePairingCodeHmac('000042')).toBe(computePairingCodeHmac('000042'));
    expect(computePairingCodeHmac('000042')).not.toBe(computePairingCodeHmac('000043'));
  });

  it('keys stage 2 with the pepper and lowercases the incoming digest', () => {
    const codeHmac = computePairingCodeHmac('123456');

    expect(computePairTokenHash('pepper', codeHmac)).toBe(
      createHmac('sha256', 'pepper').update(codeHmac.toLowerCase(), 'utf8').digest('hex'),
    );
    // An uppercase copy of the same digest is the same pairing code (hex is case-insensitive).
    expect(computePairTokenHash('pepper', codeHmac.toUpperCase())).toBe(
      computePairTokenHash('pepper', codeHmac),
    );
    // A different pepper produces a different stored value (a DB leak alone cannot brute-force).
    expect(computePairTokenHash('other-pepper', codeHmac)).not.toBe(
      computePairTokenHash('pepper', codeHmac),
    );
  });
});

describe('randomToken', () => {
  it('defaults to TOKEN_BYTES of URL-safe material without padding', () => {
    const token = randomToken();

    expect(TOKEN_BYTES).toBe(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });

  it('honours an explicit byte length and refuses to pad', () => {
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomToken(64)).toMatch(/^[A-Za-z0-9_-]{86}$/);
  });
});

describe('safeEqualHex', () => {
  it('is true only for identical hex digests', () => {
    const digest = sha256Hex('focus');

    expect(safeEqualHex(digest, digest)).toBe(true);
    expect(safeEqualHex(digest, sha256Hex('focus '))).toBe(false);
  });

  it('is false (never throws) for a length mismatch', () => {
    expect(safeEqualHex(sha256Hex('a'), sha256Hex('a').slice(0, 32))).toBe(false);
  });

  it('is false for empty or non-hex input', () => {
    expect(safeEqualHex('', '')).toBe(false);
    expect(safeEqualHex('zzzz', 'zzzz')).toBe(false);
    expect(safeEqualHex('abcd', 'zzzz')).toBe(false);
  });
});
