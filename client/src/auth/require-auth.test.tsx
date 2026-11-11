/*
 * Route-guard tests (T-020, TECHNICAL_DESIGN §3). `RequireAuth` must never render protected
 * content on a guess: rehydration shows a loading state, anonymous visitors are redirected to
 * /login with the attempted path+query, and a non-401 failure shows a retryable error.
 * `PublicOnly` keeps an authenticated visitor away from the auth forms.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { ERROR_MESSAGES } from '../copy/errors';
import { makeAuthValue, makeUser } from '../test/test-utils';
import { AuthContext, type AuthContextValue } from './auth-context';
import { PublicOnly, RequireAuth } from './require-auth';

function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '(none)';
  return <div>login from {from}</div>;
}

function renderGuarded(value: AuthContextValue, entry = '/focus?tab=sessions') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthContext.Provider value={value}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/focus" element={<div>protected focus</div>} />
          </Route>
          <Route element={<PublicOnly />}>
            <Route path="/login" element={<div>login form</div>} />
          </Route>
          <Route path="/redirected-login" element={<LoginProbe />} />
          <Route path="/dashboard" element={<div>dashboard destination</div>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('RequireAuth', () => {
  it('shows the session-check loading state while the token is rehydrated', () => {
    renderGuarded(makeAuthValue({ status: 'loading' }));

    expect(screen.getByRole('status')).toHaveTextContent('Checking your session…');
    expect(screen.queryByText('protected focus')).not.toBeInTheDocument();
  });

  it('redirects an anonymous visitor to /login with the attempted path and query', () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/focus', search: '?tab=sessions' }]}>
        <AuthContext.Provider value={makeAuthValue({ status: 'anonymous' })}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="/focus" element={<div>protected focus</div>} />
            </Route>
            <Route path="/login" element={<LoginProbe />} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText('login from /focus?tab=sessions')).toBeInTheDocument();
    expect(screen.queryByText('protected focus')).not.toBeInTheDocument();
  });

  it('renders the protected outlet for an authenticated user', () => {
    renderGuarded(makeAuthValue({ status: 'authenticated', user: makeUser() }));

    expect(screen.getByText('protected focus')).toBeInTheDocument();
  });

  it('renders a retryable honest error when the account lookup failed', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    renderGuarded(makeAuthValue({ status: 'error', retry }));

    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load your account.");
    expect(screen.getByText(ERROR_MESSAGES.INTERNAL)).toBeInTheDocument();
    expect(screen.queryByText('protected focus')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('PublicOnly', () => {
  it('shows the loading state while rehydrating', () => {
    renderGuarded(makeAuthValue({ status: 'loading' }), '/login');

    expect(screen.getByRole('status')).toHaveTextContent('Checking your session…');
    expect(screen.queryByText('login form')).not.toBeInTheDocument();
  });

  it('sends an authenticated visitor to the dashboard', () => {
    renderGuarded(makeAuthValue({ status: 'authenticated', user: makeUser() }), '/login');

    expect(screen.getByText('dashboard destination')).toBeInTheDocument();
    expect(screen.queryByText('login form')).not.toBeInTheDocument();
  });

  it('renders the form for an anonymous visitor', () => {
    renderGuarded(makeAuthValue({ status: 'anonymous' }), '/login');

    expect(screen.getByText('login form')).toBeInTheDocument();
  });
});
