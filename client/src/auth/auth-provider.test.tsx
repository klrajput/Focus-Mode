/*
 * AuthProvider session-expiry test (T-022): a 401 notified by the HTTP client must clear the token,
 * drop the cached user and land on /login. The endpoint module is mocked; the 401 is delivered via
 * the real `onUnauthorized` seam that `api/http.ts` uses, so this covers the wiring, not a stub of it.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { authApi } from '../api/endpoints/auth';
import { ApiError } from '../api/errors';
import { getAccessToken, setAccessToken } from '../api/token-storage';
import { notifyUnauthorized } from '../api/unauthorized';
import { createTestQueryClient, makeUser } from '../test/test-utils';
import { AuthProvider } from './auth-provider';
import { RequireAuth } from './require-auth';

vi.mock('../api/endpoints/auth', () => ({
  authApi: {
    me: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  },
}));

function renderPrivateRoute() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="/dashboard" element={<div>private dashboard</div>} />
            </Route>
            <Route path="/login" element={<div>login page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AuthProvider', () => {
  it('clears the token and redirects to /login when a 401 is notified', async () => {
    setAccessToken('token-abc');
    vi.mocked(authApi.me).mockResolvedValue(makeUser());

    renderPrivateRoute();

    expect(await screen.findByText('private dashboard')).toBeInTheDocument();

    act(() => {
      notifyUnauthorized(new ApiError('UNAUTHENTICATED', 401, 'Authentication required'));
    });

    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
  });
});
