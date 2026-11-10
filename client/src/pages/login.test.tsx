/*
 * Login form tests (T-021): shared-zod validation before any network call, and a successful submit
 * that stores the session and redirects to /dashboard. The auth endpoint module is mocked so the
 * test asserts the UI contract, not the transport (covered in api/http.test.ts).
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { authApi } from '../api/endpoints/auth';
import { ApiError } from '../api/errors';
import { AuthProvider } from '../auth/auth-provider';
import { createTestQueryClient, makeUser } from '../test/test-utils';
import { LoginPage } from './login';

vi.mock('../api/endpoints/auth', () => ({
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
  },
}));

function renderLogin() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<div>dashboard destination</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  it('shows inline field errors and does not call the API for invalid input', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Expected a valid email address')).toBeInTheDocument();
    expect(vi.mocked(authApi.login)).not.toHaveBeenCalled();
  });

  it('submits valid credentials, stores the session and redirects', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockResolvedValue({
      accessToken: 'test-token',
      user: makeUser({ email: 'kabir@demo.com' }),
    });

    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'kabir@demo.com');
    await user.type(screen.getByLabelText(/password/i), 'Kabir@123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('dashboard destination')).toBeInTheDocument();
    expect(vi.mocked(authApi.login)).toHaveBeenCalledWith({
      email: 'kabir@demo.com',
      password: 'Kabir@123',
    });
  });

  it('shows the rejected-credentials banner for a 401', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError('UNAUTHENTICATED', 401, 'Invalid credentials'),
    );

    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'kabir@demo.com');
    await user.type(screen.getByLabelText(/password/i), 'WrongPass1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.queryByText('dashboard destination')).not.toBeInTheDocument();
  });
});
