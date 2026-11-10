/*
 * AgentLinkProvider tests (T-045): the provider is the single status source for the badge, the
 * focus indicator and `/devices`. A fake `AgentLinkClient` is injected, so these tests cover the
 * event → status/session mapping, the help-card dismissal and teardown without opening a socket
 * (the real class is covered in `agent-link.test.tsx`).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import type {
  AuthOkMessage,
  FocusEndedMessage,
  FocusStartedMessage,
  HelloMessage,
  StateMessage,
} from '@focus-mode/shared';

import { AuthContext } from '../auth/auth-context';
import { createTestQueryClient, makeAuthValue, makeUser } from '../test/test-utils';
import { AgentLinkProvider, useAgentLink, type AgentLinkFactory } from './agent-link-provider';
import type { AgentLinkClient, AgentLinkEvents } from './agent-link';

const SESSION_ID = '9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c';
const STARTED_AT = '2026-11-10T10:05:00.000Z';
const ENDS_AT = '2026-11-10T11:05:00.000Z';

const HELLO_UNPAIRED: HelloMessage = {
  v: 1,
  id: 'a-001',
  type: 'hello',
  agentId: 'agent-1',
  agentVersion: '1.4.0',
  os: 'macOS',
  state: 'IDLE',
  paired: false,
  capabilities: { focus: 'full' },
};

const HELLO_PAIRED: HelloMessage = { ...HELLO_UNPAIRED, id: 'a-002', paired: true };

const AUTH_OK: AuthOkMessage = {
  v: 1,
  id: 'a-003',
  type: 'authOk',
  deviceId: '507f1f77bcf86cd799439011',
  userId: '507f1f77bcf86cd799439012',
};

const STATE_FOCUSING: StateMessage = {
  v: 1,
  id: 'a-004',
  type: 'state',
  state: 'FOCUSING',
  session: {
    sessionId: SESSION_ID,
    startedAt: STARTED_AT,
    endsAt: ENDS_AT,
    plannedMinutes: 60,
    source: 'MANUAL',
  },
  protected: [],
  allowList: [],
};

const FOCUS_STARTED: FocusStartedMessage = {
  v: 1,
  id: 'a-005',
  type: 'focusStarted',
  at: STARTED_AT,
  endsAt: ENDS_AT,
  protected: [],
  state: 'FOCUSING',
  sessionId: SESSION_ID,
  source: 'MANUAL',
};

const FOCUS_ENDED: FocusEndedMessage = {
  v: 1,
  id: 'a-006',
  type: 'focusEnded',
  sessionId: SESSION_ID,
  at: ENDS_AT,
  reason: 'USER',
  actualMinutes: 60,
};

type AnyListener = (payload: never) => void;

class FakeLink implements AgentLinkClient {
  readonly connect = vi.fn();
  readonly reconnect = vi.fn();
  readonly dispose = vi.fn();
  readonly requestState = vi.fn();
  readonly notifyPaired = vi.fn();
  readonly endFocus = vi.fn();
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
    for (const listener of this.listeners.get(type) ?? []) {
      listener(payload as never);
    }
  }
}

function Probe() {
  const agent = useAgentLink();
  return (
    <div>
      <span data-testid="status">{agent.status}</span>
      <span data-testid="version">{agent.agentVersion ?? '-'}</span>
      <span data-testid="ends">{agent.session?.endsAt ?? '-'}</span>
      <span data-testid="planned">{agent.session?.plannedMinutes ?? '-'}</span>
      <span data-testid="help">{agent.helpCardVisible ? 'visible' : 'hidden'}</span>
      <span data-testid="detail">{agent.detail}</span>
      <button type="button" onClick={agent.dismissHelpCard}>
        dismiss
      </button>
    </div>
  );
}

function renderProbe(link: FakeLink) {
  const factory: AgentLinkFactory = () => link;

  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthContext.Provider value={makeAuthValue({ status: 'authenticated', user: makeUser() })}>
        <AgentLinkProvider linkFactory={factory}>
          <Probe />
        </AgentLinkProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AgentLinkProvider', () => {
  it('connects once for an authenticated user and starts Disconnected', () => {
    const link = new FakeLink();
    renderProbe(link);

    expect(link.connect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('status')).toHaveTextContent('DISCONNECTED');
    expect(screen.getByTestId('help')).toHaveTextContent('hidden');
  });

  it('does not open a socket for an anonymous visitor', () => {
    const link = new FakeLink();
    const factory = vi.fn(() => link);

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthContext.Provider value={makeAuthValue({ status: 'anonymous' })}>
          <AgentLinkProvider linkFactory={factory}>
            <Probe />
          </AgentLinkProvider>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(factory).not.toHaveBeenCalled();
    expect(link.connect).not.toHaveBeenCalled();
    expect(screen.getByTestId('status')).toHaveTextContent('DISCONNECTED');
  });

  it('maps hello → authOk → state to the provider status and session', () => {
    const link = new FakeLink();
    renderProbe(link);

    act(() => link.emit('hello', HELLO_UNPAIRED));
    expect(screen.getByTestId('status')).toHaveTextContent('IDLE');
    expect(screen.getByTestId('version')).toHaveTextContent('1.4.0');

    act(() => link.emit('hello', HELLO_PAIRED));
    act(() => link.emit('authOk', AUTH_OK));
    act(() => link.emit('status', { status: 'PAIRED', detail: 'connected' }));
    expect(screen.getByTestId('status')).toHaveTextContent('PAIRED');

    act(() => link.emit('state', STATE_FOCUSING));
    expect(screen.getByTestId('status')).toHaveTextContent('FOCUSING');
    expect(screen.getByTestId('ends')).toHaveTextContent(ENDS_AT);

    act(() => link.emit('focusEnded', FOCUS_ENDED));
    expect(screen.getByTestId('status')).toHaveTextContent('PAIRED');
    expect(screen.getByTestId('ends')).toHaveTextContent('-');
  });

  it('derives the session window from focusStarted when no state frame has arrived', () => {
    const link = new FakeLink();
    renderProbe(link);

    act(() => link.emit('hello', HELLO_PAIRED));
    act(() => link.emit('focusStarted', FOCUS_STARTED));

    expect(screen.getByTestId('status')).toHaveTextContent('FOCUSING');
    expect(screen.getByTestId('ends')).toHaveTextContent(ENDS_AT);
    expect(screen.getByTestId('planned')).toHaveTextContent('60');
  });

  it('reveals and dismisses the local-network help card after a failed connect', async () => {
    const user = userEvent.setup();
    const link = new FakeLink();
    renderProbe(link);

    act(() => link.emit('connectFailed', { ports: [4545, 4546, 4547, 4548, 4549] }));
    expect(screen.getByTestId('status')).toHaveTextContent('DISCONNECTED');
    expect(screen.getByTestId('help')).toHaveTextContent('visible');

    await user.click(screen.getByRole('button', { name: 'dismiss' }));
    expect(screen.getByTestId('help')).toHaveTextContent('hidden');
  });

  it('disposes the link on unmount', () => {
    const link = new FakeLink();
    const { unmount } = renderProbe(link);

    unmount();

    expect(link.dispose).toHaveBeenCalledTimes(1);
  });
});
