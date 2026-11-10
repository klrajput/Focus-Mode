/*
 * StartFocusCard tests (T-056, FR-005/FR-007/FR-009).
 *
 * The security-relevant assertions are deliberately explicit:
 *   · Start Focus opens the consent modal and sends **nothing** (link spy: `send` untouched),
 *   · only "Confirm — start focus" produces one `enterFocus` frame with the frozen payload shape,
 *   · every disabled state carries a visible, approved reason (no dead click, no fake Connected).
 * `fetch` is stubbed for `GET /allowlist` and `GET /devices`; the local channel is a link spy, so no
 * socket is opened and the tests prove exactly which frame the dashboard emits.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type {
  AgentConnectionStatus,
  AuthOkMessage,
  HelloMessage,
  StateMessage,
} from '@focus-mode/shared';

import {
  AgentLinkContext,
  AgentLinkProvider,
  type AgentLinkContextValue,
} from '../../agent/agent-link-provider';
import type { AgentLinkClient, AgentLinkEvents } from '../../agent/agent-link';
import { AuthContext } from '../../auth/auth-context';
import {
  createTestQueryClient,
  makeAgentLinkValue,
  makeAuthValue,
  makeUser,
} from '../../test/test-utils';
import { StartFocusCard } from './start-focus-card';

const DEVICE_ID = '507f1f77bcf86cd799439011';
const SESSION_ID = '9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c';
const STARTED_AT = '2026-11-10T10:05:00.000Z';
const ENDS_AT = '2026-11-10T11:05:00.000Z';

const DEVICE = {
  id: DEVICE_ID,
  name: "Kabir's MacBook",
  os: 'macOS' as const,
  status: 'CONNECTED' as const,
  agentVersion: '1.4.0',
  pairedAt: '2026-11-02T10:00:00.000Z',
  lastSeenAt: '2026-11-10T10:00:00.000Z',
  capabilities: { focus: 'full' as const },
};

const ALLOWLIST = {
  protectedApps: [{ key: 'chrome', label: 'Google Chrome', mac: ['com.google.Chrome'] }],
  userApps: [{ key: 'vscode', label: 'Visual Studio Code', win: ['Code.exe'] }],
  version: 3,
};

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/allowlist')) {
        return Promise.resolve(fakeResponse({ success: true, data: ALLOWLIST }));
      }
      if (url.includes('/devices')) {
        return Promise.resolve(
          fakeResponse({
            success: true,
            data: { items: [DEVICE], page: 1, limit: 20, total: 1, totalPages: 1 },
          }),
        );
      }
      return Promise.resolve(
        fakeResponse({ success: false, error: { code: 'NOT_FOUND', message: 'nope' } }, 404),
      );
    }),
  );
}

function renderCard(overrides: Partial<AgentLinkContextValue> = {}) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthContext.Provider value={makeAuthValue({ status: 'authenticated', user: makeUser() })}>
        <MemoryRouter>
          <AgentLinkContext.Provider value={makeAgentLinkValue(overrides)}>
            <StartFocusCard />
          </AgentLinkContext.Provider>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

type AnyListener = (payload: never) => void;

class LinkSpy implements AgentLinkClient {
  readonly connect = vi.fn();
  readonly reconnect = vi.fn();
  readonly dispose = vi.fn();
  readonly requestState = vi.fn();
  readonly notifyPaired = vi.fn();
  readonly endFocus = vi.fn(() => true);
  readonly requestApps = vi.fn();
  readonly send = vi.fn(() => true);

  private readonly listeners = new Map<keyof AgentLinkEvents, Set<AnyListener>>();

  on<K extends keyof AgentLinkEvents>(
    type: K,
    handler: (payload: AgentLinkEvents[K]) => void,
  ): () => void {
    const listener: AnyListener = (payload) => handler(payload);
    const set = this.listeners.get(type) ?? new Set<AnyListener>();
    set.add(listener);
    this.listeners.set(type, set);
    return () => {
      set.delete(listener);
    };
  }

  emit<K extends keyof AgentLinkEvents>(type: K, payload: AgentLinkEvents[K]): void {
    for (const listener of this.listeners.get(type) ?? []) listener(payload as never);
  }
}

const HELLO_PAIRED: HelloMessage = {
  v: 1,
  id: 'a-001',
  type: 'hello',
  agentId: 'agent-1',
  agentVersion: '1.4.0',
  os: 'macOS',
  state: 'IDLE',
  paired: true,
  capabilities: { focus: 'full' },
};

const AUTH_OK: AuthOkMessage = {
  v: 1,
  id: 'a-002',
  type: 'authOk',
  deviceId: DEVICE_ID,
  userId: '507f1f77bcf86cd799439012',
};

const STATE_PAIRED: StateMessage = {
  v: 1,
  id: 'a-003',
  type: 'state',
  state: 'PAIRED',
  protected: [],
  allowList: [],
};

function renderCardWithLink(link: LinkSpy) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthContext.Provider value={makeAuthValue({ status: 'authenticated', user: makeUser() })}>
        <MemoryRouter>
          <AgentLinkProvider linkFactory={() => link}>
            <StartFocusCard />
          </AgentLinkProvider>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

async function connect(link: LinkSpy, status: AgentConnectionStatus = 'PAIRED'): Promise<void> {
  await act(async () => {
    link.emit('hello', HELLO_PAIRED);
    link.emit('authOk', AUTH_OK);
    link.emit('status', { status, detail: 'Your Focus Agent is connected.' });
    link.emit('state', STATE_PAIRED);
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StartFocusCard', () => {
  it('disables Start with the approved no-device reason when the agent is unreachable', async () => {
    installFetch();
    renderCard({ status: 'DISCONNECTED' });

    const start = await screen.findByRole('button', { name: 'Start Focus' });
    expect(start).toBeDisabled();
    expect(screen.getByText('No device connected — start your Focus Agent.')).toBeInTheDocument();
    expect(screen.getByText(/Connect the Focus Agent to start a session/)).toBeInTheDocument();
  });

  it('disables Start with the Wayland/X11 reason when the agent cannot move windows', async () => {
    installFetch();
    renderCard({
      status: 'PAIRED',
      capabilities: { focus: 'unsupported', reasons: ['Wayland does not expose window handles'] },
    });

    expect(await screen.findByRole('button', { name: 'Start Focus' })).toBeDisabled();
    expect(
      screen.getByText(
        "Your Focus Agent can't move windows on this system. Focus needs Windows, macOS, or Linux with X11.",
      ),
    ).toBeInTheDocument();
  });

  it('disables Start while a session is already running and offers the focus page', async () => {
    installFetch();
    renderCard({
      status: 'FOCUSING',
      session: {
        sessionId: SESSION_ID,
        startedAt: STARTED_AT,
        endsAt: ENDS_AT,
        plannedMinutes: 60,
        source: 'MANUAL',
      },
    });

    expect(await screen.findByRole('button', { name: 'Start Focus' })).toBeDisabled();
    expect(
      screen.getByText(
        'A focus session is already running on this device. End it before starting another.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to Focus' })).toBeInTheDocument();
  });

  it('names the allow-listed apps on the card and inside the consent summary', async () => {
    installFetch();
    const link = new LinkSpy();
    renderCardWithLink(link);
    await connect(link);

    expect(await screen.findByText(/Visual Studio Code/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Start Focus' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Your allow-listed apps:/)).toHaveTextContent(
      'Your allow-listed apps: Visual Studio Code',
    );
  });

  it('sends no enterFocus before Confirm and exactly one after (link spy)', async () => {
    installFetch();
    const user = userEvent.setup();
    const link = new LinkSpy();
    renderCardWithLink(link);
    await connect(link);

    await screen.findByRole('button', { name: 'Start Focus' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start Focus' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Start Focus' }));

    await screen.findByRole('dialog');
    expect(link.send).not.toHaveBeenCalled();

    // Escape cancels without a request.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(link.send).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Start Focus' }));
    const reopened = await screen.findByRole('dialog');
    await user.click(within(reopened).getByRole('button', { name: 'Confirm — start focus' }));

    await waitFor(() => expect(link.send).toHaveBeenCalledTimes(1));

    const [frame] = link.send.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(frame).toMatchObject({
      type: 'enterFocus',
      durationMin: 60,
      reaside: true,
      allowList: ALLOWLIST.userApps,
      consent: { version: 'consent-v1' },
    });
    expect(typeof (frame.consent as { acceptedAt: string }).acceptedAt).toBe('string');
    expect(Number.isNaN(Date.parse((frame.consent as { acceptedAt: string }).acceptedAt))).toBe(
      false,
    );
    expect(frame.clientSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sends the re-aside toggle off when the user turned it off (default is on)', async () => {
    installFetch();
    const user = userEvent.setup();
    const link = new LinkSpy();
    renderCardWithLink(link);
    await connect(link);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start Focus' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Start Focus' }));
    const dialog = await screen.findByRole('dialog');
    const toggle = within(dialog).getByRole('switch', { name: 'Keep new apps aside' });
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(toggle).not.toBeChecked();

    await user.click(within(dialog).getByRole('button', { name: 'Confirm — start focus' }));
    await waitFor(() => expect(link.send).toHaveBeenCalledTimes(1));
    const [frame] = link.send.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(frame.reaside).toBe(false);
  });

  it('keeps Start disabled with the 1–480 reason for an out-of-range custom duration', async () => {
    installFetch();
    const user = userEvent.setup();
    renderCard({ status: 'PAIRED', capabilities: { focus: 'full' } });

    await user.click(await screen.findByRole('button', { name: 'Custom…' }));
    const input = screen.getByLabelText('Custom duration (minutes)');
    await user.clear(input);
    await user.type(input, '500');

    // Both the inline field error and the button's describedby reason carry the approved sentence.
    expect(
      screen.getAllByText('Enter a duration between 1 and 480 minutes.').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Start Focus' })).toBeDisabled();
  });
});
