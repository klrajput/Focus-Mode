/*
 * Auth endpoint wiring (INTEGRATION_CONTRACTS §3.1 #2–#5). The transport itself is covered in
 * api/http.test.ts; these tests pin what the auth module promises: login/register are public
 * (`auth: false`, so a stale token is never attached) and logout/me always send the Bearer token.
 */

import { describe, expect, it, vi } from 'vitest';

import { setAccessToken } from '../token-storage';
import { authApi } from './auth';

const AUTH_RESULT = {
  accessToken: 'fresh-token',
  user: { id: '507f1f77bcf86cd799439012', role: 'USER' },
};

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function installFetch(body: unknown = { success: true, data: AUTH_RESULT }) {
  const fetchMock = vi.fn().mockResolvedValue(fakeResponse(body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function callOf(fetchMock: ReturnType<typeof installFetch>): [string, RequestInit] {
  return fetchMock.mock.calls[0] as [string, RequestInit];
}

function authorizationOf(init: RequestInit): string | null {
  return new Headers(init.headers).get('Authorization');
}

describe('authApi', () => {
  it('posts login credentials without a stale bearer token', async () => {
    setAccessToken('stale-token');
    const fetchMock = installFetch();
    const input = { email: 'kabir@demo.com', password: 'Kabir@123' };

    await expect(authApi.login(input)).resolves.toEqual(AUTH_RESULT);

    const [url, init] = callOf(fetchMock);
    expect(url).toBe('http://localhost:5000/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(input);
    expect(authorizationOf(init)).toBeNull();
  });

  it('posts registration without a stale bearer token', async () => {
    setAccessToken('stale-token');
    const fetchMock = installFetch();
    const input = { name: 'Kabir', email: 'kabir@demo.com', password: 'Kabir@123' };

    await expect(authApi.register(input)).resolves.toEqual(AUTH_RESULT);

    const [url, init] = callOf(fetchMock);
    expect(url).toBe('http://localhost:5000/api/v1/auth/register');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(input);
    expect(authorizationOf(init)).toBeNull();
  });

  it('sends the bearer token on logout', async () => {
    setAccessToken('token-abc');
    const fetchMock = installFetch({ success: true, data: { loggedOut: true } });

    await expect(authApi.logout()).resolves.toEqual({ loggedOut: true });

    const [url, init] = callOf(fetchMock);
    expect(url).toBe('http://localhost:5000/api/v1/auth/logout');
    expect(init.method).toBe('POST');
    expect(authorizationOf(init)).toBe('Bearer token-abc');
  });

  it('fetches the current user with the bearer token', async () => {
    setAccessToken('token-abc');
    const user = { id: '507f1f77bcf86cd799439012', role: 'USER' };
    const fetchMock = installFetch({ success: true, data: user });

    await expect(authApi.me()).resolves.toEqual(user);

    const [url, init] = callOf(fetchMock);
    expect(url).toBe('http://localhost:5000/api/v1/auth/me');
    expect(init.method).toBe('GET');
    expect(authorizationOf(init)).toBe('Bearer token-abc');
  });
});
