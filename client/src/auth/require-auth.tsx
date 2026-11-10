/*
 * Route guards (T-020, TECHNICAL_DESIGN §3).
 * `RequireAuth` gates every private route; an anonymous visitor is sent to /login with the
 * attempted path in router state so the form can return them there. While the token is being
 * rehydrated it renders a loading state, and a non-401 `/auth/me` failure renders a retryable
 * error — the app never renders protected content on a guess.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { ErrorState } from '../components/ui/error-state';
import { PageLoading } from '../components/ui/loading';
import { ERROR_MESSAGES } from '../copy/errors';
import { useAuth } from './auth-context';

export function RequireAuth() {
  const { status, retry } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <PageLoading label="Checking your session…" />;
  }

  if (status === 'anonymous') {
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }

  if (status === 'error') {
    return (
      <div className="px-[var(--fm-page-pad-x)] py-10">
        <ErrorState
          title="We couldn't load your account."
          message={ERROR_MESSAGES.INTERNAL}
          onRetry={retry}
        />
      </div>
    );
  }

  return <Outlet />;
}

/**
 * Public-only pages (`/login`, `/signup`): an already signed-in visitor is sent to the dashboard.
 * During rehydration a loading state avoids flashing a login form to an authenticated user.
 */
export function PublicOnly() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <PageLoading label="Checking your session…" />;
  }

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
