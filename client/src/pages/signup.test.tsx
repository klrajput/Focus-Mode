/*
 * Signup form tests (T-021, FR-001): shared-zod validation, the 409 "email already registered"
 * copy, server field-level details (name/email/password only), the 429 lockout and the redirect to
 * the install → pair → focus checklist. The auth endpoint module is mocked so no transport is
 * exercised here (see api/endpoints/auth.test.ts).
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
import { SignupPage } from './signup';

vi.mock('../api/endpoints/auth', () => ({
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
  },
}));

const VALUES = { name: 'Kabir', email: 'kabir@demo.com', password: 'Kabir@123' };

function renderSignup() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={['/signup']}>
        <AuthProvider>
          <Routes>
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/dashboard" element={<div>dashboard destination</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function submit(
  user: ReturnType<typeof userEvent.setup>,
  values: { name: string; email: string; password: string } = VALUES,
): Promise<void> {
  await user.type(screen.getByLabelText(/name/i), values.name);
  await user.type(screen.getByLabelText(/email/i), values.email);
  await user.type(screen.getByLabelText(/password/i), values.password);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('SignupPage', () => {
  it('validates with the shared schema before calling the API', async () => {
    const user = userEvent.setup();
    renderSignup();

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Expected a valid email address')).toBeInTheDocument();
    expect(vi.mocked(authApi.register)).not.toHaveBeenCalled();
  });

  it('registers, signs in and lands on the welcome checklist', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.register).mockResolvedValue({
      accessToken: 'test-token',
      user: makeUser({ name: 'Kabir' }),
    });

    renderSignup();

    await submit(user);

    expect(await screen.findByText('dashboard destination')).toBeInTheDocument();
    expect(vi.mocked(authApi.register)).toHaveBeenCalledWith(VALUES);
  });

  it('shows the email-taken copy for a 409 CONFLICT', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.register).mockRejectedValue(new ApiError('CONFLICT', 409, 'Conflict'));

    renderSignup();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with that email already exists. Try logging in.',
    );
  });

  it('renders server details for known fields and ignores unknown paths', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.register).mockRejectedValue(
      new ApiError('VALIDATION_ERROR', 400, 'Request validation failed', [
        { path: 'name', message: 'Name is already taken.' },
        { path: 'email', message: 'Email is already taken.' },
        { path: 'password', message: 'Password is too common.' },
        { path: 'role', message: 'This field is not on the form.' },
      ]),
    );

    renderSignup();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check the highlighted fields and try again.',
    );
    expect(await screen.findByText('Name is already taken.')).toBeInTheDocument();
    expect(screen.getByText('Email is already taken.')).toBeInTheDocument();
    expect(screen.getByText('Password is too common.')).toBeInTheDocument();
    expect(screen.queryByText('This field is not on the form.')).not.toBeInTheDocument();
  });

  it('locks submit after a 429 rate limit', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.register).mockRejectedValue(new ApiError('RATE_LIMITED', 429, 'Slow down'));

    renderSignup();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please wait a minute and try again.',
    );
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    expect(screen.getByText('Try again in 60 seconds.')).toBeInTheDocument();
  });

  it('shows the account-disabled copy', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.register).mockRejectedValue(
      new ApiError('ACCOUNT_DISABLED', 403, 'Account disabled'),
    );

    renderSignup();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This account has been disabled. Contact an admin if you think this is a mistake.',
    );
  });

  it('maps an unexpected contract code through the shared error copy', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.register).mockRejectedValue(new ApiError('FORBIDDEN', 403, 'Forbidden'));

    renderSignup();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You don't have permission to do that.",
    );
  });

  it('shows the internal copy for a transport failure', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.register).mockRejectedValue(new TypeError('Failed to fetch'));

    renderSignup();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Please try again.',
    );
  });
});
