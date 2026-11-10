// cloud/allowlist.test.ts — the scheduled-start allow-list fetch (C-20, DEC-021).
// The interesting part is honesty: every failure mode must come back as a classified reason the
// flow can log, and must never look like a valid list (a scheduled session that cannot read the
// user's allow-list must not start). No real HTTP: `fetchImpl` is a stub, which also lets us
// assert the exact URL and the device-token header without a live API.

import { describe, expect, it, vi } from 'vitest';
import type { AppEntry } from '@focus-mode/shared';
import { fetchAgentAllowList, AGENT_ALLOWLIST_PATH } from './allowlist.js';
import type { Logger } from '../log.js';

const BASE_URL = 'http://127.0.0.1:5000/api/v1';
const DEVICE_TOKEN = 'f3b2'.repeat(16);
const VSCODE: AppEntry = {
  key: 'vscode',
  label: 'Visual Studio Code',
  mac: ['com.microsoft.VSCode'],
};
const CHROME: AppEntry = { key: 'chrome', label: 'Google Chrome', mac: ['com.google.Chrome'] };

type LogFn = (message: string, ...meta: readonly unknown[]) => void;
const quietLogger: Logger = {
  error: vi.fn<LogFn>(),
  warn: vi.fn<LogFn>(),
  info: vi.fn<LogFn>(),
  debug: vi.fn<LogFn>(),
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function stubFetch(response: Response | (() => Response | Promise<Response>)): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return typeof response === 'function' ? response() : response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('fetchAgentAllowList — contract C-20', () => {
  it('GETs /agent/allowlist with the device token and returns the validated list', async () => {
    const { fetchImpl, calls } = stubFetch(
      jsonResponse(200, {
        success: true,
        data: { protectedApps: [CHROME], userApps: [VSCODE], version: 3 },
      }),
    );

    const result = await fetchAgentAllowList({
      baseUrl: BASE_URL,
      deviceToken: DEVICE_TOKEN,
      fetchImpl,
      logger: quietLogger,
    });

    expect(result).toEqual({
      ok: true,
      allowList: { protectedApps: [CHROME], userApps: [VSCODE], version: 3 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE_URL}${AGENT_ALLOWLIST_PATH}`);
    expect(AGENT_ALLOWLIST_PATH).toBe('/agent/allowlist');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${DEVICE_TOKEN}`);
    expect(calls[0]?.init?.method).toBe('GET');
  });

  it('defaults an empty list and version 0 instead of failing on omitted arrays', async () => {
    const { fetchImpl } = stubFetch(jsonResponse(200, { success: true, data: {} }));
    const result = await fetchAgentAllowList({
      baseUrl: BASE_URL,
      deviceToken: DEVICE_TOKEN,
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, allowList: { protectedApps: [], userApps: [], version: 0 } });
  });

  it('classifies a 401 as an honest UNAUTHENTICATED failure (never an empty allow-list)', async () => {
    const { fetchImpl } = stubFetch(
      jsonResponse(401, {
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'Device token rejected' },
      }),
    );
    const result = await fetchAgentAllowList({
      baseUrl: BASE_URL,
      deviceToken: DEVICE_TOKEN,
      fetchImpl,
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'UNAUTHENTICATED',
      status: 401,
      reason: 'Device token rejected',
    });
  });

  it('turns a 500 without an error envelope into a status-only reason', async () => {
    const { fetchImpl } = stubFetch(new Response('', { status: 500 }));
    const result = await fetchAgentAllowList({
      baseUrl: BASE_URL,
      deviceToken: DEVICE_TOKEN,
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(result.ok ? '' : result.reason).toContain('HTTP 500');
  });

  it('rejects a body that does not match the contract', async () => {
    const { fetchImpl } = stubFetch(
      jsonResponse(200, { success: true, data: { userApps: 'not-an-array', version: 2 } }),
    );
    const result = await fetchAgentAllowList({
      baseUrl: BASE_URL,
      deviceToken: DEVICE_TOKEN,
      fetchImpl,
    });
    expect(result).toEqual({
      ok: false,
      reason: 'the allow-list response did not match the contract',
    });
  });

  it('rejects an unrelated success envelope (no data)', async () => {
    const { fetchImpl } = stubFetch(jsonResponse(200, { success: true }));
    const result = await fetchAgentAllowList({
      baseUrl: BASE_URL,
      deviceToken: DEVICE_TOKEN,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
  });

  it('reports an unreachable API as a network failure, never as an empty list', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const result = await fetchAgentAllowList({
      baseUrl: BASE_URL,
      deviceToken: DEVICE_TOKEN,
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, reason: 'the cloud API could not be reached' });
  });
});
