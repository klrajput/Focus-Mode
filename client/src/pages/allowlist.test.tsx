/*
 * `/allowlist` tests (T-066, FR-008/FR-020, UX_SPEC §4.6, NFR-007): protected rows are locked, user
 * apps are removed/added through the real optimistic PUT, manual entry uses the shared schemas,
 * the agent's `listApps` reply can be picked from, presets apply with `?mode=merge|replace` and a
 * 400 PROTECTED_ENTRY restores the row and shows the approved inline copy.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AppEntry, RunningApp } from '@focus-mode/shared';

import { AgentLinkContext, type AgentLinkContextValue } from '../agent/agent-link-provider';
import type { Preset } from '../api/types';
import { createTestQueryClient, makeAgentLinkValue } from '../test/test-utils';
import { AllowlistPage } from './allowlist';

const PROTECTED: AppEntry[] = [
  { key: 'chrome', label: 'All web browsers' },
  { key: 'focus-agent', label: 'Focus Agent' },
];

const VSCODE: AppEntry = { key: 'vscode', label: 'Visual Studio Code' };
const SLACK: AppEntry = { key: 'slack', label: 'Slack' };
const PRESET: Preset = {
  id: '507f1f77bcf86cd799439040',
  name: 'Coding',
  apps: [
    { key: 'terminal', label: 'Terminal' },
    { key: 'figma', label: 'Figma' },
  ],
  createdAt: '2026-11-02T10:00:00.000Z',
};

const PROTECTED_COPY =
  "This app is protected and must stay open during focus. It can't be removed.";

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function page<T>(items: T[]) {
  return {
    success: true,
    data: { items, page: 1, limit: 20, total: items.length, totalPages: 1 },
  };
}

interface ApiState {
  userApps: AppEntry[];
  protectedApps: AppEntry[];
  presets: Preset[];
  version: number;
}

interface InstalledApi {
  state: ApiState;
  fetchMock: ReturnType<typeof vi.fn>;
  /** Make the next PUT answer 400 PROTECTED_ENTRY. */
  failNextPut(message?: string): void;
}

function installApi(
  initial: Partial<ApiState> = {},
  options: { presetError?: boolean } = {},
): InstalledApi {
  const state: ApiState = {
    protectedApps: PROTECTED,
    userApps: [VSCODE],
    presets: [PRESET],
    version: 3,
    ...initial,
  };
  let putFailure: string | null = null;

  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/allowlist/preset/')) {
      const presetId = decodeURIComponent(url.split('/preset/')[1]?.split('?')[0] ?? '');
      const mode = new URL(url).searchParams.get('mode');
      const preset = state.presets.find((entry) => entry.id === presetId);
      if (preset === undefined) {
        return Promise.resolve(
          fakeResponse({ success: false, error: { code: 'NOT_FOUND', message: 'Missing' } }, 404),
        );
      }
      state.userApps =
        mode === 'replace'
          ? [...preset.apps]
          : [
              ...state.userApps,
              ...preset.apps.filter((app) => !state.userApps.some((e) => e.key === app.key)),
            ];
      state.version += 1;
      return Promise.resolve(
        fakeResponse({
          success: true,
          data: {
            protectedApps: state.protectedApps,
            userApps: state.userApps,
            version: state.version,
          },
        }),
      );
    }

    if (url.includes('/allowlist')) {
      if (method === 'PUT') {
        if (putFailure !== null) {
          const message = putFailure;
          putFailure = null;
          return Promise.resolve(
            fakeResponse({ success: false, error: { code: 'PROTECTED_ENTRY', message } }, 400),
          );
        }
        const body = JSON.parse(String(init?.body)) as { userApps: AppEntry[] };
        state.userApps = body.userApps;
        state.version += 1;
        return Promise.resolve(
          fakeResponse({
            success: true,
            data: {
              protectedApps: state.protectedApps,
              userApps: state.userApps,
              version: state.version,
            },
          }),
        );
      }
      return Promise.resolve(
        fakeResponse({
          success: true,
          data: {
            protectedApps: state.protectedApps,
            userApps: state.userApps,
            version: state.version,
          },
        }),
      );
    }

    if (url.includes('/presets')) {
      if (options.presetError === true) {
        return Promise.resolve(
          fakeResponse({ success: false, error: { code: 'INTERNAL', message: 'nope' } }, 500),
        );
      }
      return Promise.resolve(fakeResponse(page(state.presets)));
    }

    throw new Error(`Unexpected allow-list request: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);

  return {
    state,
    fetchMock,
    failNextPut(message = 'Protected apps cannot be removed: chrome') {
      putFailure = message;
    },
  };
}

function renderPage(agent: AgentLinkContextValue = makeAgentLinkValue({ status: 'PAIRED' })) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <AgentLinkContext.Provider value={agent}>
          <AllowlistPage />
        </AgentLinkContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function putBodies(fetchMock: ReturnType<typeof vi.fn>): { userApps: AppEntry[] }[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { userApps: AppEntry[] });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AllowlistPage — protected and user apps', () => {
  it('locks protected rows and never renders a remove control for them', async () => {
    installApi();
    renderPage();

    expect(await screen.findByText('All web browsers')).toBeInTheDocument();
    expect(screen.getByText('Focus Agent')).toBeInTheDocument();
    expect(screen.getAllByText('Protected')).toHaveLength(2);

    // Only the user app has a remove control (INV-3).
    expect(screen.getByRole('button', { name: 'Remove Visual Studio Code' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove All web browsers' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/1 of 50 apps/)).toBeInTheDocument();
  });

  it('removes a user app with an optimistic PUT and the approved success toast', async () => {
    const user = userEvent.setup();
    const api = installApi({ userApps: [VSCODE, SLACK] });
    renderPage();

    await screen.findByText('Slack');
    await user.click(screen.getByRole('button', { name: 'Remove Slack' }));

    await waitFor(() => expect(screen.queryByText('Slack')).not.toBeInTheDocument());
    expect(putBodies(api.fetchMock).at(-1)).toEqual({ userApps: [VSCODE] });
  });

  it('restores the row and shows the inline PROTECTED_ENTRY copy when the API refuses', async () => {
    const user = userEvent.setup();
    const api = installApi({ userApps: [VSCODE, SLACK] });
    api.failNextPut();
    renderPage();

    await screen.findByText('Slack');
    await user.click(screen.getByRole('button', { name: 'Remove Slack' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(PROTECTED_COPY);
    // The optimistic removal is rolled back from the previous cache snapshot.
    expect(await screen.findByText('Slack')).toBeInTheDocument();
  });

  it('keeps the exact empty copy when only protected apps are allow-listed', async () => {
    installApi({ userApps: [] });
    renderPage();

    expect(
      await screen.findByText(
        'Only protected apps are allow-listed right now. Add the apps you need for a focus session.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/0 of 50 apps/)).toBeInTheDocument();
  });

  it('disables adding at the 50-app limit with a visible reason', async () => {
    const many = Array.from({ length: 50 }, (_, index) => ({
      key: `app-${index}`,
      label: `App ${index}`,
    })) satisfies AppEntry[];
    installApi({ userApps: many });
    renderPage();

    expect(
      await screen.findByText(/50 of 50 apps — remove an app before adding another\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add app' })).toBeDisabled();
  });

  it('shows loading and error states for the allow-list fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          fakeResponse({ success: false, error: { code: 'INTERNAL', message: 'nope' } }, 500),
        ),
      ),
    );
    renderPage();

    expect(screen.getByText('Loading your allow-list…')).toBeInTheDocument();
    expect(await screen.findByText("We couldn't load your allow-list.")).toBeInTheDocument();
    expect(screen.getByText('(Ref: INTERNAL)')).toBeInTheDocument();
  });
});

describe('AllowlistPage — add app', () => {
  it('adds a manually entered app through PUT with the shared key/label rules', async () => {
    const user = userEvent.setup();
    const api = installApi();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add app' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an app' });

    await user.type(within(dialog).getByLabelText('App name'), 'Slack');
    await user.type(within(dialog).getByLabelText('App key'), 'slack');
    await user.click(within(dialog).getByRole('button', { name: 'Add app' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(putBodies(api.fetchMock).at(-1)).toEqual({
      userApps: [VSCODE, { key: 'slack', label: 'Slack' }],
    });
    expect(await screen.findByText('Slack')).toBeInTheDocument();
  });

  it('rejects an invalid key and a duplicate key inline without calling the API', async () => {
    const user = userEvent.setup();
    const api = installApi();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add app' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an app' });

    await user.type(within(dialog).getByLabelText('App name'), 'Bad App');
    await user.type(within(dialog).getByLabelText('App key'), 'Bad Key');
    await user.click(within(dialog).getByRole('button', { name: 'Add app' }));
    expect(
      await within(dialog).findByText('Use 2–40 lowercase letters, numbers or dashes.'),
    ).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText('App key'));
    await user.type(within(dialog).getByLabelText('App key'), 'vscode');
    await user.click(within(dialog).getByRole('button', { name: 'Add app' }));
    expect(
      await within(dialog).findByText('That app is already on your allow-list.'),
    ).toBeInTheDocument();

    expect(putBodies(api.fetchMock)).toHaveLength(0);
  });

  it('rejects a protected key with the approved PROTECTED_ENTRY copy', async () => {
    const user = userEvent.setup();
    installApi();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add app' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an app' });

    await user.type(within(dialog).getByLabelText('App name'), 'Chrome again');
    await user.type(within(dialog).getByLabelText('App key'), 'chrome');
    await user.click(within(dialog).getByRole('button', { name: 'Add app' }));

    expect(await within(dialog).findByText(PROTECTED_COPY)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('picks a running app from the agent listApps reply (labels only) and hides duplicates', async () => {
    const user = userEvent.setup();
    const requestRunningApps = vi.fn();
    const runningApps: RunningApp[] = [
      { key: 'vscode', label: 'Visual Studio Code', running: true },
      { key: 'slack', label: 'Slack', running: true },
      { key: 'spotify', label: 'Spotify', running: false },
    ];
    const api = installApi();
    renderPage(makeAgentLinkValue({ status: 'PAIRED', runningApps, requestRunningApps }));

    await user.click(await screen.findByRole('button', { name: 'Add app' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an app' });

    // The allow-listed VS Code is not offered again.
    expect(within(dialog).queryByText('Visual Studio Code')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Spotify')).toBeInTheDocument();
    expect(within(dialog).getByText('Not running')).toBeInTheDocument();

    const slackRow = within(dialog).getByText('Slack').closest('li');
    if (slackRow === null) throw new Error('Slack row not rendered');
    await user.click(within(slackRow).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(putBodies(api.fetchMock).at(-1)).toEqual({
      userApps: [VSCODE, { key: 'slack', label: 'Slack' }],
    });

    // Re-opening asks the agent again, never inventing a list.
    await user.click(await screen.findByRole('button', { name: 'Add app' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Refresh' }),
    );
    expect(requestRunningApps).toHaveBeenCalled();
  });

  it('explains that running apps need a connected Focus Agent', async () => {
    const user = userEvent.setup();
    installApi();
    renderPage(makeAgentLinkValue({ status: 'DISCONNECTED' }));

    await user.click(await screen.findByRole('button', { name: 'Add app' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an app' });

    expect(
      within(dialog).getByText(/Your Focus Agent isn't connected, so running apps can't be listed/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Check running apps' })).toBeDisabled();
  });
});

describe('AllowlistPage — presets', () => {
  it('merges a preset through POST /allowlist/preset/:id?mode=merge', async () => {
    const user = userEvent.setup();
    const api = installApi();
    renderPage();

    expect(await screen.findByText('Coding')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Merge' }));

    await waitFor(() => {
      const post = api.fetchMock.mock.calls.find(([input]) =>
        String(input).includes('/allowlist/preset/'),
      );
      expect(post).toBeDefined();
      expect(String(post?.[0])).toContain(`/allowlist/preset/${PRESET.id}?mode=merge`);
      expect((post?.[1] as RequestInit).method).toBe('POST');
    });

    expect(await screen.findByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('Visual Studio Code')).toBeInTheDocument();
  });

  it('asks for confirmation before replacing the list, then uses mode=replace', async () => {
    const user = userEvent.setup();
    const api = installApi();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Replace…' }));
    const confirm = await screen.findByRole('dialog', { name: 'Replace your allow-list?' });
    expect(
      within(confirm).getByText(/Your 1 app will be replaced by the preset/),
    ).toBeInTheDocument();

    await user.click(within(confirm).getByRole('button', { name: 'Replace allow-list' }));

    await waitFor(() => {
      const post = api.fetchMock.mock.calls.find(([input]) =>
        String(input).includes('/allowlist/preset/'),
      );
      expect(String(post?.[0])).toContain(`/allowlist/preset/${PRESET.id}?mode=replace`);
    });
    expect(await screen.findByText('Terminal')).toBeInTheDocument();
    expect(await screen.findByText('Figma')).toBeInTheDocument();
    expect(screen.queryByText('Visual Studio Code')).not.toBeInTheDocument();
  });

  it('shows the honest empty state when no preset is published', async () => {
    installApi({ presets: [] });
    renderPage();

    expect(await screen.findByText('No presets published yet.')).toBeInTheDocument();
  });

  it('surfaces a presets fetch error instead of pretending none are published', async () => {
    installApi({}, { presetError: true });
    renderPage();

    expect(await screen.findByText(/We couldn't load presets\./)).toBeInTheDocument();
    expect(screen.queryByText('No presets published yet.')).not.toBeInTheDocument();
  });
});
