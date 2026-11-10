/*
 * HTTP transport tests (T-022): envelope unwrapping, error normalisation, Bearer auth and the
 * 401 → clear-token + session-expiry-notify path. The API base comes from VITE_API_BASE_URL
 * (DEC-013 — full base including `/api/v1`); `fetch` is stubbed so no server is required.
 */

import { describe, expect, it, vi } from 'vitest';

import { copyForCode } from '../copy/errors';
import { ApiError, isApiError } from './errors';
import { apiRequest } from './http';
import { clearAccessToken, getAccessToken, setAccessToken } from './token-storage';
import { onUnauthorized } from './unauthorized';

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('apiRequest', () => {
  it('unwraps {success:true,data} and sends the Bearer token', async () => {
    setAccessToken('token-abc');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fakeResponse({ success: true, data: { id: 'user-1', role: 'USER' } }));
    vi.stubGlobal('fetch', fetchMock);

    const data = await apiRequest<{ id: string; role: string }>('/auth/me');

    expect(data).toEqual({ id: 'user-1', role: 'USER' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:5000/api/v1/auth/me');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-abc');
    expect(new Headers(init.headers).get('Accept')).toBe('application/json');
  });

  it('normalises a {success:false,error} envelope into ApiError with details[]', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: [{ path: 'password', message: 'Password must be at least 8 characters' }],
          },
        },
        400,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const error = await apiRequest('/auth/login', { method: 'POST', body: {} }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ApiError);
    if (!isApiError(error)) throw new Error('expected an ApiError');

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.status).toBe(400);
    expect(error.details).toEqual([
      { path: 'password', message: 'Password must be at least 8 characters' },
    ]);
    expect(copyForCode(error.code)).toBe('Check the highlighted fields and try again.');
  });

  it('clears the token and notifies on a 401 from an authenticated request', async () => {
    setAccessToken('token-abc');
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse(
          {
            success: false,
            error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
          },
          401,
        ),
      ),
    );

    await expect(apiRequest('/auth/me')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });

    expect(getAccessToken()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not treat a 401 from a public login request as session expiry', async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          fakeResponse(
            { success: false, error: { code: 'UNAUTHENTICATED', message: 'Invalid credentials' } },
            401,
          ),
        ),
    );

    await expect(
      apiRequest('/auth/login', { method: 'POST', body: {}, auth: false }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('normalises a transport failure into an INTERNAL ApiError with status 0', async () => {
    clearAccessToken();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await apiRequest('/sessions').catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    if (!isApiError(error)) throw new Error('expected an ApiError');

    expect(error.code).toBe('INTERNAL');
    expect(error.status).toBe(0);
    expect(copyForCode(error.code)).toBe('Something went wrong on our side. Please try again.');
  });
});
