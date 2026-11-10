// ui/view-state.test.ts — the window view-model rules (T-059, FR-022, REC-004/REC-008).
// These tests pin the copy and the absolute-time countdown without a display: the renderer is a
// sandboxed script, so anything testable must live in this pure module. They also fail when the
// renderer/HTML copy drifts from here, because duplicated copy is the one real risk of a
// classic-script renderer (no imports allowed under the strict CSP).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AppEntry, SessionInfo } from '@focus-mode/shared';
import {
  AGENT_IPC_CHANNELS,
  AGENT_STATE_HEADLINES,
  PROTECTED_EXPLANATION,
  START_AT_LOGIN_DEFAULT,
  START_AT_LOGIN_EXPLANATION,
  allowListCountLine,
  buildAgentWindowView,
  buildAllowListView,
  dateLabel,
  describeConsent,
  formatClock,
  formatCountdown,
  formatPairingCode,
  startAtLoginView,
  type AgentViewState,
} from './view-state.js';

const PROTECTED: readonly AppEntry[] = [
  { key: 'browser', label: 'All web browsers', mac: ['com.google.Chrome'] },
  { key: 'focus-agent', label: 'Focus Agent', mac: ['com.focusmode.agent'] },
  { key: 'finder', label: 'Finder', mac: ['com.apple.finder'] },
  { key: 'dock', label: 'Dock', mac: ['com.apple.dock'] },
  { key: 'system-settings', label: 'System Settings', mac: ['com.apple.systempreferences'] },
  { key: 'activity-monitor', label: 'Activity Monitor', mac: ['com.apple.ActivityMonitor'] },
  { key: 'terminal', label: 'Terminal', mac: ['com.apple.Terminal'] },
  { key: 'systemuiserver', label: 'SystemUIServer', mac: ['com.apple.systemuiserver'] },
];

const USER_APPS: readonly AppEntry[] = [
  { key: 'vscode', label: 'Visual Studio Code', mac: ['com.microsoft.VSCode'] },
  { key: 'slack', label: 'Slack', mac: ['com.tinyspeck.slackmacgap'] },
];

const SESSION: SessionInfo = {
  sessionId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  startedAt: '2026-11-10T10:17:50.000Z',
  endsAt: '2026-11-10T11:00:00.000Z',
  plannedMinutes: 42,
  source: 'MANUAL',
};

function makeState(overrides: Partial<AgentViewState> = {}): AgentViewState {
  return {
    agentVersion: '0.1.0',
    os: 'macOS',
    state: 'IDLE',
    paired: false,
    pairingCode: '482916',
    capabilities: { focus: 'full' },
    session: null,
    protected: PROTECTED,
    allowList: USER_APPS,
    ...overrides,
  };
}

describe('formatCountdown (absolute endsAt, FR-007)', () => {
  const now = new Date('2026-11-10T10:17:50.000Z');

  it('renders mm:ss from the absolute end time', () => {
    const view = formatCountdown('2026-11-10T11:00:00.000Z', now);
    expect(view.text).toBe('42:10');
    expect(view.expired).toBe(false);
    expect(view.clock).toMatch(/^\d{2}:\d{2}$/);
  });

  it('pads seconds and supports a one-minute session', () => {
    expect(formatCountdown('2026-11-10T10:18:49.000Z', now).text).toBe('00:59');
  });

  it('keeps long sessions in minutes (480-minute maximum, DEC bounds)', () => {
    expect(formatCountdown('2026-11-10T18:17:50.000Z', now).text).toBe('480:00');
  });

  it('reports an end time in the past as expired with 00:00', () => {
    const view = formatCountdown('2026-11-10T10:00:00.000Z', now);
    expect(view.text).toBe('00:00');
    expect(view.expired).toBe(true);
  });

  it('treats the exact end instant as expired (no rounding up)', () => {
    expect(formatCountdown('2026-11-10T10:17:50.000Z', now).expired).toBe(true);
  });

  it('never throws on an unparsable timestamp', () => {
    expect(formatCountdown('not-a-date', now)).toEqual({ text: '—', expired: false, clock: '—' });
  });

  it('formats a local wall clock deterministically as HH:MM', () => {
    expect(formatClock(new Date(2026, 10, 10, 9, 5))).toBe('09:05');
  });
});

describe('formatPairingCode', () => {
  it('groups the six digits for the large mono display', () => {
    expect(formatPairingCode('482916')).toBe('4 8 2 9 1 6');
  });

  it('refuses anything that is not exactly six digits', () => {
    expect(formatPairingCode(null)).toBeNull();
    expect(formatPairingCode('12345')).toBeNull();
    expect(formatPairingCode('1234567')).toBeNull();
    expect(formatPairingCode('12a456')).toBeNull();
  });
});

describe('allow-list view (read-only, INV-3/INV-6)', () => {
  it('marks every protected row locked and never renders a remove control', () => {
    const view = buildAllowListView(PROTECTED, USER_APPS);
    const locked = view.rows.filter((row) => row.locked);
    expect(locked).toHaveLength(7); // six previewed rows + one "+N more protected" summary
    expect(view.rows.filter((row) => !row.locked).map((row) => row.label)).toEqual([
      'Visual Studio Code',
      'Slack',
    ]);
    expect(view.rows.some((row) => 'removable' in row)).toBe(false);
  });

  it('carries only key/label/locked — no window titles or URLs (INV-6)', () => {
    const view = buildAllowListView(PROTECTED, USER_APPS);
    for (const row of view.rows) {
      const allowed =
        row.summary === true ? ['key', 'label', 'locked', 'summary'] : ['key', 'label', 'locked'];
      expect(Object.keys(row).sort()).toEqual(allowed.sort());
    }
  });

  it('counts protected and user apps, and reports the empty state', () => {
    const view = buildAllowListView(PROTECTED, []);
    expect(view.protectedCount).toBe(PROTECTED.length);
    expect(view.userCount).toBe(0);
    expect(view.empty).toBe(true);
    expect(view.summary).toBe('8 apps protected and 0 apps allowed to stay open');
  });

  it('renders a plain-language count line', () => {
    expect(allowListCountLine(0)).toBe('No extra apps are allowed to stay open yet');
    expect(allowListCountLine(1)).toBe('1 app allowed to stay open');
    expect(allowListCountLine(3)).toBe('3 apps allowed to stay open');
  });
});

describe('window phases and pairing (FR-022)', () => {
  it('renders the real six-digit code and the waiting hint while unpaired', () => {
    const view = buildAgentWindowView(makeState(), new Date('2026-11-10T10:00:00.000Z'));
    expect(view.phase).toBe('UNPAIRED');
    expect(view.headline).toBe(AGENT_STATE_HEADLINES.IDLE);
    expect(view.headline).toBe('◇ Not paired — waiting for the dashboard to pair');
    expect(view.pairing?.code).toBe('4 8 2 9 1 6');
    expect(view.pairing?.hint).toContain(
      'Enter this code on the dashboard: Devices → Pair a device',
    );
    expect(view.focus).toBeNull();
    expect(view.endFocusEnabled).toBe(false);
    expect(view.startHint).toBeNull();
  });

  it('shows the code expiry from the cloud and rotates honestly when it has passed', () => {
    const now = new Date('2026-11-10T10:00:00.000Z');
    const live = buildAgentWindowView(
      makeState({ pairingExpiresAt: '2026-11-10T10:09:41.000Z' }),
      now,
    );
    expect(live.pairing?.expiry).toBe('Expires in 09:41');

    const expired = buildAgentWindowView(
      makeState({ pairingExpiresAt: '2026-11-10T09:59:00.000Z' }),
      now,
    );
    expect(expired.pairing?.expiry).toContain('a new one is on its way');
  });

  it('waits honestly when no real code has been issued yet', () => {
    const view = buildAgentWindowView(makeState({ pairingCode: null }));
    expect(view.pairing?.code).toBeNull();
    expect(view.pairing?.hint).toContain('Waiting for Focus Mode to issue a pairing code');
  });

  it('renders the paired state with the account email and a start-from-dashboard hint', () => {
    const view = buildAgentWindowView(
      makeState({ state: 'PAIRED', paired: true, accountEmail: 'user@example.com' }),
    );
    expect(view.phase).toBe('PAIRED');
    expect(view.headline).toBe('◆ Connected to user@example.com — ready');
    expect(view.pairing).toBeNull();
    expect(view.startHint).toBe('Start a focus session from the dashboard on this computer.');
    // The allow-list summary and count are the "what stays open" hint for the paired state.
    expect(view.allowList.summary).toBe('8 apps protected and 2 apps allowed to stay open');
  });

  it('treats a stale IDLE state with paired=true as paired, never as unpaired', () => {
    const view = buildAgentWindowView(makeState({ state: 'IDLE', paired: true }));
    expect(view.phase).toBe('PAIRED');
    expect(view.pairing).toBeNull();
  });
});

describe('focusing state (FR-009, FR-022)', () => {
  const now = new Date('2026-11-10T10:17:50.000Z');
  const focusing = makeState({ state: 'FOCUSING', paired: true, session: SESSION });

  it('shows the remaining time, end clock, source, allow-list count and End focus', () => {
    const view = buildAgentWindowView(focusing, now);
    expect(view.phase).toBe('FOCUSING');
    expect(view.focus).toEqual({
      remaining: '42:10 remaining',
      endsAt: expect.stringMatching(/^\d{2}:\d{2}$/),
      expired: false,
      source: 'MANUAL',
      sourceLine: 'Started from the dashboard',
      allowListCount: 2,
      allowListLine: '2 apps allowed to stay open',
    });
    expect(view.endFocusEnabled).toBe(true);
    expect(view.pairing).toBeNull();
  });

  it('labels a scheduled session as such', () => {
    const view = buildAgentWindowView(
      makeState({
        state: 'FOCUSING',
        paired: true,
        session: { ...SESSION, source: 'SCHEDULE' },
      }),
      now,
    );
    expect(view.focus?.source).toBe('SCHEDULE');
    expect(view.focus?.sourceLine).toBe('Started by a schedule');
  });

  it('shows a restoring message once endsAt is in the past', () => {
    const view = buildAgentWindowView(focusing, new Date('2026-11-10T11:00:01.000Z'));
    expect(view.focus?.remaining).toBe('Time is up — restoring your windows');
    expect(view.focus?.expired).toBe(true);
    // End focus stays available while the agent is still restoring (idempotent, INV-5).
    expect(view.endFocusEnabled).toBe(true);
  });

  it('does not claim a focus session when FOCUSING has no session snapshot', () => {
    const view = buildAgentWindowView(makeState({ state: 'FOCUSING', paired: true }), now);
    expect(view.focus).toBeNull();
    expect(view.endFocusEnabled).toBe(true);
  });
});

describe('honest error states', () => {
  it('uses the exact UX copy when window control is unsupported', () => {
    const view = buildAgentWindowView(
      makeState({
        capabilities: { focus: 'unsupported', reasons: ['Wayland session'] },
        paired: true,
        state: 'PAIRED',
      }),
    );
    expect(view.alerts[0]).toEqual({
      title: 'Window control unavailable',
      body:
        "Window control isn't available on this system (Wayland session). Scheduled sessions " +
        "won't start here.",
    });
  });

  it('explains a missing API base URL instead of showing a dead pairing code', () => {
    const view = buildAgentWindowView(
      makeState({ links: { cloud: 'not-configured', dashboard: 'listening' } }),
    );
    expect(view.links.cloudLine).toBe('Cloud: ✕ Not configured');
    expect(view.links.dashboardLine).toBe('Dashboard link: waiting for a dashboard');
    expect(view.alerts.map((alert) => alert.title)).toContain('Cloud pairing is not configured');
    expect(view.alerts[0]?.body).toContain('No API base URL is set');
    // No cloud ⇒ no code will ever arrive, so the window hides the dead pairing panel.
    expect(view.pairing).toBeNull();
  });

  it('reports a cloud link that is down without blocking local control', () => {
    const view = buildAgentWindowView(
      makeState({
        paired: true,
        state: 'PAIRED',
        links: { cloud: 'disconnected', dashboard: 'connected' },
      }),
    );
    expect(view.alerts.map((alert) => alert.title)).toContain('Cloud link is down');
    expect(view.links.dashboardLine).toBe('Dashboard link: ✓ Connected');
  });

  it('reports a link server that is not running', () => {
    const view = buildAgentWindowView(
      makeState({ links: { cloud: 'connected', dashboard: 'down' } }),
    );
    expect(view.links.dashboardLine).toBe('Dashboard link: ✕ Not running');
    expect(view.alerts.map((alert) => alert.title)).toContain('Dashboard link is not running');
  });

  it('does not invent connection state when main has not reported it', () => {
    const view = buildAgentWindowView(makeState());
    expect(view.links.cloudLine).toContain('status not reported by this build');
    expect(view.links.dashboardLine).toContain('status not reported by this build');
    expect(view.alerts).toEqual([]);
  });
});

describe('first-run consent (REC-004)', () => {
  it('renders not-reported until main supplies the stored decision', () => {
    expect(describeConsent(undefined)).toEqual({
      text: 'First-run permission: not reported by this build.',
      tone: 'muted',
      canReset: false,
    });
  });

  it('renders a stored grant with its date and whether it can be reset', () => {
    expect(
      describeConsent({
        status: 'granted',
        grantedAt: '2026-11-02T12:00:00.000Z',
        revocable: true,
      }),
    ).toEqual({
      text: 'First-run permission: granted on 2 Nov 2026',
      tone: 'ok',
      canReset: true,
    });
  });

  it('renders a denial as "asked again", never as consent', () => {
    const line = describeConsent({ status: 'not-granted', grantedAt: null, revocable: false });
    expect(line.text).toContain('not granted');
    expect(line.canReset).toBe(false);
  });

  it('formats consent dates and rejects garbage timestamps', () => {
    expect(dateLabel('2026-11-02T12:00:00.000Z')).toBe('2 Nov 2026');
    expect(dateLabel('nope')).toBeNull();
  });
});

describe('start at login (REC-008)', () => {
  it('is OFF by default and never claims otherwise', () => {
    expect(START_AT_LOGIN_DEFAULT).toBe(false);
    expect(startAtLoginView(null)).toEqual({
      label: 'Start at login',
      checked: false,
      defaultEnabled: false,
      explanation: START_AT_LOGIN_EXPLANATION,
    });
    expect(startAtLoginView(false).checked).toBe(false);
  });

  it('mirrors an explicit OS choice and always carries the explanation', () => {
    const view = startAtLoginView(true);
    expect(view.checked).toBe(true);
    expect(view.explanation).toContain('Focus Mode never starts itself');
  });
});

describe('IPC contract and renderer copy stay in sync', () => {
  const read = (name: string): string =>
    readFileSync(new URL(name, import.meta.url), 'utf8').replace(/\s+/g, ' ');

  it('freezes exactly three IPC channels (the consent read reuses getState)', () => {
    expect(Object.keys(AGENT_IPC_CHANNELS).sort()).toEqual(['endFocus', 'getState', 'quit']);
  });

  it('keeps the renderer copy aligned with this module', () => {
    const renderer = read('./renderer.ts');
    for (const phrase of [
      '◇ Not paired — waiting for the dashboard to pair',
      'Enter this code on the dashboard: Devices → Pair a device.',
      'Waiting for Focus Mode to issue a pairing code…',
      'First-run permission: not reported by this build.',
      'Start a focus session from the dashboard on this computer.',
      'First-run permission: not granted — you’ll be asked before your first focus session.',
      'Focus Mode never starts itself.',
      'No API base URL is set, so this Focus Agent cannot pair or receive scheduled sessions.',
      'Time is up — restoring your windows',
    ]) {
      expect(renderer, phrase).toContain(phrase);
    }
  });

  it('keeps the static HTML aligned with the same copy', () => {
    const html = read('./index.html');
    for (const phrase of [
      'Focus session in progress',
      'Allow-list (read-only)',
      PROTECTED_EXPLANATION,
      'Start at login',
      'First-run permission:',
      'Quit Focus Agent',
    ]) {
      expect(html, phrase).toContain(phrase);
    }
  });
});
