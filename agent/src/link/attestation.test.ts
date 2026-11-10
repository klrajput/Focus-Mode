// link/attestation.test.ts — the EdDSA attestation verification matrix (T-044, REC-003, SEC-7).
// Uses real Ed25519 keys and real signatures, so the only thing "mocked" is the HTTP fetch of the
// public key. Every failure mode of the handshake is asserted with its exact rejection reason,
// which is what keeps a hostile page (or a replayed token) from unlocking focus control.

import { generateKeyPairSync, sign as signBytes, type KeyObject } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AttestationGate,
  DEFAULT_KEY_CACHE_TTL_MS,
  fetchAttestKey,
  verifyAttestationJwt,
} from './attestation.js';
import { CloudApiError } from '../cloud/transport.js';

const DEVICE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const NONCE = 'abcdefghijklmnopqrstuvwxyz012345';
const NOW = new Date('2026-11-10T10:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const otherKeys = generateKeyPairSync('ed25519');
const rsaKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PUBLIC_KEY_PEM = rsaKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function signAttestation(options: {
  readonly claims?: Record<string, unknown>;
  readonly header?: Record<string, unknown>;
  readonly key?: KeyObject;
}): string {
  const header = { alg: 'EdDSA', typ: 'JWT', ...options.header };
  const payload = options.claims ?? validClaims();
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = signBytes(
    null,
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
    options.key ?? privateKey,
  );
  return `${encodedHeader}.${encodedPayload}.${signature.toString('base64url')}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aud: DEVICE_ID,
    sub: USER_ID,
    nonce: NONCE,
    exp: NOW_SECONDS + 60,
    iat: NOW_SECONDS,
    ...overrides,
  };
}

const EXPECTED = { nonce: NONCE, deviceId: DEVICE_ID, userId: USER_ID };

describe('verifyAttestationJwt', () => {
  it('accepts a valid EdDSA attestation bound to nonce, device and owner', () => {
    const result = verifyAttestationJwt({
      token: signAttestation({}),
      publicKeyPem: PUBLIC_KEY_PEM,
      expected: EXPECTED,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, deviceId: DEVICE_ID, userId: USER_ID });
    if (result.ok) expect(result.expiresAt.toISOString()).toBe('2026-11-10T10:01:00.000Z');
  });

  it('rejects a token issued for a different nonce (single use / replay)', () => {
    const result = verifyAttestationJwt({
      token: signAttestation({ claims: validClaims({ nonce: 'someOtherChallengeNonce123' }) }),
      publicKeyPem: PUBLIC_KEY_PEM,
      expected: EXPECTED,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', reason: 'NONCE_MISMATCH' });
  });

  it('rejects a token bound to another device (aud)', () => {
    const result = verifyAttestationJwt({
      token: signAttestation({
        claims: validClaims({ aud: '507f1f77bcf86cd799439099' }),
      }),
      publicKeyPem: PUBLIC_KEY_PEM,
      expected: EXPECTED,
      now: NOW,
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'UNAUTHENTICATED',
      reason: 'AUDIENCE_MISMATCH',
    });
  });

  it('rejects a correctly signed token for another account (sub) with FORBIDDEN', () => {
    const result = verifyAttestationJwt({
      token: signAttestation({
        claims: validClaims({ sub: '507f1f77bcf86cd799439099' }),
      }),
      publicKeyPem: PUBLIC_KEY_PEM,
      expected: EXPECTED,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN', reason: 'SUBJECT_MISMATCH' });
  });

  it('rejects an expired token', () => {
    const result = verifyAttestationJwt({
      token: signAttestation({ claims: validClaims({ exp: NOW_SECONDS - 1 }) }),
      publicKeyPem: PUBLIC_KEY_PEM,
      expected: EXPECTED,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', reason: 'EXPIRED' });
  });

  it('rejects a token whose lifetime exceeds the 60 s contract bound', () => {
    const result = verifyAttestationJwt({
      token: signAttestation({ claims: validClaims({ exp: NOW_SECONDS + 61 }) }),
      publicKeyPem: PUBLIC_KEY_PEM,
      expected: EXPECTED,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', reason: 'TTL_TOO_LONG' });
  });

  it('rejects a token that is not valid yet', () => {
    const result = verifyAttestationJwt({
      token: signAttestation({ claims: validClaims({ nbf: NOW_SECONDS + 30 }) }),
      publicKeyPem: PUBLIC_KEY_PEM,
      expected: EXPECTED,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', reason: 'NOT_YET_VALID' });
  });

  it('rejects a signature made by another key', () => {
    const result = verifyAttestationJwt({
      token: signAttestation({ key: otherKeys.privateKey }),
      publicKeyPem: PUBLIC_KEY_PEM,
      expected: EXPECTED,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', reason: 'BAD_SIGNATURE' });
  });

  it('rejects a payload tampered with after signing', () => {
    const token = signAttestation({});
    const [header, , signature] = token.split('.');
    const tampered = base64url(JSON.stringify(validClaims({ nonce: 'tamperedNonceValue1234' })));
    const result = verifyAttestationJwt({
      token: `${header ?? ''}.${tampered}.${signature ?? ''}`,
      publicKeyPem: PUBLIC_KEY_PEM,
      expected: EXPECTED,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', reason: 'BAD_SIGNATURE' });
  });

  it('pins the algorithm to EdDSA (no HS256/none confusion)', () => {
    for (const alg of ['HS256', 'none', 'RS256']) {
      const result = verifyAttestationJwt({
        token: signAttestation({ header: { alg } }),
        publicKeyPem: PUBLIC_KEY_PEM,
        expected: EXPECTED,
        now: NOW,
      });
      expect(result, alg).toMatchObject({
        ok: false,
        code: 'UNAUTHENTICATED',
        reason: 'UNSUPPORTED_ALGORITHM',
      });
    }
  });

  it('rejects malformed compact JWTs', () => {
    for (const token of ['', 'not-a-jwt', 'a.b', 'a.b.c', '..']) {
      const result = verifyAttestationJwt({
        token,
        publicKeyPem: PUBLIC_KEY_PEM,
        expected: EXPECTED,
        now: NOW,
      });
      expect(result.ok, token).toBe(false);
    }
  });

  it('rejects an unknown key type or an unparseable key', () => {
    const rsa = verifyAttestationJwt({
      token: signAttestation({}),
      publicKeyPem: RSA_PUBLIC_KEY_PEM,
      expected: EXPECTED,
      now: NOW,
    });
    expect(rsa).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', reason: 'KEY_UNUSABLE' });

    const garbage = verifyAttestationJwt({
      token: signAttestation({}),
      publicKeyPem: 'not a pem',
      expected: EXPECTED,
      now: NOW,
    });
    expect(garbage).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', reason: 'KEY_UNUSABLE' });
  });

  it('requires an expiry claim', () => {
    const claims = validClaims();
    delete claims['exp'];
    const result = verifyAttestationJwt({
      token: signAttestation({ claims }),
      publicKeyPem: PUBLIC_KEY_PEM,
      expected: EXPECTED,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', reason: 'MALFORMED_TOKEN' });
  });
});

describe('fetchAttestKey', () => {
  it('reads the PEM from the success envelope', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: { publicKey: PUBLIC_KEY_PEM, algorithm: 'EdDSA' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    await expect(
      fetchAttestKey({ baseUrl: 'http://localhost:5000/api/v1', fetchImpl }),
    ).resolves.toBe(PUBLIC_KEY_PEM);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:5000/api/v1/agent/attest-key',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('refuses a key that is not declared as EdDSA', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(
        JSON.stringify({ success: true, data: { publicKey: PUBLIC_KEY_PEM, algorithm: 'RS256' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    await expect(
      fetchAttestKey({ baseUrl: 'http://localhost:5000/api/v1', fetchImpl }),
    ).rejects.toThrow(/unexpected payload/);
  });

  it('surfaces API errors with the shared code', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(
        JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'boom' } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );

    await expect(
      fetchAttestKey({ baseUrl: 'http://localhost:5000/api/v1', fetchImpl }),
    ).rejects.toBeInstanceOf(CloudApiError);
  });
});

describe('AttestationGate', () => {
  function makeGate(
    overrides: {
      fetchPublicKey?: () => Promise<string>;
      binding?: { deviceId: string; userId: string } | null;
      now?: () => Date;
    } = {},
  ): {
    gate: AttestationGate;
    fetchPublicKey: ReturnType<typeof vi.fn>;
  } {
    const fetchPublicKey = vi.fn(overrides.fetchPublicKey ?? (async () => PUBLIC_KEY_PEM));
    const gate = new AttestationGate({
      baseUrl: 'http://localhost:5000/api/v1',
      getBinding:
        overrides.binding === undefined
          ? () => ({ deviceId: DEVICE_ID, userId: USER_ID })
          : () => overrides.binding ?? null,
      fetchPublicKey,
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
    });
    return { gate, fetchPublicKey };
  }

  it('caches the public key for ~10 minutes', async () => {
    let nowMs = NOW.getTime();
    const { gate, fetchPublicKey } = makeGate({ now: () => new Date(nowMs) });
    const token = signAttestation({});

    await expect(gate.verify({ token, nonce: NONCE })).resolves.toMatchObject({ ok: true });
    await expect(gate.verify({ token, nonce: NONCE })).resolves.toMatchObject({ ok: true });
    expect(fetchPublicKey).toHaveBeenCalledTimes(1);

    nowMs += DEFAULT_KEY_CACHE_TTL_MS + 1;
    // A fresh 60 s attestation: the cached key is what is under test, not the token TTL.
    const laterSeconds = Math.floor(nowMs / 1000);
    const laterToken = signAttestation({
      claims: validClaims({ exp: laterSeconds + 60, iat: laterSeconds }),
    });
    await expect(gate.verify({ token: laterToken, nonce: NONCE })).resolves.toMatchObject({
      ok: true,
    });
    expect(fetchPublicKey).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed key fetch', async () => {
    const fetchPublicKey = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(PUBLIC_KEY_PEM);
    const gate = new AttestationGate({
      baseUrl: 'http://localhost:5000/api/v1',
      getBinding: () => ({ deviceId: DEVICE_ID, userId: USER_ID }),
      fetchPublicKey,
      now: () => NOW,
    });

    const token = signAttestation({});
    await expect(gate.verify({ token, nonce: NONCE })).resolves.toMatchObject({
      ok: false,
      reason: 'KEY_UNAVAILABLE',
    });
    await expect(gate.verify({ token, nonce: NONCE })).resolves.toMatchObject({ ok: true });
    expect(fetchPublicKey).toHaveBeenCalledTimes(2);
  });

  it('fails closed without a pairing (no key fetch at all)', async () => {
    const { gate, fetchPublicKey } = makeGate({ binding: null });
    const result = await gate.verify({ token: signAttestation({}), nonce: NONCE });
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED', reason: 'NOT_PAIRED' });
    expect(fetchPublicKey).not.toHaveBeenCalled();
  });

  it('can drop a cached key after a re-pair', async () => {
    const { gate, fetchPublicKey } = makeGate();
    const token = signAttestation({});
    await gate.verify({ token, nonce: NONCE });
    gate.invalidateKey();
    await gate.verify({ token, nonce: NONCE });
    expect(fetchPublicKey).toHaveBeenCalledTimes(2);
  });
});
