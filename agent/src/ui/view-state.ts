// ui/view-state.ts — typed, pure view-model for the Focus Agent window (T-059, FR-022).
// The renderer is a sandboxed classic script with no imports, so this module is the shared typed
// source of the IPC payloads *and* the label/countdown rules (unit-tested without a display).
// The renderer mirrors the same copy; a colocated test fails when the two drift. INV-6: the
// allow-list model carries AppEntry keys/labels only — no window titles or URLs ever appear.

import type {
  AgentCapabilities,
  AgentState,
  AppEntry,
  FocusSource,
  OsName,
  SessionInfo,
} from '@focus-mode/shared';

/**
 * IPC channels the preload may invoke. `preload.cts` mirrors these literals because a sandboxed
 * CommonJS preload cannot import this ESM module at runtime; a test asserts they stay in sync.
 * The consent *read* is derived from `getState`, so it costs no extra channel (REC-004).
 */
export const AGENT_IPC_CHANNELS = Object.freeze({
  getState: 'agent:get-state',
  endFocus: 'agent:end-focus',
  quit: 'agent:quit',
} as const);

export type AgentIpcChannel = (typeof AGENT_IPC_CHANNELS)[keyof typeof AGENT_IPC_CHANNELS];

/** Cloud pairing link as reported to the window; `unknown` means "this main process did not say". */
export type CloudLinkStatus = 'connected' | 'disconnected' | 'not-configured' | 'unknown';

/** Local dashboard link: listening but no dashboard attached is a distinct, honest state. */
export type DashboardLinkStatus = 'connected' | 'listening' | 'down' | 'unknown';

export interface AgentLinksView {
  readonly cloud: CloudLinkStatus;
  readonly dashboard: DashboardLinkStatus;
  /** Attached dashboards when the link can report them; omitted otherwise. */
  readonly dashboards?: number;
}

/** First-run native permission state (REC-004). `unknown` = not reported by this build. */
export type ConsentState = 'granted' | 'not-granted' | 'unknown';

export interface ConsentStatusView {
  readonly status: ConsentState;
  /** ISO timestamp of the grant, when recorded. */
  readonly grantedAt: string | null;
  /** True when the recorded grant can be revoked from the agent UI. */
  readonly revocable: boolean;
}

/**
 * Everything the sandboxed renderer may see. The `links`/`consent`/`pairingExpiresAt` fields are
 * optional on purpose: this worker may not edit `agent/src/main.ts`, so a main process that has
 * not wired them yet still compiles and the window degrades to an honest "not reported" line
 * instead of inventing a connected state. The exact wiring requests are in the W3 report.
 */
export interface AgentViewState {
  readonly agentVersion: string;
  readonly os: OsName;
  readonly state: AgentState;
  readonly paired: boolean;
  /** Present only when unpaired; displayed in the agent window, never logged or sent. */
  readonly pairingCode: string | null;
  readonly capabilities: AgentCapabilities;
  readonly session: SessionInfo | null;
  readonly protected: readonly AppEntry[];
  readonly allowList: readonly AppEntry[];
  readonly pairingExpiresAt?: string | null;
  readonly accountEmail?: string | null;
  readonly links?: AgentLinksView;
  readonly consent?: ConsentStatusView;
}

export interface EndFocusResult {
  readonly ok: boolean;
  readonly message?: string;
}

export interface QuitResult {
  readonly ok: boolean;
}

// ---------------------------------------------------------------------------
// Copy (docs/UX_SPEC.md §7.1 and §5.1) — exported so the renderer-sync test can see it.
// ---------------------------------------------------------------------------

export const AGENT_STATE_HEADLINES: Readonly<Record<AgentState, string>> = Object.freeze({
  IDLE: '◇ Not paired — waiting for the dashboard to pair',
  PAIRED: '◆ Paired — ready',
  FOCUSING: '◆ Focusing — focus session running',
});

export const PAIRING_HINT =
  'Enter this code on the dashboard: Devices → Pair a device. It is shown only in this window ' +
  'and is never sent to the dashboard or the cloud.';

export const PAIRING_WAITING = 'Waiting for Focus Mode to issue a pairing code…';

export const PAIRING_EXPIRED = 'This code has expired — a new one is on its way.';

export const CONSENT_GRANTED_PREFIX = 'First-run permission: granted on ';

export const CONSENT_NOT_GRANTED =
  'First-run permission: not granted — you’ll be asked before your first focus session.';

export const CONSENT_NOT_REPORTED = 'First-run permission: not reported by this build.';

export const START_AT_LOGIN_EXPLANATION =
  'Focus Mode never starts itself. Turn this on only if you want the Focus Agent available after ' +
  'login. You can switch it off any time.';

export const START_AT_LOGIN_TRAY_HINT = 'Off by default — Focus Mode never starts itself.';

export const START_AT_LOGIN_LABEL = 'Start at login';

/** REC-008: the agent must never auto-enable itself at login. */
export const START_AT_LOGIN_DEFAULT = false;

export const PROTECTED_EXPLANATION = 'Protected apps can never be removed or moved aside.';

export const START_FROM_DASHBOARD_HINT =
  'Start a focus session from the dashboard on this computer.';

// ---------------------------------------------------------------------------
// Pure formatting helpers
// ---------------------------------------------------------------------------

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local wall-clock `HH:MM` (24 h, locale-independent so tests are deterministic). */
export function formatClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export interface CountdownView {
  /** `mm:ss` remaining, or `00:00` once the end time has passed. */
  readonly text: string;
  /** True when `endsAt` is at or before `now` — the agent must be restoring windows. */
  readonly expired: boolean;
  /** Local wall-clock end time, `HH:MM`. */
  readonly clock: string;
}

const UNKNOWN_COUNTDOWN: CountdownView = Object.freeze({
  text: '—',
  expired: false,
  clock: '—',
});

/** Absolute-time countdown from the agent's `endsAt` (FR-007): never a locally decremented timer. */
export function formatCountdown(endsAt: string, now: Date): CountdownView {
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return UNKNOWN_COUNTDOWN;
  const remainingMs = end.getTime() - now.getTime();
  if (remainingMs <= 0) return { text: '00:00', expired: true, clock: formatClock(end) };
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return { text: `${pad2(minutes)}:${pad2(seconds)}`, expired: false, clock: formatClock(end) };
}

/** Six digits grouped for the window's large mono display; anything else is not shown. */
export function formatPairingCode(code: string | null): string | null {
  if (code === null) return null;
  if (!/^\d{6}$/.test(code)) return null;
  return code.split('').join(' ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2 Nov 2026` from an ISO timestamp; null when it cannot be parsed. */
export function dateLabel(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''} ${date.getFullYear()}`.trim();
}

function appCount(count: number): string {
  return `${count} app${count === 1 ? '' : 's'}`;
}

/** "3 apps allowed to stay open" — the exact count is also rendered separately (FR-022). */
export function allowListCountLine(count: number): string {
  if (count <= 0) return 'No extra apps are allowed to stay open yet';
  return `${appCount(count)} allowed to stay open`;
}

// ---------------------------------------------------------------------------
// Allow-list (read-only, INV-3/INV-6)
// ---------------------------------------------------------------------------

export interface AllowListRow {
  readonly key: string;
  readonly label: string;
  /** Protected rows are locked: never removable, never moved aside (INV-3). */
  readonly locked: boolean;
  /** Summary row synthesised for protected apps beyond the preview limit. */
  readonly summary?: boolean;
}

export interface AllowListView {
  readonly rows: readonly AllowListRow[];
  readonly userCount: number;
  readonly protectedCount: number;
  readonly summary: string;
  readonly empty: boolean;
}

/** Protected rows shown before collapsing into "+N more protected". */
export const PROTECTED_PREVIEW_LIMIT = 6;

export function buildAllowListView(
  protectedApps: readonly AppEntry[],
  userApps: readonly AppEntry[],
): AllowListView {
  const rows: AllowListRow[] = [];
  const preview = protectedApps.slice(0, PROTECTED_PREVIEW_LIMIT);
  for (const app of preview) rows.push({ key: app.key, label: app.label, locked: true });
  const hiddenProtected = protectedApps.length - preview.length;
  if (hiddenProtected > 0) {
    rows.push({
      key: 'more-protected',
      label: `+${hiddenProtected} more protected`,
      locked: true,
      summary: true,
    });
  }
  for (const app of userApps) rows.push({ key: app.key, label: app.label, locked: false });

  return {
    rows,
    userCount: userApps.length,
    protectedCount: protectedApps.length,
    summary:
      `${appCount(protectedApps.length)} protected and ` +
      `${appCount(userApps.length)} allowed to stay open`,
    empty: userApps.length === 0,
  };
}

// ---------------------------------------------------------------------------
// First-run consent (REC-004) and start-at-login (REC-008)
// ---------------------------------------------------------------------------

export interface ConsentLine {
  readonly text: string;
  readonly tone: 'ok' | 'muted';
  readonly canReset: boolean;
}

export function describeConsent(consent: ConsentStatusView | undefined): ConsentLine {
  if (consent === undefined || consent.status === 'unknown') {
    return { text: CONSENT_NOT_REPORTED, tone: 'muted', canReset: false };
  }
  if (consent.status === 'not-granted') {
    return { text: CONSENT_NOT_GRANTED, tone: 'muted', canReset: false };
  }
  const granted = consent.grantedAt === null ? null : dateLabel(consent.grantedAt);
  return {
    text:
      granted === null ? 'First-run permission: granted' : `${CONSENT_GRANTED_PREFIX}${granted}`,
    tone: 'ok',
    canReset: consent.revocable,
  };
}

export interface StartAtLoginView {
  readonly label: string;
  readonly checked: boolean;
  readonly defaultEnabled: boolean;
  readonly explanation: string;
}

/** Tray checkbox model. `null` = OS state unknown, which is honest and still defaults to OFF. */
export function startAtLoginView(enabled: boolean | null): StartAtLoginView {
  return {
    label: START_AT_LOGIN_LABEL,
    checked: enabled === true,
    defaultEnabled: START_AT_LOGIN_DEFAULT,
    explanation: START_AT_LOGIN_EXPLANATION,
  };
}

// ---------------------------------------------------------------------------
// Window view-model
// ---------------------------------------------------------------------------

export type AgentWindowPhase = 'UNPAIRED' | 'PAIRED' | 'FOCUSING';

export interface AgentAlert {
  readonly title: string;
  readonly body: string;
}

export interface PairingView {
  readonly code: string | null;
  readonly hint: string;
  /** "Expires in 09:41" / expired copy, or null when no expiry was reported. */
  readonly expiry: string | null;
}

export interface FocusView {
  readonly remaining: string;
  readonly endsAt: string;
  readonly expired: boolean;
  readonly source: FocusSource;
  readonly sourceLine: string;
  readonly allowListCount: number;
  readonly allowListLine: string;
}

export interface LinksView {
  readonly cloudLine: string;
  readonly dashboardLine: string;
}

export interface AgentWindowView {
  readonly phase: AgentWindowPhase;
  readonly headline: string;
  readonly links: LinksView;
  readonly pairing: PairingView | null;
  readonly focus: FocusView | null;
  readonly allowList: AllowListView;
  readonly consent: ConsentLine;
  readonly alerts: readonly AgentAlert[];
  /** Shown only when PAIRED: the dashboard starts sessions, never this window. */
  readonly startHint: string | null;
  readonly startAtLoginNote: string;
  readonly endFocusEnabled: boolean;
  readonly capabilitiesLine: string;
}

function neverReported(): LinksView {
  return {
    cloudLine: 'Cloud: status not reported by this build',
    dashboardLine: 'Dashboard link: status not reported by this build',
  };
}

export function buildLinksView(links: AgentLinksView | undefined): LinksView {
  if (links === undefined) return neverReported();
  const cloudLine =
    links.cloud === 'connected'
      ? 'Cloud: ✓ Connected'
      : links.cloud === 'disconnected'
        ? 'Cloud: ✕ Disconnected'
        : links.cloud === 'not-configured'
          ? 'Cloud: ✕ Not configured'
          : 'Cloud: status not reported by this build';
  const dashboardLine =
    links.dashboard === 'connected'
      ? 'Dashboard link: ✓ Connected'
      : links.dashboard === 'listening'
        ? 'Dashboard link: waiting for a dashboard'
        : links.dashboard === 'down'
          ? 'Dashboard link: ✕ Not running'
          : 'Dashboard link: status not reported by this build';
  return { cloudLine, dashboardLine };
}

function buildAlerts(state: AgentViewState): readonly AgentAlert[] {
  const alerts: AgentAlert[] = [];
  const focus = state.capabilities.focus;
  if (focus === 'unsupported') {
    const reason = state.capabilities.reasons?.[0];
    alerts.push({
      title: 'Window control unavailable',
      body:
        reason === undefined
          ? "Window control isn't available on this system. Scheduled sessions won't start here."
          : `Window control isn't available on this system (${reason}). Scheduled sessions won't start here.`,
    });
  }
  if (state.links?.cloud === 'not-configured') {
    alerts.push({
      title: 'Cloud pairing is not configured',
      body:
        'No API base URL is set, so this Focus Agent cannot pair or receive scheduled sessions. ' +
        'Focus sessions started from the dashboard on this computer still work.',
    });
  } else if (state.links?.cloud === 'disconnected') {
    alerts.push({
      title: 'Cloud link is down',
      body:
        'The Focus Agent lost its connection to Focus Mode. Pairing and scheduled sessions are ' +
        'unavailable until it reconnects; local dashboard control still works.',
    });
  }
  if (state.links?.dashboard === 'down') {
    alerts.push({
      title: 'Dashboard link is not running',
      body:
        'No dashboard can reach this Focus Agent. Restart the Focus Agent before starting a ' +
        'session; the tray can still end one.',
    });
  }
  return alerts;
}

/** No cloud, no code: when no API base URL is configured the window shows the error, not a
 * permanently empty pairing panel. */
function canShowPairing(state: AgentViewState): boolean {
  return state.links?.cloud !== 'not-configured';
}

function buildPairingView(state: AgentViewState, now: Date): PairingView {
  const code = formatPairingCode(state.pairingCode);
  if (code === null) return { code: null, hint: PAIRING_WAITING, expiry: null };
  let expiry: string | null = null;
  if (state.pairingExpiresAt !== undefined && state.pairingExpiresAt !== null) {
    const countdown = formatCountdown(state.pairingExpiresAt, now);
    expiry = countdown.expired ? PAIRING_EXPIRED : `Expires in ${countdown.text}`;
  }
  return { code, hint: PAIRING_HINT, expiry };
}

function buildFocusView(state: AgentViewState, now: Date): FocusView | null {
  const session = state.session;
  if (session === null) return null;
  const countdown = formatCountdown(session.endsAt, now);
  return {
    remaining: countdown.expired
      ? 'Time is up — restoring your windows'
      : `${countdown.text} remaining`,
    endsAt: countdown.clock,
    expired: countdown.expired,
    source: session.source,
    sourceLine:
      session.source === 'SCHEDULE' ? 'Started by a schedule' : 'Started from the dashboard',
    allowListCount: state.allowList.length,
    allowListLine: allowListCountLine(state.allowList.length),
  };
}

function windowPhase(state: AgentViewState): AgentWindowPhase {
  if (state.state === 'FOCUSING') return 'FOCUSING';
  if (state.state === 'PAIRED' || state.paired) return 'PAIRED';
  return 'UNPAIRED';
}

/** Builds every text node the window shows; the renderer only assigns it to DOM elements. */
export function buildAgentWindowView(
  state: AgentViewState,
  now: Date = new Date(),
): AgentWindowView {
  const phase = windowPhase(state);
  const email = state.accountEmail ?? null;
  const baseHeadline =
    phase === 'UNPAIRED'
      ? AGENT_STATE_HEADLINES.IDLE
      : phase === 'PAIRED'
        ? AGENT_STATE_HEADLINES.PAIRED
        : AGENT_STATE_HEADLINES.FOCUSING;
  const headline =
    phase === 'PAIRED' && email !== null ? `◆ Connected to ${email} — ready` : baseHeadline;

  const focus = phase === 'FOCUSING' ? buildFocusView(state, now) : null;
  const focusCapability =
    state.capabilities.focus === 'full' ? 'available' : state.capabilities.focus;

  return {
    phase,
    headline,
    links: buildLinksView(state.links),
    pairing: phase === 'UNPAIRED' && canShowPairing(state) ? buildPairingView(state, now) : null,
    focus,
    allowList: buildAllowListView(state.protected, state.allowList),
    consent: describeConsent(state.consent),
    alerts: buildAlerts(state),
    startHint: phase === 'PAIRED' ? START_FROM_DASHBOARD_HINT : null,
    startAtLoginNote: START_AT_LOGIN_EXPLANATION,
    endFocusEnabled: phase === 'FOCUSING',
    capabilitiesLine: `Window control: ${focusCapability} · Focus Agent ${state.agentVersion} · ${state.os}`,
  };
}
