/*
 * `/devices` tests (T-046, FR-003, NFR-007): the real list with loading/empty/error/success states,
 * the 6-digit pair dialog (shared `devicePairSchema`, POST /devices/pair, local `paired` nudge and
 * list refresh) and the confirmed unpair (DELETE /devices/:id). `fetch` is stubbed at the transport
 * boundary, so the page exercises the real API modules and TanStack Query wiring.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { AgentLinkContext, type AgentLinkContextValue } from '../agent/agent-link-provider';
import type { Device } from '../api/types';
import { createTestQueryClient, makeAgentLinkValue } from '../test/test-utils';
import { DevicesPage } from './devices';

const DEVICE: Device = {
  id: '507f1f77bcf86cd799439011',
  name: "Kabir's MacBook",
  os: 'macOS',
  status: 'CONNECTED',
  agentVersion: '1.4.0',
  pairedAt: '2026-11-02T10:00:00.000Z',
  lastSeenAt: '2026-11-10T10:00:00.000Z',
  capabilities: { focus: 'full' },
};

const INVALID_CODE_COPY =
  'That pairing code is wrong or has expired. Check the 6 digits in your Focus Agent and try again.';

function devicePage(items: Device[]) {
  return {
    success: true,
    data: { items, page: 1, limit: 20, total: items.length, totalPages: 1 },
  };
}

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {})),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderDevices(agent: AgentLinkContextValue = makeAgentLinkValue()) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <AgentLinkContext.Provider value={agent}>
          <DevicesPage />
        </AgentLinkContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openPairDialog(): Promise<HTMLElement> {
  const buttons = await screen.findAllByRole('button', { name: 'Pair a device' });
  const [first] = buttons;
  if (first === undefined) throw new Error('Pair a device button not rendered');
  await userEvent.setup().click(first);
  return screen.findByRole('dialog');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DevicesPage', () => {
  it('lists real devices with status, OS, version and timestamps', async () => {
    installFetch(() => fakeResponse(devicePage([DEVICE])));

    renderDevices();

    expect(await screen.findByText("Kabir's MacBook")).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('macOS · Focus Agent 1.4.0')).toBeInTheDocument();
    expect(screen.getByText('Window control: Full')).toBeInTheDocument();
  });

  it('shows the "No device connected" empty state when the list is empty', async () => {
    installFetch(() => fakeResponse(devicePage([])));

    renderDevices();

    expect(
      await screen.findByRole('heading', {
        name: 'No device connected — start your Focus Agent',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Already installed\? Open the Focus Agent and come back/),
    ).toBeInTheDocument();
  });

  it('shows the error state and retries the list fetch', async () => {
    const user = userEvent.setup();
    let firstRequest = true;
    installFetch(() => {
      if (firstRequest) {
        firstRequest = false;
        return fakeResponse(
          { success: false, error: { code: 'INTERNAL', message: 'Database unavailable' } },
          500,
        );
      }
      return fakeResponse(devicePage([DEVICE]));
    });

    renderDevices();

    expect(await screen.findByText("We couldn't load your devices.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText("Kabir's MacBook")).toBeInTheDocument();
  });

  it('pairs with a 6-digit code, nudges the agent, refreshes the list and closes the dialog', async () => {
    const user = userEvent.setup();
    const notifyPaired = vi.fn();
    let paired = false;

    const fetchMock = installFetch((url) => {
      if (url.endsWith('/devices/pair')) {
        paired = true;
        return fakeResponse({ success: true, data: { device: DEVICE } });
      }
      return fakeResponse(devicePage(paired ? [DEVICE] : []));
    });

    renderDevices(makeAgentLinkValue({ notifyPaired }));
    await screen.findByRole('heading', { name: 'No device connected — start your Focus Agent' });

    const dialog = await openPairDialog();
    const codeInput = within(dialog).getByLabelText(/6-digit pairing code/i);
    const submit = within(dialog).getByRole('button', { name: 'Pair device' });

    expect(submit).toBeDisabled();
    await user.type(codeInput, '483920');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const pairCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/devices/pair'),
    );
    expect(pairCall).toBeDefined();
    expect(pairCall?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(pairCall?.[1]?.body))).toEqual({ code: '483920' });

    expect(notifyPaired).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Kabir's MacBook")).toBeInTheDocument();
  });

  it('keeps the pair dialog open and shows the inline copy for an invalid code', async () => {
    const user = userEvent.setup();
    installFetch((url) => {
      if (url.endsWith('/devices/pair')) {
        return fakeResponse(
          { success: false, error: { code: 'INVALID_PAIRING_CODE', message: 'Code rejected' } },
          400,
        );
      }
      return fakeResponse(devicePage([]));
    });

    renderDevices();
    const dialog = await openPairDialog();
    await user.type(within(dialog).getByLabelText(/6-digit pairing code/i), '000000');
    await user.click(within(dialog).getByRole('button', { name: 'Pair device' }));

    expect(await within(dialog).findByText(INVALID_CODE_COPY)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('unpairs after confirmation, refreshes the list and re-handshakes the agent (KI-010)', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    let removed = false;

    const fetchMock = installFetch((url, init) => {
      if (init.method === 'DELETE') {
        removed = true;
        return fakeResponse({ success: true, data: { id: DEVICE.id, revoked: true } });
      }
      return fakeResponse(devicePage(removed ? [] : [DEVICE]));
    });

    renderDevices(makeAgentLinkValue({ refresh }));
    await screen.findByText("Kabir's MacBook");

    await user.click(screen.getByRole('button', { name: 'Unpair' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Unpair this device?')).toBeInTheDocument();
    expect(within(dialog).getByText(/will stop being able to start focus/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Unpair' }));

    expect(
      await screen.findByRole('heading', { name: 'No device connected — start your Focus Agent' }),
    ).toBeInTheDocument();

    const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(deleteCall).toBeDefined();
    expect(String(deleteCall?.[0])).toContain(`/devices/${DEVICE.id}`);

    // KI-010: the badge must flip to "Not paired" without a reload, so the shell re-handshakes.
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
