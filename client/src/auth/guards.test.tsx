/*
 * Route-guard tests (T-020 acceptance: unauth → /login; USER on /admin → 403 page).
 * The guards are rendered with a directly provided AuthContext so the tests exercise the redirect
 * decision itself, not the network bootstrap. The 403 page and AppShell are the real components;
 * the shell reads an honestly disconnected AgentLink context (no socket in this test).
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AgentLinkContext } from '../agent/agent-link-provider';
import { AppShell } from '../components/layout/app-shell';
import { ForbiddenPage } from '../pages/forbidden';
import { LoginPage } from '../pages/login';
import { makeAgentLinkValue, makeAuthValue, makeUserWithRole } from '../test/test-utils';
import { AuthContext } from './auth-context';
import { RequireAuth } from './require-auth';
import { RequireRole } from './require-role';

function renderAnonymousDashboard() {
  return render(
    <AuthContext.Provider value={makeAuthValue({ status: 'anonymous', user: null })}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/dashboard" element={<div>dashboard content</div>} />
          </Route>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

function renderAdminRoute(role: 'USER' | 'ADMIN') {
  const user = makeUserWithRole(role);

  return render(
    <AuthContext.Provider value={makeAuthValue({ status: 'authenticated', user })}>
      <AgentLinkContext.Provider value={makeAgentLinkValue()}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route element={<RequireRole role="ADMIN" />}>
                  <Route path="/admin" element={<div>admin area</div>} />
                </Route>
                <Route path="/403" element={<ForbiddenPage />} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AgentLinkContext.Provider>
    </AuthContext.Provider>,
  );
}

describe('route guards', () => {
  it('redirects an unauthenticated visitor from /dashboard to /login', async () => {
    renderAnonymousDashboard();

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByText('dashboard content')).not.toBeInTheDocument();
  });

  it('renders the 403 page for a USER on an ADMIN route', async () => {
    renderAdminRoute('USER');

    expect(
      await screen.findByRole('heading', { name: "403 — You don't have access" }),
    ).toBeInTheDocument();
    expect(screen.queryByText('admin area')).not.toBeInTheDocument();
  });

  it('renders the admin route for an ADMIN', async () => {
    renderAdminRoute('ADMIN');

    expect(await screen.findByText('admin area')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "403 — You don't have access" })).toBeNull();
  });
});
