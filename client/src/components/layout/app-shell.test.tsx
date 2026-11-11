/*
 * AppShell tests (T-020, T-084): role-aware navigation, honest agent slots, the help card, the
 * mobile slide-over (open, focus trap/return, Escape, overlay, navigation) and the account menu
 * (Escape, outside click, Profile, Sign out). The shell renders against an honest disconnected
 * AgentLink value, so it never claims a connection the local channel does not have.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

interface ShellOptions {
  readonly helpCardVisible?: boolean;
  readonly dismissHelpCard?: () => void;
  readonly logout?: () => Promise<void>;
}

function renderShell(role: 'USER' | 'ADMIN', options: ShellOptions = {}) {
  const user = makeUserWithRole(role);
  const logout = options.logout ?? vi.fn(async () => undefined);
  // The bell is part of the shell now; an empty list keeps the header counts honest and offline.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(emptyNotifications())),
  );

  const result = render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthContext.Provider value={makeAuthValue({ status: 'authenticated', user, logout })}>
        <AgentLinkContext.Provider
          value={makeAgentLinkValue({
            helpCardVisible: options.helpCardVisible ?? false,
            ...(options.dismissHelpCard === undefined
              ? {}
              : { dismissHelpCard: options.dismissHelpCard }),
          })}
        >
          <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/dashboard" element={<h1>Dashboard content</h1>} />
                <Route path="/settings" element={<div>settings destination</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AgentLinkContext.Provider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );

  return { ...result, logout, user };
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

describe('AppShell interactions', () => {
  it('shows the agent help card and forwards Dismiss', async () => {
    const dismissHelpCard = vi.fn();
    const user = userEvent.setup();
    renderShell('USER', { helpCardVisible: true, dismissHelpCard });

    expect(
      screen.getByRole('heading', { name: 'Allow this site to reach your Focus Agent' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(dismissHelpCard).toHaveBeenCalledTimes(1);
  });

  it('opens the mobile drawer and traps Tab inside it', async () => {
    const user = userEvent.setup();
    renderShell('USER');

    const menuButton = screen.getByRole('button', { name: 'Open navigation' });
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(menuButton);

    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    const drawer = screen.getByRole('dialog', { name: 'Main navigation' });
    const closeButton = within(drawer).getByRole('button', { name: 'Close navigation' });
    // Opening the drawer moves focus to its first focusable control.
    expect(closeButton).toHaveFocus();

    const focusable = drawer.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Shift+Tab from the first control wraps to the last one.
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(last).toHaveFocus();

    // Tab from the last control wraps back to the first one.
    await user.keyboard('{Tab}');
    expect(first).toHaveFocus();
  });

  it('closes the drawer on Escape and returns focus to the menu button', async () => {
    const user = userEvent.setup();
    renderShell('USER');

    const menuButton = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(menuButton);
    expect(screen.getByRole('dialog', { name: 'Main navigation' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Main navigation' })).not.toBeInTheDocument();
    });
    expect(menuButton).toHaveFocus();
  });

  it('closes the drawer from the overlay and from the close button', async () => {
    const user = userEvent.setup();
    renderShell('USER');

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    // The overlay is the first of the two "Close navigation" controls.
    await user.click(screen.getAllByRole('button', { name: 'Close navigation' })[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Main navigation' })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = screen.getByRole('dialog', { name: 'Main navigation' });
    await user.click(within(drawer).getByRole('button', { name: 'Close navigation' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Main navigation' })).not.toBeInTheDocument();
    });
  });

  it('closes the drawer after navigating from it', async () => {
    const user = userEvent.setup();
    renderShell('USER');

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = screen.getByRole('dialog', { name: 'Main navigation' });
    await user.click(within(drawer).getByRole('link', { name: 'Dashboard' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Main navigation' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Dashboard content' })).toBeInTheDocument();
  });

  it('opens the account menu, closes it with Escape and with an outside click', async () => {
    const user = userEvent.setup();
    renderShell('USER');

    const trigger = screen.getByRole('button', { name: /account menu$/i });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(within(menu).getByText('kabir@demo.com')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toHaveAttribute(
      'href',
      '/settings',
    );

    // Escape from inside the menu panel closes it.
    within(menu).getByRole('menuitem', { name: 'Profile' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Account' })).not.toBeInTheDocument();

    await user.click(trigger);
    expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument();
    await user.click(screen.getByRole('heading', { name: 'Dashboard content' }));
    expect(screen.queryByRole('menu', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('signs out from the account menu', async () => {
    const user = userEvent.setup();
    const { logout } = renderShell('USER');

    await user.click(screen.getByRole('button', { name: /account menu$/i }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('navigates to Profile and closes the account menu', async () => {
    const user = userEvent.setup();
    renderShell('USER');

    await user.click(screen.getByRole('button', { name: /account menu$/i }));
    await user.click(screen.getByRole('menuitem', { name: 'Profile' }));

    expect(await screen.findByText('settings destination')).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('signs out from the desktop sidebar', async () => {
    const user = userEvent.setup();
    const { logout } = renderShell('USER');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
