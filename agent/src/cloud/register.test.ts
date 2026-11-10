// cloud/register.test.ts — the DEC-014 digest, request shape and error mapping of
// `POST /agent/register` (T-042). The digest vectors are hard-coded from DEC-014 so a refactor
// cannot silently change what the server is asked to store; the code itself never appears in the
// request body, a log line or an error message.

import { describe, expect, it, vi } from 'vitest';
import { deviceRegisterSchema } from '@focus-mode/shared';
import {
  computePairingCodeDigest,
  deviceNameFromHostname,
  PairingCodeCollisionError,
  registerDevice,
} from './register.js';
import { CloudApiError, CloudNetworkError } from './transport.js';

const BASE_URL = 'http://localhost:5000/api/v1';
const DEVICE_ID = '507f1f77bcf86cd799439011';
const ENROLL_SECRET = 'q8Zt3n0rG6mJ2xV5cB1kL9pA4sD7fH0wAbCdEfGh';

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeFetch(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

type LogFn = (message: string, ...meta: readonly unknown[]) => void;

const logger = {
  error: vi.fn<LogFn>(),
  warn: vi.fn<LogFn>(),
  info: vi.fn<LogFn>(),
  debug: vi.fn<LogFn>(),
};

describe('computePairingCodeDigest (DEC-014)', () => {
  it('is the domain-separated lowercase SHA-256 of the code', () => {
    // Vectors computed once from the frozen DEC-014 definition:
    // sha256("focus-mode-pair-v1|" + code) as lowercase hex.
    expect(computePairingCodeDigest('123456')).toBe(
      '21be001775e222ef7a416759635203016b3b12cc9e3643ac119046ab81f9bba4',
    );
    expect(computePairingCodeDigest('000123')).toBe(
      '619a5d147d3bf3c20cd284ff6b507a4d79fb5de5654c4946233c660c66dfe116',
    );
  });

  it('is 64 lowercase hex characters and stable across calls', () => {
    const digest = computePairingCodeDigest('483920');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(computePairingCodeDigest('483920')).toBe(digest);
    expect(digest).not.toBe(computePairingCodeDigest('483921'));
  });

  it('is domain-separated from a bare SHA-256 of the code', () => {
    // Same algorithm, different pre-image: the domain prefix is what the server repeats.
    expect(computePairingCodeDigest('123456')).not.toBe(
      '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
    );
  });
});

describe('deviceNameFromHostname (contract C-06)', () => {
  it('trims, collapses whitespace and keeps a normal hostname', () => {
    expect(deviceNameFromHostname('  Kabir-MacBook  ')).toBe('Kabir-MacBook');
    expect(deviceNameFromHostname('Kabir   Laptop')).toBe('Kabir Laptop');
  });

  it('falls back to a neutral name when the hostname is too short', () => {
    expect(deviceNameFromHostname('')).toBe('Focus Agent');
    expect(deviceNameFromHostname(' x ')).toBe('Focus Agent');
  });

  it('caps the name at the 60-character schema bound', () => {
    expect(deviceNameFromHostname('k'.repeat(120))).toHaveLength(60);
  });
});

describe('registerDevice', () => {
  it('POSTs only the digest, os, name and version to /agent/register', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse(201, {
        success: true,
        data: { deviceId: DEVICE_ID, enrollSecret: ENROLL_SECRET },
      }),
    );

    const result = await registerDevice({
      baseUrl: BASE_URL,
      code: '483920',
      os: 'macOS',
      name: 'Kabir-MacBook',
      agentVersion: '0.1.0',
      fetchImpl,
      logger,
    });

    expect(result).toEqual({ deviceId: DEVICE_ID, enrollSecret: ENROLL_SECRET });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE_URL}/agent/register`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toMatchObject({ 'Content-Type': 'application/json' });

    const body: unknown = JSON.parse(String(calls[0]?.init?.body));
    const parsed = deviceRegisterSchema.parse(body);
    expect(parsed).toEqual({
      codeHmac: computePairingCodeDigest('483920'),
      os: 'macOS',
      name: 'Kabir-MacBook',
      agentVersion: '0.1.0',
    });
    // DEC-003/DEC-014: the plaintext code never reaches the cloud or the log.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('483920');
    const logged = JSON.stringify(logger.debug.mock.calls) + JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain('483920');
  });

  it('maps 409 CONFLICT to PairingCodeCollisionError so the caller can rotate the code', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(409, {
        success: false,
        error: { code: 'CONFLICT', message: 'Pairing digest already pending' },
      }),
    );

    await expect(
      registerDevice({
        baseUrl: BASE_URL,
        code: '483920',
        os: 'macOS',
        name: 'Kabir-MacBook',
        agentVersion: '0.1.0',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(PairingCodeCollisionError);
  });

  it('keeps the shared error code on HTTP failures', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(400, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' },
      }),
    );

    const error = await registerDevice({
      baseUrl: BASE_URL,
      code: '483920',
      os: 'macOS',
      name: 'Kabir-MacBook',
      agentVersion: '0.1.0',
      fetchImpl,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CloudApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('rejects an unexpected success payload instead of pairing on garbage', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(201, { success: true, data: { deviceId: 'not-an-object-id' } }),
    );

    const error = await registerDevice({
      baseUrl: BASE_URL,
      code: '483920',
      os: 'macOS',
      name: 'Kabir-MacBook',
      agentVersion: '0.1.0',
      fetchImpl,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CloudApiError);
    expect((error as CloudApiError).message).toMatch(/unexpected payload/);
  });

  it('reports an unreachable cloud as a retryable CloudNetworkError', async () => {
    const { fetchImpl } = fakeFetch(() => Promise.reject(new Error('ECONNREFUSED')));

    await expect(
      registerDevice({
        baseUrl: BASE_URL,
        code: '483920',
        os: 'macOS',
        name: 'Kabir-MacBook',
        agentVersion: '0.1.0',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(CloudNetworkError);
  });

  it('validates the device name before doing any I/O', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse(201, {
        success: true,
        data: { deviceId: DEVICE_ID, enrollSecret: ENROLL_SECRET },
      }),
    );

    await expect(
      registerDevice({
        baseUrl: BASE_URL,
        code: '483920',
        os: 'macOS',
        name: 'x',
        agentVersion: '0.1.0',
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
