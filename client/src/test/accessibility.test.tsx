/*
 * Route-level accessibility checks (NFR-008 / T-084).
 *
 * Runs axe-core against every primary route in jsdom, asserting there are no `serious` or
 * `critical` violations. The rendered tree is the real page (plus the real AppShell where the
 * route has one), with `fetch` stubbed at the transport boundary so each screen is checked in its
 * success state rather than a skeleton.
 *
 * Permitted exception — `color-contrast`: jsdom has no canvas/text metrics, so axe cannot compute
 * rendered colours. Contrast is audited at token level in UX_SPEC §2 (43 text pairs / 10 UI pairs)
 * and the token values are asserted elsewhere. A real-browser run of the same assertions is
 * described in the task-41 report as an `@axe-core/playwright` spec (e2e/ is A8's scope).
 *
 * The Recharts bar chart on `/insights` needs no rule exemption: the SVG is `aria-hidden` and the
 * same numbers are exposed as an `sr-only` summary plus a `<details>` table, which is the pattern
 * UX_SPEC §10.7 asks for. Fixes found by these runs: the DurationChips `Custom…` button pointed
 * `aria-controls` at an input that was not rendered (`aria-valid-attr-value`, critical), and the
 * FocusIndicator bar sat outside every landmark (`region`, moderate) — both fixed in this wave.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import axe, { type AxeResults, type Result } from 'axe-core';

import type { AgentLink } from '../api/types';
import {
  AgentLinkContext,
  type AgentLinkContextValue,
  type AgentSessionSummary,
} from '../agent/agent-link-provider';
import { AuthContext } from '../auth/auth-context';
import { AppShell } from '../components/layout/app-shell';
import { AdminPage } from '../pages/admin';
import { AllowlistPage } from '../pages/allowlist';
import { DashboardPage } from '../pages/dashboard';
import { DevicesPage } from '../pages/devices';
import { FocusPage } from '../pages/focus';
import { InsightsPage } from '../pages/insights';
import { LandingPage } from '../pages/landing';
import { LoginPage } from '../pages/login';
import { SchedulesPage } from '../pages/schedules';
import { SettingsPage } from '../pages/settings';
import { SignupPage } from '../pages/signup';
import { createTestQueryClient, makeAgentLinkValue, makeAuthValue, makeUser } from './test-utils';

const USER = makeUser({ timezone: 'Asia/Kolkata', defaultDurationMin: 25 });
const ADMIN = makeUser({
  id: '507f1f77bcf86cd799439001',
  name: 'Meera Admin',
  email: 'admin@demo.com',
  role: 'ADMIN',
});

const SESSION: AgentSessionSummary = {
  sessionId: '9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c',
  startedAt: '2026-11-10T09:55:00.000Z',
  endsAt: '2099-11-10T10:55:00.000Z',
  plannedMinutes: 60,
  source: 'MANUAL',
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

function success(data: unknown): unknown {
  return { success: true, data };
}

function page<T>(items: T[]): unknown {
  return success({ items, page: 1, limit: 20, total: items.length, totalPages: 1 });
}

function fakeResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

const DEVICE = {
  id: '507f1f77bcf86cd799439011',
  name: "Kabir's MacBook",
  os: 'macOS',
  status: 'CONNECTED',
  agentVersion: '1.4.0',
  pairedAt: '2026-11-02T10:00:00.000Z',
  lastSeenAt: '2026-11-10T10:00:00.000Z',
};

const SCHEDULE = {
  id: '507f1f77bcf86cd799439030',
  name: 'Coding block',
  days: [1, 2, 3, 4, 5],
  startTime: '09:00',
  durationMin: 60,
  enabled: true,
  lastRunAt: null,
  createdAt: '2026-11-01T10:00:00.000Z',
};

const FOCUS_SESSION = {
  id: '507f1f77bcf86cd799439020',
  deviceId: DEVICE.id,
  startedAt: '2026-11-10T04:00:00.000Z',
  endedAt: '2026-11-10T05:00:00.000Z',
  plannedMinutes: 60,
  actualMinutes: 60,
  status: 'COMPLETED',
  source: 'MANUAL',
  clientSessionId: '9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c',
  endReason: 'COMPLETED',
  lastHeartbeatAt: '2026-11-10T04:59:00.000Z',
};

const ALLOWLIST = {
  protectedApps: [
    { key: 'chrome', label: 'Google Chrome' },
    { key: 'focus-agent', label: 'Focus Agent' },
  ],
  userApps: [
    { key: 'vscode', label: 'Visual Studio Code' },
    { key: 'slack', label: 'Slack' },
  ],
  version: 3,
};

const INSIGHTS = {
  range: '7d',
  timezone: 'Asia/Kolkata',
  totals: {
    focusMinutes: 320,
    sessions: 8,
    completed: 6,
    cancelled: 2,
    completionRate: 0.75,
    currentStreak: 4,
    longestStreak: 7,
  },
  daily: [
    { date: '2026-11-04', minutes: 20 },
    { date: '2026-11-05', minutes: 60 },
    { date: '2026-11-06', minutes: 40 },
    { date: '2026-11-07', minutes: 80 },
    { date: '2026-11-08', minutes: 0 },
    { date: '2026-11-09', minutes: 60 },
    { date: '2026-11-10', minutes: 60 },
  ],
  bestHours: [{ hour: 9, minutes: 120 }],
};

const STATS = {
  users: 128,
  activeUsers: 120,
  devices: 96,
  connectedDevices: 12,
  sessions: 1204,
  activeSessions: 3,
  focusMinutes: 48_720,
};

/** One transport stub for every route under test — every request a page makes is expected. */
function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/notifications')) return Promise.resolve(fakeResponse(page([])));
      if (url.includes('/agent-links')) return Promise.resolve(fakeResponse(page([MAC_LINK])));
      if (url.includes('/admin/users')) return Promise.resolve(fakeResponse(page([USER, ADMIN])));
      if (url.includes('/admin/stats')) return Promise.resolve(fakeResponse(success(STATS)));
      if (url.includes('/auth/me') || url.includes('/users/me')) {
        return Promise.resolve(fakeResponse(success(USER)));
      }
      if (url.includes('/sessions')) return Promise.resolve(fakeResponse(page([FOCUS_SESSION])));
      if (url.includes('/schedules')) return Promise.resolve(fakeResponse(page([SCHEDULE])));
      if (url.includes('/allowlist')) return Promise.resolve(fakeResponse(success(ALLOWLIST)));
      if (url.includes('/presets')) return Promise.resolve(fakeResponse(page([])));
      if (url.includes('/devices')) return Promise.resolve(fakeResponse(page([DEVICE])));
      if (url.includes('/insights')) return Promise.resolve(fakeResponse(success(INSIGHTS)));
      throw new Error(`unexpected request: ${url}`);
    }),
  );
}

function renderInShell(path: string, page: ReactNode, agent: Partial<AgentLinkContextValue> = {}) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthContext.Provider value={makeAuthValue({ status: 'authenticated', user: USER })}>
          <AgentLinkContext.Provider value={makeAgentLinkValue({ status: 'PAIRED', ...agent })}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path={path} element={page} />
              </Route>
            </Routes>
          </AgentLinkContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderPublic(path: string, page: ReactNode) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthContext.Provider value={makeAuthValue({ status: 'anonymous' })}>
          <AgentLinkContext.Provider value={makeAgentLinkValue()}>
            <Routes>
              <Route path={path} element={page} />
            </Routes>
          </AgentLinkContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** NFR-008 gate: no serious or critical axe violations on the rendered route. */
async function expectNoSeriousViolations(): Promise<AxeResults> {
  let results!: AxeResults;

  // Let the page's own queries settle inside act() so background refetches do not warn while axe
  // is walking a tree that React is still updating.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    results = await axe.run(document.body, {
      rules: {
        // jsdom cannot compute rendered colours (no canvas); token contrast lives in UX_SPEC §2.
        'color-contrast': { enabled: false },
      },
    });
  });

  const blockers: Result[] = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );

  expect(
    blockers.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);

  return results;
}

/**
 * jsdom has no canvas implementation and axe-core still measures text with a 2D context even when
 * the `color-contrast` rule is disabled. A no-op context keeps the run quiet; since the rule stays
 * off, no assertion depends on real measurements. Real colours are checked by the suggested
 * `@axe-core/playwright` spec in the task-41 report.
 */
const REAL_GET_CONTEXT = HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({
    canvas: document.createElement('canvas'),
    font: '',
    textAlign: 'left',
    measureText: () => ({ width: 0 }),
    fillText: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    clearRect: () => undefined,
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = REAL_GET_CONTEXT;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NFR-008 axe checks', () => {
  it('landing', async () => {
    installFetch();
    renderPublic('/', <LandingPage />);
    await screen.findByRole('heading', { level: 1, name: 'Focus on one thing.' });
    await screen.findByRole('link', { name: /Focus Agent for macOS/ });
    await expectNoSeriousViolations();
  });

  it('login', async () => {
    renderPublic('/login', <LoginPage />);
    await screen.findByRole('heading', { name: 'Welcome back' });
    await expectNoSeriousViolations();
  });

  it('signup', async () => {
    renderPublic('/signup', <SignupPage />);
    await screen.findByRole('heading', { name: 'Create your account' });
    await expectNoSeriousViolations();
  });

  it('dashboard', async () => {
    installFetch();
    renderInShell('/dashboard', <DashboardPage />);
    await screen.findByRole('heading', { level: 1, name: /Dashboard/ });
    await screen.findByText('Focused today');
    await expectNoSeriousViolations();
  });

  it('focus', async () => {
    installFetch();
    renderInShell('/focus', <FocusPage />, {
      status: 'FOCUSING',
      session: SESSION,
      runningApps: [
        { key: 'vscode', label: 'Visual Studio Code', running: true },
        { key: 'slack', label: 'Slack', running: true },
      ],
    });
    await screen.findByRole('img', { name: /Focus session:/ });
    await expectNoSeriousViolations();
  });

  it('devices', async () => {
    installFetch();
    renderInShell('/devices', <DevicesPage />);
    await screen.findByRole('heading', { level: 1, name: 'Devices' });
    await expectNoSeriousViolations();
  });

  it('allowlist', async () => {
    installFetch();
    renderInShell('/allowlist', <AllowlistPage />);
    await screen.findByRole('heading', { level: 1, name: 'Allow-list' });
    await screen.findByText('Visual Studio Code');
    await expectNoSeriousViolations();
  });

  it('schedules', async () => {
    installFetch();
    renderInShell('/schedules', <SchedulesPage />);
    await screen.findByRole('heading', { level: 1, name: 'Schedules' });
    await screen.findByText('Coding block');
    await expectNoSeriousViolations();
  });

  it('insights', async () => {
    installFetch();
    renderInShell('/insights', <InsightsPage />);
    await screen.findByRole('heading', { level: 1, name: 'Insights' });
    await screen.findByText('Daily focus minutes');
    // W10 badges + goal are in the tree before axe walks it (listitem labels + progressbar).
    await screen.findByRole('heading', { level: 2, name: 'Achievements' });
    await screen.findByRole('progressbar', { name: 'Weekly goal' });
    await expectNoSeriousViolations();
  });

  it('settings', async () => {
    installFetch();
    renderInShell('/settings', <SettingsPage />);
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await screen.findByText('kabir@demo.com');
    await expectNoSeriousViolations();
  });

  it('admin', async () => {
    installFetch();
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={['/admin']}>
          <AuthContext.Provider value={makeAuthValue({ status: 'authenticated', user: ADMIN })}>
            <AgentLinkContext.Provider value={makeAgentLinkValue({ status: 'PAIRED' })}>
              <Routes>
                <Route element={<AppShell />}>
                  <Route path="/admin" element={<AdminPage />} />
                </Route>
              </Routes>
            </AgentLinkContext.Provider>
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Admin' });
    await screen.findByText('kabir@demo.com');
    await expectNoSeriousViolations();
  });
});
