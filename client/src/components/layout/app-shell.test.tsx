/*
 * AppShell role-aware navigation test (T-020): USER sees the seven product pages and no Admin
 * entry; ADMIN additionally sees Admin. Also asserts the honest Focus Agent status slot, which must
 * never claim a connection that does not exist in W1.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthContext } from '../../auth/auth-context';
import { makeAuthValue, makeUserWithRole } from '../../test/test-utils';
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

function renderShell(role: 'USER' | 'ADMIN') {
  const user = makeUserWithRole(role);

  return render(
    <AuthContext.Provider value={makeAuthValue({ status: 'authenticated', user })}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<h1>Dashboard content</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
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
});
