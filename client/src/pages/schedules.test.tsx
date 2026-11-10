/*
 * `/schedules` tests (T-067, FR-012/FR-025, UX_SPEC §4.7, NFR-007): the list renders real records in
 * the user's IANA timezone, the enable/disable switch PATCHes `enabled`, the create/edit dialog
 * validates with the shared schedule rules and POST/PATCHes, and delete asks for confirmation before
 * DELETE. Nothing here asserts a session started — execution is server-side.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { AgentLinkContext } from '../agent/agent-link-provider';
import type { Schedule } from '../api/types';
import { AuthContext } from '../auth/auth-context';
import {
  createTestQueryClient,
  makeAgentLinkValue,
  makeAuthValue,
  makeUser,
} from '../test/test-utils';
import { SchedulesPage } from './schedules';

const USER = makeUser({ timezone: 'Asia/Kolkata' });

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: '507f1f77bcf86cd799439030',
    name: 'Coding block',
    days: [1, 2, 3, 4, 5],
    startTime: '09:00',
    durationMin: 60,
    enabled: true,
    lastRunAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

interface InstalledApi {
  state: { items: Schedule[] };
  fetchMock: ReturnType<typeof vi.fn>;
}

function installApi(items: Schedule[] = [makeSchedule()]): InstalledApi {
  const state = { items: items.map((schedule) => ({ ...schedule })) };
  let nextId = 1;

  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;

    if (path.endsWith('/schedules') && method === 'GET') {
      return Promise.resolve(
        fakeResponse({
          success: true,
          data: {
            items: state.items,
            page: 1,
            limit: 50,
            total: state.items.length,
            totalPages: 1,
          },
        }),
      );
    }

    if (path.endsWith('/schedules') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Omit<
        Schedule,
        'id' | 'lastRunAt' | 'createdAt'
      >;
      const created: Schedule = {
        ...body,
        id: `507f1f77bcf86cd79943903${nextId}`,
        lastRunAt: null,
        createdAt: '2026-11-10T10:00:00.000Z',
      };
      nextId += 1;
      state.items = [created, ...state.items];
      return Promise.resolve(fakeResponse({ success: true, data: created }, 201));
    }

    const idMatch = /\/schedules\/([^/]+)$/.exec(path);
    if (idMatch !== null) {
      const id = idMatch[1] ?? '';
      if (method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as Partial<Schedule>;
        const index = state.items.findIndex((schedule) => schedule.id === id);
        if (index === -1) {
          return Promise.resolve(
            fakeResponse({ success: false, error: { code: 'NOT_FOUND', message: 'Missing' } }, 404),
          );
        }
        const current = state.items[index] as Schedule;
        const updated: Schedule = { ...current, ...body };
        state.items = state.items.map((schedule) => (schedule.id === id ? updated : schedule));
        return Promise.resolve(fakeResponse({ success: true, data: updated }));
      }
      if (method === 'DELETE') {
        state.items = state.items.filter((schedule) => schedule.id !== id);
        return Promise.resolve(fakeResponse({ success: true, data: { id } }));
      }
    }

    throw new Error(`Unexpected schedules request: ${method} ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { state, fetchMock };
}

function renderPage(agent = makeAgentLinkValue({ status: 'PAIRED' })) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <AuthContext.Provider value={makeAuthValue({ status: 'authenticated', user: USER })}>
          <AgentLinkContext.Provider value={agent}>
            <SchedulesPage />
          </AgentLinkContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>, method: string) {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === method,
  );
}

async function openCreateDialog(): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(
    (await screen.findAllByRole('button', { name: 'New schedule' }))[0] as HTMLElement,
  );
  return screen.findByRole('dialog', { name: 'New schedule' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SchedulesPage — list', () => {
  it('renders real schedules with days, time, duration, timezone and the next run', async () => {
    installApi([
      makeSchedule(),
      makeSchedule({
        id: '507f1f77bcf86cd799439031',
        name: 'Evening',
        days: [0],
        startTime: '19:00',
        enabled: false,
      }),
    ]);
    renderPage();

    expect(await screen.findByText('Coding block')).toBeInTheDocument();
    expect(screen.getByText('Times shown in Asia/Kolkata.')).toBeInTheDocument();
    expect(
      screen.getByText(/Mon, Tue, Wed, Thu, Fri · 09:00 · 60 m · Asia\/Kolkata/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Next run: (today|tomorrow|\w+day) 09:00 · Asia\/Kolkata/),
    ).toBeInTheDocument();

    expect(screen.getByText('Evening')).toBeInTheDocument();
    expect(screen.getByText('Disabled — no run scheduled.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Evening enabled' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('warns that no Focus Agent is connected, without inventing a run', async () => {
    installApi();
    renderPage(makeAgentLinkValue({ status: 'DISCONNECTED' }));

    expect(
      await screen.findByText("No Focus Agent connected — this schedule can't start until one is."),
    ).toBeInTheDocument();
  });

  it('shows loading and error states for the list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          fakeResponse({ success: false, error: { code: 'INTERNAL', message: 'nope' } }, 500),
        ),
      ),
    );
    renderPage();

    expect(screen.getByText('Loading your schedules…')).toBeInTheDocument();
    expect(await screen.findByText("We couldn't load your schedules.")).toBeInTheDocument();
    expect(screen.getByText('(Ref: INTERNAL)')).toBeInTheDocument();
  });

  it('shows the approved empty state', async () => {
    installApi([]);
    renderPage();

    expect(
      await screen.findByRole('heading', {
        name: 'No schedules yet. Add one for your next deep-work block.',
      }),
    ).toBeInTheDocument();
  });
});

describe('SchedulesPage — enable/disable', () => {
  it('PATCHes only the enabled flag and updates the row', async () => {
    const user = userEvent.setup();
    const api = installApi();
    renderPage();

    const toggle = await screen.findByRole('switch', { name: 'Coding block enabled' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);

    await waitFor(() => expect(callsTo(api.fetchMock, 'PATCH')).toHaveLength(1));
    const patch = callsTo(api.fetchMock, 'PATCH')[0];
    expect(String(patch?.[0])).toContain(`/schedules/${makeSchedule().id}`);
    expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ enabled: false });

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Coding block enabled' })).toHaveAttribute(
        'aria-checked',
        'false',
      ),
    );
    expect(screen.getByText('Disabled — no run scheduled.')).toBeInTheDocument();
  });
});

describe('SchedulesPage — create and edit', () => {
  it('creates a schedule through POST with the shared days/time/duration rules', async () => {
    const user = userEvent.setup();
    const api = installApi([]);
    renderPage();

    const dialog = await openCreateDialog();
    await user.type(within(dialog).getByLabelText(/^Name/), 'Deep work');
    await user.click(within(dialog).getByRole('button', { name: 'Mon' }));
    await user.click(within(dialog).getByRole('button', { name: 'Wed' }));

    const startTime = within(dialog).getByLabelText('Start time');
    await user.clear(startTime);
    await user.type(startTime, '14:30');

    const duration = within(dialog).getByLabelText('Duration in minutes');
    await user.clear(duration);
    await user.type(duration, '45');

    await user.click(within(dialog).getByRole('button', { name: 'Save schedule' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo(api.fetchMock, 'POST')).toHaveLength(1);
    const post = callsTo(api.fetchMock, 'POST')[0];
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      name: 'Deep work',
      days: [1, 3],
      startTime: '14:30',
      durationMin: 45,
      enabled: true,
    });

    expect(await screen.findByText('Deep work')).toBeInTheDocument();
    expect(screen.getByText(/Mon, Wed · 14:30 · 45 m · Asia\/Kolkata/)).toBeInTheDocument();
  });

  it('validates inline: at least one day, a name, HH:mm and 1–480 minutes', async () => {
    const user = userEvent.setup();
    const api = installApi([]);
    renderPage();

    const dialog = await openCreateDialog();
    const startTime = within(dialog).getByLabelText('Start time');
    await user.clear(startTime);
    await user.type(startTime, '9:5');
    const duration = within(dialog).getByLabelText('Duration in minutes');
    await user.clear(duration);
    await user.type(duration, '0');

    await user.click(within(dialog).getByRole('button', { name: 'Save schedule' }));

    expect(await within(dialog).findByText('Pick at least one day')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Enter a name between 2 and 60 characters.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Use 24-hour HH:mm, for example 09:00.')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Enter a whole number of minutes between 1 and 480.'),
    ).toBeInTheDocument();
    expect(callsTo(api.fetchMock, 'POST')).toHaveLength(0);
  });

  it('edits an existing schedule through PATCH with the prefilled values', async () => {
    const user = userEvent.setup();
    const api = installApi();
    renderPage();

    await screen.findByText('Coding block');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit schedule' });

    const name = within(dialog).getByLabelText(/^Name/);
    expect(name).toHaveValue('Coding block');
    expect(within(dialog).getByRole('button', { name: 'Mon' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.clear(name);
    await user.type(name, 'Morning block');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const patch = callsTo(api.fetchMock, 'PATCH')[0];
    expect(String(patch?.[0])).toContain(`/schedules/${makeSchedule().id}`);
    expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({
      name: 'Morning block',
      days: [1, 2, 3, 4, 5],
      startTime: '09:00',
      durationMin: 60,
      enabled: true,
    });
    expect(await screen.findByText('Morning block')).toBeInTheDocument();
  });
});

describe('SchedulesPage — delete', () => {
  it('asks for confirmation, then DELETEs the schedule and removes the row', async () => {
    const user = userEvent.setup();
    const api = installApi();
    renderPage();

    await screen.findByText('Coding block');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this schedule?' });
    expect(within(confirm).getByText(/will no longer start a focus session/)).toBeInTheDocument();

    await user.click(within(confirm).getByRole('button', { name: 'Delete schedule' }));

    await waitFor(() => expect(callsTo(api.fetchMock, 'DELETE')).toHaveLength(1));
    expect(String(callsTo(api.fetchMock, 'DELETE')[0]?.[0])).toContain(
      `/schedules/${makeSchedule().id}`,
    );
    expect(
      await screen.findByRole('heading', {
        name: 'No schedules yet. Add one for your next deep-work block.',
      }),
    ).toBeInTheDocument();
  });

  it('keeps the row when the user cancels the confirmation', async () => {
    const user = userEvent.setup();
    const api = installApi();
    renderPage();

    await screen.findByText('Coding block');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this schedule?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo(api.fetchMock, 'DELETE')).toHaveLength(0);
    expect(screen.getByText('Coding block')).toBeInTheDocument();
  });
});
