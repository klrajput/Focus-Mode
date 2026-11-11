/*
 * Login form tests (T-021): shared-zod validation before any network call, the declared banner for
 * every error the API can return (401/403/ACCOUNT_DISABLED/409/429/validation/transport), the real
 * submitting state, the 60-second rate-limit lockout and the safe redirect to the attempted route.
 * The auth endpoint module is mocked so the test asserts the UI contract, not the transport
 * (covered in api/http.test.ts and api/endpoints/auth.test.ts).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { authApi } from '../api/endpoints/auth';
import { ApiError } from '../api/errors';
import type { AuthResult } from '../api/types';
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

const CREDENTIALS = { email: 'kabir@demo.com', password: 'Kabir@123' };

afterEach(() => {
  // The 429 test installs fake timers; never let them leak into the next spec.
  vi.useRealTimers();
});

const SIGNED_IN: AuthResult = {
  accessToken: 'test-token',
  user: makeUser({ email: 'kabir@demo.com' }),
};

type LoginEntry = string | { pathname: string; state?: unknown };

function renderLogin(entry: LoginEntry = '/login') {
  const initialEntry = typeof entry === 'string' ? entry : entry;
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<div>dashboard destination</div>} />
            <Route path="/focus" element={<div>focus destination</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function submit(
  user: ReturnType<typeof userEvent.setup>,
  values: { email: string; password: string } = CREDENTIALS,
): Promise<void> {
  await user.type(screen.getByLabelText(/email/i), values.email);
  await user.type(screen.getByLabelText(/password/i), values.password);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
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
    vi.mocked(authApi.login).mockResolvedValue(SIGNED_IN);

    renderLogin();

    await submit(user);

    expect(await screen.findByText('dashboard destination')).toBeInTheDocument();
    expect(vi.mocked(authApi.login)).toHaveBeenCalledWith(CREDENTIALS);
  });

  it('shows the rejected-credentials banner for a 401', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError('UNAUTHENTICATED', 401, 'Invalid credentials'),
    );

    renderLogin();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.queryByText('dashboard destination')).not.toBeInTheDocument();
  });

  it('shows the generic internal copy for a transport failure, not the 401 sentence', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockRejectedValue(new TypeError('Failed to fetch'));

    renderLogin();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Please try again.',
    );
    expect(screen.queryByText('Email or password is incorrect.')).not.toBeInTheDocument();
  });

  it('shows the account-disabled copy for ACCOUNT_DISABLED', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError('ACCOUNT_DISABLED', 403, 'Account disabled'),
    );

    renderLogin();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This account has been disabled. Contact an admin if you think this is a mistake.',
    );
  });

  it('shows the email-taken copy for a 409 CONFLICT', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockRejectedValue(new ApiError('CONFLICT', 409, 'Conflict'));

    renderLogin();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with that email already exists. Try logging in.',
    );
  });

  it('maps an unexpected contract code through the shared error copy', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockRejectedValue(new ApiError('FORBIDDEN', 403, 'Forbidden'));

    renderLogin();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You don't have permission to do that.",
    );
  });

  it('renders server validation details on the matching fields only', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError('VALIDATION_ERROR', 400, 'Request validation failed', [
        { path: 'email', message: 'That email address is not allowed.' },
        { path: 'name', message: 'This field does not exist on the login form.' },
      ]),
    );

    renderLogin();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check the highlighted fields and try again.',
    );
    expect(await screen.findByText('That email address is not allowed.')).toBeInTheDocument();
    expect(
      screen.queryByText('This field does not exist on the login form.'),
    ).not.toBeInTheDocument();
  });

  it('keeps the label in place and disables submit while the request is in flight', async () => {
    const user = userEvent.setup();
    let finish: (result: AuthResult) => void = () => undefined;
    vi.mocked(authApi.login).mockReturnValue(
      new Promise<AuthResult>((resolve) => {
        finish = resolve;
      }),
    );

    renderLogin();

    await submit(user);

    const button = await screen.findByRole('button', { name: 'Logging in…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    finish(SIGNED_IN);

    expect(await screen.findByText('dashboard destination')).toBeInTheDocument();
  });

  it('locks submit and shows the countdown after a 429', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockRejectedValue(new ApiError('RATE_LIMITED', 429, 'Slow down'));

    renderLogin();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please wait a minute and try again.',
    );
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDisabled();
    expect(screen.getByText('Try again in 60 seconds.')).toBeInTheDocument();
    expect(vi.mocked(authApi.login)).toHaveBeenCalledTimes(1);
  });

  it('re-enables submit when the rate-limit window elapses', async () => {
    // userEvent is unusable under fake timers in this jsdom setup, so drive the form with
    // fireEvent and step the countdown explicitly.
    vi.useFakeTimers();
    vi.mocked(authApi.login).mockRejectedValue(new ApiError('RATE_LIMITED', 429, 'Slow down'));

    renderLogin();
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: CREDENTIALS.email },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: CREDENTIALS.password },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    });

    expect(screen.getByText('Try again in 60 seconds.')).toBeInTheDocument();
    expect(vi.mocked(authApi.login)).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('Try again in 59 seconds.')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(58_000);
    });
    expect(screen.getByText('Try again in 1 second.')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
    expect(screen.queryByText(/Try again in/)).not.toBeInTheDocument();
  });

  it('returns the user to the attempted route after a successful login', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockResolvedValue(SIGNED_IN);

    renderLogin({ pathname: '/login', state: { from: '/focus' } });

    await submit(user);

    expect(await screen.findByText('focus destination')).toBeInTheDocument();
  });

  it('ignores an off-site redirect target instead of becoming an open redirect', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockResolvedValue(SIGNED_IN);

    renderLogin({ pathname: '/login', state: { from: '//evil.example/steal' } });

    await submit(user);

    expect(await screen.findByText('dashboard destination')).toBeInTheDocument();
  });

  it('clears the previous banner when the user retries', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login)
      .mockRejectedValueOnce(new ApiError('UNAUTHENTICATED', 401, 'Invalid credentials'))
      .mockResolvedValueOnce(SIGNED_IN);

    renderLogin();

    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');

    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('dashboard destination')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
