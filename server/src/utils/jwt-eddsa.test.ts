// server/src/utils/jwt-eddsa.test.ts — W7 (task-46) unit coverage for the EdDSA attestation JWT.
// Why: `utils/jwt-eddsa.ts` was the weakest server file (29.72 % lines) because it was only reached
// through the happy-path attestation route: the rejection branches — wrong algorithm, tampered
// signature, malformed segments, non-Ed25519 or non-PEM keys — were never executed, yet those are
// exactly the branches that decide 401 UNAUTHENTICATED vs 500 INTERNAL for REC-003 (SEC-7).
// Invariants asserted here: only Ed25519 keys are accepted, the header `alg` is pinned to EdDSA and
// re-checked on verify, a tampered payload/signature is 401 (never 500), a bad server key is a
// 500 INTERNAL with no key material in the message, and the compact token stays JOSE-shaped
// (`base64url(header).base64url(payload).base64url(signature)`) so the Focus Agent can verify it
// with any standard JOSE implementation.

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AppError } from './AppError.js';
import { verifyEdDsaJwt, signEdDsaJwt } from './jwt-eddsa.js';

interface KeyPairFixture {
  privatePem: string;
  publicPem: string;
}

/** Real Ed25519 keypair PEMs, exactly the format `env.ATTEST_*_KEY` holds (DEC-013). */
function ed25519(): KeyPairFixture {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function pem(key: KeyObject): string {
  return key.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/** Assert an AppError with the frozen code and HTTP status (NFR-002 §8). */
function expectAppError(fn: () => unknown, code: string, status: number): void {
  try {
    fn();
    throw new Error('expected the call to throw an AppError');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe(code);
    expect(appError.status).toBe(status);
  }
}

const PAYLOAD = {
  sub: '507f1f77bcf86cd799439011',
  aud: 'focus-agent',
  nonce: 'nonce-0123456789abcdef',
  exp: Math.floor(Date.parse('2026-11-10T10:05:00.000Z') / 1000),
};

const b64urlJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const keys = ed25519();

describe('signEdDsaJwt', () => {
  it('produces a three-segment JOSE compact token with the pinned EdDSA header', () => {
    const token = signEdDsaJwt(PAYLOAD, keys.privatePem);
    const segments = token.split('.');

    expect(segments).toHaveLength(3);
    expect(JSON.parse(Buffer.from(segments[0] ?? '', 'base64url').toString('utf8'))).toEqual({
      alg: 'EdDSA',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(segments[1] ?? '', 'base64url').toString('utf8'))).toEqual(
      PAYLOAD,
    );
    // base64url never emits padding or the standard-alphabet characters, per RFC 7515 §2.
    for (const segment of segments) expect(segment).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is non-deterministic in the signature only (Ed25519 is deterministic, so tokens match)', () => {
    // Documents the wire guarantee the Focus Agent relies on: the same payload signs identically.
    expect(signEdDsaJwt(PAYLOAD, keys.privatePem)).toBe(signEdDsaJwt(PAYLOAD, keys.privatePem));
  });

  it('refuses a value that is not a PEM private key with 500 INTERNAL', () => {
    expectAppError(() => signEdDsaJwt(PAYLOAD, 'not-a-pem'), 'INTERNAL', 500);
  });

  it('refuses a non-Ed25519 (RSA) private key with 500 INTERNAL', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expectAppError(() => signEdDsaJwt(PAYLOAD, pem(rsa)), 'INTERNAL', 500);
  });
});

describe('verifyEdDsaJwt', () => {
  it('round-trips a token it signed and returns header + payload', () => {
    const verified = verifyEdDsaJwt(signEdDsaJwt(PAYLOAD, keys.privatePem), keys.publicPem);

    expect(verified.header).toEqual({ alg: 'EdDSA', typ: 'JWT' });
    expect(verified.payload).toEqual(PAYLOAD);
  });

  it('rejects a token signed by a different key as 401 UNAUTHENTICATED', () => {
    const token = signEdDsaJwt(PAYLOAD, ed25519().privatePem);
    expectAppError(() => verifyEdDsaJwt(token, keys.publicPem), 'UNAUTHENTICATED', 401);
  });

  it('rejects a payload edited after signing (signature check, not just parsing)', () => {
    const [header, , signature] = signEdDsaJwt(PAYLOAD, keys.privatePem).split('.');
    const forgedPayload = b64urlJson({ ...PAYLOAD, sub: '507f1f77bcf86cd799439999' });

    expectAppError(
      () => verifyEdDsaJwt(`${header}.${forgedPayload}.${signature}`, keys.publicPem),
      'UNAUTHENTICATED',
      401,
    );
  });

  it('rejects a tampered signature as 401 UNAUTHENTICATED', () => {
    const [header, payload, signature = ''] = signEdDsaJwt(PAYLOAD, keys.privatePem).split('.');
    // Tamper DETERMINISTICALLY: flip a bit in the decoded Ed25519 signature bytes. Mutating the
    // last base64url character is NOT reliable — its two least-significant bits are padding, so
    // some substitutions decode to the identical 64-byte signature and the token stays valid
    // (this flaked on the macOS/Windows CI runners).
    const signatureBytes = Buffer.from(signature, 'base64url');
    signatureBytes[10] = (signatureBytes[10] ?? 0) ^ 0x01;
    const flipped = signatureBytes.toString('base64url');

    expectAppError(
      () => verifyEdDsaJwt(`${header}.${payload}.${flipped}`, keys.publicPem),
      'UNAUTHENTICATED',
      401,
    );
  });

  it('rejects an alg:none header before touching the signature', () => {
    const token = `${b64urlJson({ alg: 'none', typ: 'JWT' })}.${b64urlJson(PAYLOAD)}.`;
    expectAppError(() => verifyEdDsaJwt(token, keys.publicPem), 'UNAUTHENTICATED', 401);
  });

  it('rejects a header that claims HS256 (algorithm confusion attempt)', () => {
    const [header, payload, signature = ''] = signEdDsaJwt(PAYLOAD, keys.privatePem).split('.');
    expect(header).toBeDefined();
    const confused = `${b64urlJson({ alg: 'HS256', typ: 'JWT' })}.${payload}.${signature}`;

    expectAppError(() => verifyEdDsaJwt(confused, keys.publicPem), 'UNAUTHENTICATED', 401);
  });

  it.each([
    ['no segments', 'not-a-jwt'],
    ['two segments', `${b64urlJson({ alg: 'EdDSA' })}.${b64urlJson(PAYLOAD)}`],
    ['four segments', `${b64urlJson({ alg: 'EdDSA' })}.${b64urlJson(PAYLOAD)}.c2ln.c2ln`],
    ['an empty signature', `${b64urlJson({ alg: 'EdDSA' })}.${b64urlJson(PAYLOAD)}.`],
    ['an empty header', `.${b64urlJson(PAYLOAD)}.c2ln`],
  ])('rejects %s as 401 UNAUTHENTICATED', (_label, token) => {
    expectAppError(() => verifyEdDsaJwt(token, keys.publicPem), 'UNAUTHENTICATED', 401);
  });

  it('rejects header/payload segments that are not base64url JSON', () => {
    const signatureSegment = signEdDsaJwt(PAYLOAD, keys.privatePem).split('.')[2] ?? '';
    const notJson = Buffer.from('not json', 'utf8').toString('base64url');

    expectAppError(
      () => verifyEdDsaJwt(`${notJson}.${b64urlJson(PAYLOAD)}.${signatureSegment}`, keys.publicPem),
      'UNAUTHENTICATED',
      401,
    );
    // A JSON *array* is a classic JWT smuggling shape: only objects are valid segments.
    const arrayHeader = b64urlJson([{ alg: 'EdDSA' }]);
    expectAppError(
      () =>
        verifyEdDsaJwt(`${arrayHeader}.${b64urlJson(PAYLOAD)}.${signatureSegment}`, keys.publicPem),
      'UNAUTHENTICATED',
      401,
    );
  });

  it('reports an invalid public key as a 500 INTERNAL server misconfiguration', () => {
    const token = signEdDsaJwt(PAYLOAD, keys.privatePem);
    expectAppError(() => verifyEdDsaJwt(token, 'not-a-pem'), 'INTERNAL', 500);

    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
    expectAppError(
      () => verifyEdDsaJwt(token, rsa.export({ type: 'spki', format: 'pem' }).toString()),
      'INTERNAL',
      500,
    );
  });

  it('never echoes key material in the misconfiguration message', () => {
    const marker = 'super-secret-key-material';
    try {
      signEdDsaJwt(PAYLOAD, `-----BEGIN PRIVATE KEY-----\n${marker}\n-----END PRIVATE KEY-----`);
      throw new Error('expected signEdDsaJwt to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain(marker);
    }
  });
});
