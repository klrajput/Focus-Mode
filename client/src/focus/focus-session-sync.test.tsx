/*
 * FocusSessionSync tests (T-057, FR-006/FR-010/FR-024, REC-006).
 *
 * The REST record must be written *after* the agent confirms, with the frozen payloads:
 *   focusStarted → POST /sessions {deviceId, durationMin, startedAt, clientSessionId, source}
 *   focusEnded   → PATCH /sessions/:id {status, endedAt, actualMinutes, endReason}
 * `clientSessionId` is the agent's session id (the idempotency key), a timer-completed session is
 * COMPLETED and a user-ended one is CANCELLED. `fetch` is stubbed, so no API is touched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';

import {
  AgentLinkContext,
  type AgentLinkContextValue,
  type AgentSessionSummary,
} from '../agent/agent-link-provider';
import { createTestQueryClient, makeAgentLinkValue } from '../test/test-utils';
import {
  FOCUS_ENDED_TOAST,
  FOCUS_STARTED_TOAST,
  FocusSessionSync,
  finalStatusFor,
  pickFocusDeviceId,
} from './focus-session-sync';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const DEVICE_ID = '507f1f77bcf86cd799439011';
const SESSION_ID = '9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c';
const STARTED_AT = '2026-11-10T10:05:00.000Z';
const ENDED_AT = '2026-11-10T11:05:00.000Z';

const SESSION: AgentSessionSummary = {
  sessionId: SESSION_ID,
  startedAt: STARTED_AT,
  endsAt: ENDED_AT,
  plannedMinutes: 60,
  source: 'MANUAL',
};

const DEVICE = {
  id: DEVICE_ID,
  name: "Kabir's MacBook",
  os: 'macOS',
  status: 'CONNECTED',
  agentVersion: '1.4.0',
  pairedAt: '2026-11-02T10:00:00.000Z',
  lastSeenAt: '2026-11-10T10:00:00.000Z',
};

function envelope(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify({ success: true, data }),
  } as Response;
}

function page(items: unknown[]): Response {
  return envelope({ items, page: 1, limit: 20, total: items.length, totalPages: 1 });
}

interface Calls {
  created: unknown[];
  patched: { url: string; body: unknown }[];
}

function installFetch(existing: unknown[] = []): Calls {
  const calls: Calls = { created: [], patched: [] };

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/devices')) return Promise.resolve(page([DEVICE]));
      if (url.endsWith('/sessions') && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.created.push(body);
        return Promise.resolve(
          envelope({
            id: 'sess-1',
            deviceId: body.deviceId,
            startedAt: body.startedAt,
            endedAt: null,
            plannedMinutes: body.durationMin,
            actualMinutes: 0,
            status: 'ACTIVE',
            source: body.source,
            clientSessionId: body.clientSessionId,
            endReason: null,
            lastHeartbeatAt: null,
          }),
        );
      }
      if (url.includes('/sessions/') && method === 'PATCH') {
        calls.patched.push({ url, body: JSON.parse(String(init?.body)) });
        return Promise.resolve(envelope({ id: 'sess-1' }));
      }
      if (url.includes('/sessions')) return Promise.resolve(page(existing));

      return Promise.resolve(
        envelope({ success: false, error: { code: 'NOT_FOUND', message: 'nope' } }, 404),
      );
    }),
  );

  return calls;
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

function tree(
  overrides: Partial<AgentLinkContextValue>,
  initialEntry = '/dashboard',
) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AgentLinkContext.Provider value={makeAgentLinkValue(overrides)}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <LocationProbe />
                  <FocusSessionSync />
                </>
              }
            />
          </Routes>
        </AgentLinkContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderSync(overrides: Partial<AgentLinkContextValue>, initialEntry = '/dashboard') {
  return render(tree(overrides, initialEntry));
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FocusSessionSync', () => {
  it('creates the REST session once when the agent reports focusStarted and opens /focus', async () => {
    const calls = installFetch();
    renderSync({
      status: 'FOCUSING',
      session: SESSION,
      startedSessionId: SESSION_ID,
    });

    await waitFor(() => expect(calls.created).toHaveLength(1));

    expect(calls.created[0]).toEqual({
      deviceId: DEVICE_ID,
      durationMin: 60,
      startedAt: STARTED_AT,
      clientSessionId: SESSION_ID,
      source: 'MANUAL',
    });
    expect(screen.getByTestId('path')).toHaveTextContent('/focus');
    expect(toast.success).toHaveBeenCalledWith(FOCUS_STARTED_TOAST);
  });

  it('does not create a second session for a resync of the same session', async () => {
    const calls = installFetch();
    const { rerender } = renderSync({
      status: 'FOCUSING',
      session: SESSION,
      startedSessionId: SESSION_ID,
    });

    await waitFor(() => expect(calls.created).toHaveLength(1));

    rerender(
      tree({
        status: 'FOCUSING',
        session: { ...SESSION },
        startedSessionId: SESSION_ID,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.created).toHaveLength(1);
  });

  it('finalises a timer-completed session as COMPLETED with the agent minutes', async () => {
    const calls = installFetch([
      {
        id: 'sess-1',
        clientSessionId: SESSION_ID,
        status: 'ACTIVE',
        startedAt: STARTED_AT,
      },
    ]);
    renderSync(
      {
        status: 'PAIRED',
        session: null,
        lastEnded: {
          sessionId: SESSION_ID,
          at: ENDED_AT,
          reason: 'COMPLETED',
          actualMinutes: 60,
        },
      },
      '/focus',
    );

    await waitFor(() => expect(calls.patched).toHaveLength(1));

    expect(calls.patched[0]?.url).toContain('/sessions/sess-1');
    expect(calls.patched[0]?.body).toEqual({
      status: 'COMPLETED',
      endedAt: ENDED_AT,
      actualMinutes: 60,
      endReason: 'COMPLETED',
    });
    // On /focus the page itself shows the success panel; no duplicate toast.
    expect(toast.success).not.toHaveBeenCalledWith(FOCUS_ENDED_TOAST);
  });

  it('finalises a user-ended session as CANCELLED', async () => {
    const calls = installFetch([
      { id: 'sess-1', clientSessionId: SESSION_ID, status: 'ACTIVE', startedAt: STARTED_AT },
    ]);
    renderSync({
      status: 'PAIRED',
      session: null,
      lastEnded: { sessionId: SESSION_ID, at: ENDED_AT, reason: 'USER', actualMinutes: 12 },
    });

    await waitFor(() => expect(calls.patched).toHaveLength(1));

    expect(calls.patched[0]?.body).toMatchObject({
      status: 'CANCELLED',
      endReason: 'USER',
      actualMinutes: 12,
    });
    expect(toast.success).toHaveBeenCalledWith(FOCUS_ENDED_TOAST);
  });

  it('never PATCHes twice for the same ended session', async () => {
    const calls = installFetch([
      { id: 'sess-1', clientSessionId: SESSION_ID, status: 'ACTIVE', startedAt: STARTED_AT },
    ]);
    const { rerender } = renderSync({
      status: 'PAIRED',
      session: null,
      lastEnded: { sessionId: SESSION_ID, at: ENDED_AT, reason: 'USER', actualMinutes: 12 },
    });

    await waitFor(() => expect(calls.patched).toHaveLength(1));

    rerender(
      tree({
        status: 'PAIRED',
        session: null,
        lastEnded: {
          sessionId: SESSION_ID,
          at: ENDED_AT,
          reason: 'USER',
          actualMinutes: 12,
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.patched).toHaveLength(1);
  });
});

describe('FocusSessionSync helpers', () => {
  it('maps end reasons to terminal statuses', () => {
    expect(finalStatusFor('COMPLETED')).toBe('COMPLETED');
    expect(finalStatusFor('USER')).toBe('CANCELLED');
    expect(finalStatusFor('SLEEP')).toBe('CANCELLED');
    expect(finalStatusFor('CRASH_RECOVERY')).toBe('CANCELLED');
    expect(finalStatusFor('QUIT')).toBe('CANCELLED');
    expect(finalStatusFor('UNPAIRED')).toBe('CANCELLED');
  });

  it('picks the online device, then a paired one, and never invents an id', () => {
    expect(pickFocusDeviceId([DEVICE as never])).toBe(DEVICE_ID);

    const pairedOnly = { ...DEVICE, status: 'DISCONNECTED' };
    expect(pickFocusDeviceId([pairedOnly as never])).toBe(DEVICE_ID);

    const unpaired = { ...DEVICE, status: 'DISCONNECTED', pairedAt: null };
    expect(pickFocusDeviceId([unpaired as never])).toBeNull();
  });
});
