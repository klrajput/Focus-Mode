/*
 * AppShell role-aware navigation test (T-020): USER sees the seven product pages and no Admin
 * entry; ADMIN additionally sees Admin. The shell renders against an honest disconnected AgentLink
 * value, so it never claims a connection the local channel does not have.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AgentLinkContext } from '../../agent/agent-link-provider';
import { AuthContext } from '../../auth/auth-context';
import {
  createTestQueryClient,
  makeAgentLinkValue,
  makeAuthValue,
  makeUserWithRole,
} from '../../test/test-utils';
import { AppShell } from './app-shell';

const PRIMARY_LABELS = [
  'Dashboard',
  'Focus',
  'Devices',
  'Allow-list',
  'Schedules',
  'Insights',
  'Settings',
] as const;

function emptyNotifications(): Response {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        success: true,
        data: { items: [], page: 1, limit: 20, total: 0, totalPages: 0 },
      }),
  } as Response;
}

function renderShell(role: 'USER' | 'ADMIN') {
  const user = makeUserWithRole(role);
  // The bell is part of the shell now; an empty list keeps the header counts honest and offline.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(emptyNotifications())),
  );

  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthContext.Provider value={makeAuthValue({ status: 'authenticated', user })}>
        <AgentLinkContext.Provider value={makeAgentLinkValue()}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/dashboard" element={<h1>Dashboard content</h1>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AgentLinkContext.Provider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('AppShell', () => {
  it('shows the seven USER navigation entries and no Admin entry', () => {
    renderShell('USER');

    for (const label of PRIMARY_LABELS) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard content', { selector: 'h1' })).toBeInTheDocument();
  });

  it('adds the Admin entry for an ADMIN', () => {
    renderShell('ADMIN');

    expect(screen.getByRole('link', { name: 'Admin' })).toBeInTheDocument();
  });

  it('shows the honest Focus Agent placeholder instead of a fake connection', () => {
    renderShell('USER');

    expect(
      screen.getByRole('status', { name: 'Focus Agent status: Disconnected' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('renders the notifications bell without inventing an unread count', () => {
    renderShell('USER');

    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByText('1 unread')).not.toBeInTheDocument();
  });
});
