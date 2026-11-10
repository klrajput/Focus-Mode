/*
 * `/settings` tests (T-034, FR-029, NFR-007): profile PATCH with the shared schema, password change
 * with the wrong-current inline error, unpair-all through the confirm dialog and installer links
 * from the public GET /agent-links. `fetch` is stubbed at the transport boundary.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import type { AgentLink, PublicUser } from '../api/types';
import { AuthContext } from '../auth/auth-context';
import { createTestQueryClient, makeAuthValue, makeUser } from '../test/test-utils';
import { SettingsPage } from './settings';

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function success(data: unknown): unknown {
  return { success: true, data };
}

function failure(code: string, details: { path: string; message: string }[] = []): unknown {
  return { success: false, error: { code, message: code, details } };
}

function page<T>(items: T[]): unknown {
  return success({ items, page: 1, limit: 20, total: items.length, totalPages: 1 });
}

const MAC_LINK: AgentLink = {
  id: '507f1f77bcf86cd799439021',
  os: 'macOS',
  arch: 'arm64',
  label: 'Focus Agent for macOS',
  url: 'https://downloads.example.com/focus-agent-arm64.dmg',
  version: '1.4.0',
  publishedAt: '2026-11-10T10:00:00.000Z',
};

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {})),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderSettings(user: PublicUser = makeUser()) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <AuthContext.Provider value={makeAuthValue({ status: 'authenticated', user })}>
          <SettingsPage />
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function methodOf(init: RequestInit): string {
  return init.method ?? 'GET';
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SettingsPage', () => {
  it('renders read-only account facts from GET /auth/me', async () => {
    installFetch((url) => {
      if (url.endsWith('/auth/me')) return fakeResponse(success(makeUser()));
      if (url.endsWith('/agent-links')) return fakeResponse(page([]));
      throw new Error(`unexpected request: ${url}`);
    });

    renderSettings();

    expect(await screen.findByLabelText(/^Name/)).toHaveValue('Kabir');
    expect(screen.getByText('kabir@demo.com')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Timezone/)).toHaveValue('Asia/Kolkata');
    expect(screen.queryByLabelText(/^Email/)).not.toBeInTheDocument();
  });

  it('saves name, timezone and duration with PATCH /users/me', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch((url, init) => {
      if (url.endsWith('/auth/me')) return fakeResponse(success(makeUser()));
      if (url.endsWith('/agent-links')) return fakeResponse(page([]));
      if (url.endsWith('/users/me') && methodOf(init) === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return fakeResponse(
          success(
            makeUser({
              name: String(body.name),
              timezone: String(body.timezone),
              defaultDurationMin: Number(body.defaultDurationMin),
            }),
          ),
        );
      }
      throw new Error(`unexpected request: ${methodOf(init)} ${url}`);
    });

    renderSettings();
    const name = await screen.findByLabelText(/^Name/);

    await user.clear(name);
    await user.type(name, 'Kabir Singh');
    await user.selectOptions(screen.getByLabelText(/^Timezone/), 'Europe/London');
    const duration = screen.getByLabelText(/^Default duration/);
    await user.clear(duration);
    await user.type(duration, '45');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/users/me') &&
          (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({
        name: 'Kabir Singh',
        timezone: 'Europe/London',
        defaultDurationMin: 45,
      });
    });
  });

  it('rejects an out-of-range default duration before sending PATCH', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch((url) => {
      if (url.endsWith('/auth/me')) return fakeResponse(success(makeUser()));
      if (url.endsWith('/agent-links')) return fakeResponse(page([]));
      throw new Error(`unexpected request: ${url}`);
    });

    renderSettings();
    const duration = await screen.findByLabelText(/^Default duration/);
    await user.clear(duration);
    await user.type(duration, '500');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Enter 480 minutes or less.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toBe(false);
  });

  it('changes the password without sending the confirm field', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch((url, init) => {
      if (url.endsWith('/auth/me')) return fakeResponse(success(makeUser()));
      if (url.endsWith('/users/me/password') && methodOf(init) === 'POST') {
        return fakeResponse(success({ changed: true }));
      }
      if (url.endsWith('/agent-links')) return fakeResponse(page([]));
      throw new Error(`unexpected request: ${methodOf(init)} ${url}`);
    });

    renderSettings();
    await screen.findByLabelText(/^Name/);
    await user.type(screen.getByLabelText(/^Current password/), 'OldPass123');
    await user.type(screen.getByLabelText(/^New password/), 'NewPass123');
    await user.type(screen.getByLabelText(/^Confirm new password/), 'NewPass123');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([input]) =>
        String(input).endsWith('/users/me/password'),
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
        currentPassword: 'OldPass123',
        newPassword: 'NewPass123',
      });
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/^Current password/)).toHaveValue('');
    });
  });

  it('shows a wrong current password as an inline field error', async () => {
    const user = userEvent.setup();
    installFetch((url, init) => {
      if (url.endsWith('/auth/me')) return fakeResponse(success(makeUser()));
      if (url.endsWith('/users/me/password') && methodOf(init) === 'POST') {
        return fakeResponse(
          failure('VALIDATION_ERROR', [
            { path: 'currentPassword', message: 'Current password does not match' },
          ]),
          400,
        );
      }
      if (url.endsWith('/agent-links')) return fakeResponse(page([]));
      throw new Error(`unexpected request: ${methodOf(init)} ${url}`);
    });

    renderSettings();
    await screen.findByLabelText(/^Name/);
    await user.type(screen.getByLabelText(/^Current password/), 'WrongPass1');
    await user.type(screen.getByLabelText(/^New password/), 'NewPass123');
    await user.type(screen.getByLabelText(/^Confirm new password/), 'NewPass123');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
    expect(screen.getByText('Check the highlighted fields and try again.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Current password/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders real download links and marks the builds unsigned', async () => {
    installFetch((url) => {
      if (url.endsWith('/auth/me')) return fakeResponse(success(makeUser()));
      if (url.endsWith('/agent-links')) return fakeResponse(page([MAC_LINK]));
      throw new Error(`unexpected request: ${url}`);
    });

    renderSettings();
    await screen.findByLabelText(/^Name/);

    const link = await screen.findByRole('link', {
      name: /Download Focus Agent for macOS — version 1.4.0/i,
    });
    expect(link).toHaveAttribute('href', MAC_LINK.url);
    expect(screen.getByText(/unsigned builds/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /windows/i })).not.toBeInTheDocument();
  });

  it('shows the publishing empty state when no installer exists yet', async () => {
    installFetch((url) => {
      if (url.endsWith('/auth/me')) return fakeResponse(success(makeUser()));
      if (url.endsWith('/agent-links')) return fakeResponse(page([]));
      throw new Error(`unexpected request: ${url}`);
    });

    renderSettings();
    await screen.findByLabelText(/^Name/);

    expect(
      await screen.findByRole('heading', {
        name: 'Installer links are being published — check back soon.',
      }),
    ).toBeInTheDocument();
  });

  it('unpairs all devices after confirmation', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch((url, init) => {
      if (url.endsWith('/auth/me')) return fakeResponse(success(makeUser()));
      if (url.endsWith('/agent-links')) return fakeResponse(page([]));
      if (url.endsWith('/devices/unpair-all') && methodOf(init) === 'POST') {
        return fakeResponse(success({ unpaired: 2 }));
      }
      throw new Error(`unexpected request: ${methodOf(init)} ${url}`);
    });

    renderSettings();
    await screen.findByLabelText(/^Name/);
    await user.click(screen.getByRole('button', { name: 'Unpair all devices' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Unpair all devices?' }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Unpair all' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).endsWith('/devices/unpair-all')),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
