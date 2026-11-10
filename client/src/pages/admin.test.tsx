/*
 * `/admin` tests (T-034, FR-019, NFR-007): the users table with search + pagination and
 * deactivate/reactivate, preset CRUD, agent-link CRUD with HTTPS validation, aggregate stats and
 * the USER → /403 guard. `fetch` is stubbed at the transport boundary with a small stateful fake so
 * the real endpoint modules, hooks and TanStack Query invalidation are exercised.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { AdminStats, AgentLink, Preset, PublicUser } from '../api/types';
import { AuthContext } from '../auth/auth-context';
import { RequireRole } from '../auth/require-role';
import { ForbiddenPage } from './forbidden';
import { createTestQueryClient, makeAuthValue, makeUser } from '../test/test-utils';
import { AdminPage } from './admin';

const ADMIN = makeUser({
  id: '507f1f77bcf86cd799439001',
  name: 'Meera Admin',
  email: 'admin@demo.com',
  role: 'ADMIN',
});

const KABIR = makeUser({
  id: '507f1f77bcf86cd799439002',
  name: 'Kabir',
  email: 'kabir@demo.com',
});

const MEERA = makeUser({
  id: '507f1f77bcf86cd799439003',
  name: 'Meera',
  email: 'meera@demo.com',
  isActive: false,
});

const THIRD = makeUser({
  id: '507f1f77bcf86cd799439004',
  name: 'Rohan',
  email: 'rohan@demo.com',
});

const CODING: Preset = {
  id: '507f1f77bcf86cd799439011',
  name: 'Coding',
  apps: [{ key: 'vs-code', label: 'VS Code' }],
  createdAt: '2026-11-02T10:00:00.000Z',
};

const MAC_LINK: AgentLink = {
  id: '507f1f77bcf86cd799439021',
  os: 'macOS',
  arch: 'arm64',
  label: 'Focus Agent for macOS',
  url: 'https://downloads.example.com/focus-agent-arm64.dmg',
  version: '1.4.0',
  publishedAt: '2026-11-10T10:00:00.000Z',
};

const STATS: AdminStats = {
  users: 128,
  activeUsers: 120,
  devices: 96,
  connectedDevices: 12,
  sessions: 1204,
  activeSessions: 3,
  focusMinutes: 48_720,
};

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

function pageOf<T>(items: T[], page = 1, totalPages = 1, total = items.length): unknown {
  return success({ items, page, limit: 20, total, totalPages });
}

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {})),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function methodOf(init: RequestInit): string {
  return init.method ?? 'GET';
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

function renderAdmin(user: PublicUser = ADMIN) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={['/admin']}>
        <AuthContext.Provider value={makeAuthValue({ status: 'authenticated', user })}>
          <AdminPage />
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdminPage tabs', () => {
  it('lists users and moves between pages', async () => {
    const user = userEvent.setup();
    installFetch((url) => {
      if (!url.includes('/admin/users')) throw new Error(`unexpected request: ${url}`);
      const params = new URL(url).searchParams;
      const page = Number(params.get('page') ?? 1);
      return page === 1
        ? fakeResponse(pageOf([KABIR, MEERA], 1, 2, 22))
        : fakeResponse(pageOf([THIRD], 2, 2, 22));
    });

    renderAdmin();

    expect(await screen.findByText('kabir@demo.com')).toBeInTheDocument();
    expect(screen.getByText('meera@demo.com')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2 · 22 users')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByText('rohan@demo.com')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2 · 22 users')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('uses filter copy only when a search is applied (F-108)', async () => {
    const user = userEvent.setup();
    installFetch((url) => {
      if (!url.includes('/admin/users')) throw new Error(`unexpected request: ${url}`);
      return fakeResponse(pageOf([]));
    });

    renderAdmin();

    expect(await screen.findByText('No users yet.')).toBeInTheDocument();
    expect(screen.queryByText('No users match your filters.')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Search users/), 'nobody');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('No users match your filters.')).toBeInTheDocument();
  });

  it('searches by name or email and keeps the query server-side', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch((url) => {
      if (!url.includes('/admin/users')) throw new Error(`unexpected request: ${url}`);
      const search = new URL(url).searchParams.get('search');
      const items = search === null ? [KABIR, MEERA] : [MEERA];
      return fakeResponse(pageOf(items));
    });

    renderAdmin();
    await screen.findByText('kabir@demo.com');

    await user.type(screen.getByLabelText(/^Search users/), 'meera');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('search=meera'))).toBe(
        true,
      );
    });
    await waitFor(() => {
      expect(screen.queryByText('kabir@demo.com')).not.toBeInTheDocument();
    });
    expect(screen.getByText('meera@demo.com')).toBeInTheDocument();
  });

  it('deactivates another user with PATCH and never offers it for your own account', async () => {
    const user = userEvent.setup();
    let users = [ADMIN, KABIR];
    const fetchMock = installFetch((url, init) => {
      if (!url.includes('/admin/users')) throw new Error(`unexpected request: ${url}`);
      if (methodOf(init) === 'PATCH') {
        const id = url.split('/admin/users/')[1];
        const patch = bodyOf(init) as { isActive?: boolean };
        users = users.map((entry) =>
          entry.id === id ? { ...entry, isActive: patch.isActive ?? entry.isActive } : entry,
        );
        return fakeResponse(success(users.find((entry) => entry.id === id)));
      }
      return fakeResponse(pageOf(users));
    });

    renderAdmin();
    const kabirRow = await screen.findByRole('row', { name: /kabir@demo.com/ });
    const adminRow = screen.getByRole('row', { name: /admin@demo.com/ });

    const selfButton = within(adminRow).getByRole('button', { name: 'Deactivate' });
    expect(selfButton).toBeDisabled();

    await user.click(within(kabirRow).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ isActive: false });
    });
    expect(
      await within(await screen.findByRole('row', { name: /kabir@demo.com/ })).findByRole(
        'button',
        {
          name: 'Activate',
        },
      ),
    ).toBeInTheDocument();
  });

  it('creates and deletes a preset from the Presets tab', async () => {
    const user = userEvent.setup();
    let presets = [CODING];
    const fetchMock = installFetch((url, init) => {
      if (url.includes('/admin/users')) return fakeResponse(pageOf([KABIR]));
      if (!url.includes('/admin/presets')) throw new Error(`unexpected request: ${url}`);
      if (methodOf(init) === 'POST') {
        const body = bodyOf(init);
        const created: Preset = {
          id: '507f1f77bcf86cd799439012',
          name: String(body.name),
          apps: body.apps as Preset['apps'],
          createdAt: '2026-11-11T10:00:00.000Z',
        };
        presets = [...presets, created];
        return fakeResponse(success(created), 201);
      }
      if (methodOf(init) === 'DELETE') {
        const id = url.split('/admin/presets/')[1];
        presets = presets.filter((preset) => preset.id !== id);
        return fakeResponse(success({ id }));
      }
      return fakeResponse(pageOf(presets));
    });

    renderAdmin();
    await screen.findByText('kabir@demo.com');
    await user.click(screen.getByRole('tab', { name: 'Presets' }));

    expect(await screen.findByText('Coding')).toBeInTheDocument();
    expect(screen.getByText('1 app')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New preset' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Preset name/), 'Writing');
    await user.clear(within(dialog).getByLabelText(/^App 1 key/));
    await user.type(within(dialog).getByLabelText(/^App 1 key/), 'notion');
    await user.clear(within(dialog).getByLabelText(/^App 1 label/));
    await user.type(within(dialog).getByLabelText(/^App 1 label/), 'Notion');
    await user.click(within(dialog).getByRole('button', { name: 'Publish preset' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
        name: 'Writing',
        apps: [{ key: 'notion', label: 'Notion' }],
      });
    });

    expect(await screen.findByText('Writing')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const codingRow = (await screen.findByText('Coding')).closest('li');
    if (codingRow === null) throw new Error('Coding row not rendered');
    await user.click(within(codingRow).getByRole('button', { name: 'Delete' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete preset' }),
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).includes('/admin/presets/') && methodOf(init ?? {}) === 'DELETE',
        ),
      ).toBe(true);
    });
  });

  it('edits an existing preset through PATCH /admin/presets/:id', async () => {
    const user = userEvent.setup();
    let presets = [CODING];
    const fetchMock = installFetch((url, init) => {
      if (url.includes('/admin/users')) return fakeResponse(pageOf([KABIR]));
      if (!url.includes('/admin/presets')) throw new Error(`unexpected request: ${url}`);
      if (methodOf(init) === 'PATCH') {
        const id = url.split('/admin/presets/')[1];
        const body = bodyOf(init);
        presets = presets.map((preset) =>
          preset.id === id ? { ...preset, ...(body as Partial<Preset>) } : preset,
        );
        return fakeResponse(success(presets.find((preset) => preset.id === id)));
      }
      return fakeResponse(pageOf(presets));
    });

    renderAdmin();
    await screen.findByText('kabir@demo.com');
    await user.click(screen.getByRole('tab', { name: 'Presets' }));
    await screen.findByText('Coding');

    const row = (await screen.findByText('Coding')).closest('li');
    if (row === null) throw new Error('Coding row not rendered');
    await user.click(within(row).getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText(/^Preset name/);
    await user.clear(name);
    await user.type(name, 'Deep work');
    await user.click(within(dialog).getByRole('button', { name: 'Save preset' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).includes(`/admin/presets/${CODING.id}`) && methodOf(init ?? {}) === 'PATCH',
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({
        name: 'Deep work',
        apps: [{ key: 'vs-code', label: 'VS Code' }],
      });
    });

    expect(await screen.findByText('Deep work')).toBeInTheDocument();
  });

  it('validates that a download link is HTTPS before publishing it', async () => {
    const user = userEvent.setup();
    let links = [MAC_LINK];
    const fetchMock = installFetch((url, init) => {
      if (url.includes('/admin/users')) return fakeResponse(pageOf([KABIR]));
      if (!url.includes('/admin/agent-links')) throw new Error(`unexpected request: ${url}`);
      if (methodOf(init) === 'POST') {
        const body = bodyOf(init);
        const created = { ...MAC_LINK, id: '507f1f77bcf86cd799439022', ...body } as AgentLink;
        links = [...links, created];
        return fakeResponse(success(created), 201);
      }
      return fakeResponse(pageOf(links));
    });

    renderAdmin();
    await screen.findByText('kabir@demo.com');
    await user.click(screen.getByRole('tab', { name: 'Agent links' }));

    expect(await screen.findByText(MAC_LINK.url)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New link' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Label/), 'Focus Agent for Windows');
    await user.clear(within(dialog).getByLabelText(/^Version/));
    await user.type(within(dialog).getByLabelText(/^Version/), '1.4.0');
    await user.clear(within(dialog).getByLabelText(/^Download URL/));
    await user.type(
      within(dialog).getByLabelText(/^Download URL/),
      'http://insecure.example.com/a.exe',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save link' }));

    expect(
      await within(dialog).findByText(
        /Enter an https URL — installers must be served over HTTPS\./,
      ),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => methodOf(init ?? {}) === 'POST')).toBe(false);

    await user.clear(within(dialog).getByLabelText(/^Download URL/));
    await user.type(
      within(dialog).getByLabelText(/^Download URL/),
      'https://downloads.example.com/focus-agent-setup.exe',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save link' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({
        label: 'Focus Agent for Windows',
        url: 'https://downloads.example.com/focus-agent-setup.exe',
        version: '1.4.0',
      });
    });
  });

  it('renders aggregate stats only', async () => {
    const user = userEvent.setup();
    installFetch((url) => {
      if (url.endsWith('/admin/stats')) return fakeResponse(success(STATS));
      if (url.includes('/admin/users')) return fakeResponse(pageOf([KABIR]));
      if (url.includes('/admin/presets')) return fakeResponse(pageOf([CODING]));
      if (url.includes('/admin/agent-links')) return fakeResponse(pageOf([MAC_LINK]));
      throw new Error(`unexpected request: ${url}`);
    });

    renderAdmin();
    await screen.findByText('kabir@demo.com');
    await user.click(screen.getByRole('tab', { name: 'Stats' }));

    expect(await screen.findByText('128')).toBeInTheDocument();
    expect(screen.getByText('120 active')).toBeInTheDocument();
    expect(screen.getByText('1204')).toBeInTheDocument();
    expect(screen.getByText('812 h')).toBeInTheDocument();
    expect(screen.getAllByText(/no per-user session detail/i).length).toBeGreaterThan(0);
  });

  it('shows the retry error state when the users request fails', async () => {
    const user = userEvent.setup();
    let first = true;
    installFetch((url) => {
      if (!url.includes('/admin/users')) throw new Error(`unexpected request: ${url}`);
      if (first) {
        first = false;
        return fakeResponse(
          { success: false, error: { code: 'INTERNAL', message: 'Database unavailable' } },
          500,
        );
      }
      return fakeResponse(pageOf([KABIR]));
    });

    renderAdmin();

    expect(
      await screen.findByRole('heading', { name: "We couldn't load admin data." }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('kabir@demo.com')).toBeInTheDocument();
  });

  it('sends a USER to the 403 page instead of the admin tabs', async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={['/admin']}>
          <AuthContext.Provider
            value={makeAuthValue({ status: 'authenticated', user: makeUser() })}
          >
            <Routes>
              <Route element={<RequireRole role="ADMIN" />}>
                <Route path="/admin" element={<AdminPage />} />
              </Route>
              <Route path="/403" element={<ForbiddenPage />} />
            </Routes>
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: "403 — You don't have access" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Users' })).not.toBeInTheDocument();
  });
});
