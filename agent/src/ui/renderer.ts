// ui/renderer.ts — plain-DOM renderer for the sandboxed Focus Agent window (T-059, FR-022).
// It is a *classic script*: no imports, no bundler, no Node — only the four frozen preload
// functions ({getState, endFocus, quit, showConsentStatus}). Every value is written with
// textContent (no HTML injection) and every state shows icon + text. It renders the unpaired
// pairing code (agent-window only, DEC-003), the paired summary, the live countdown from the
// agent's absolute `endsAt`, the read-only allow-list and honest error states. INV-6: the
// payload has no window titles/URLs and none are rendered.

interface SessionView {
  sessionId: string;
  startedAt: string;
  endsAt: string;
  plannedMinutes: number;
  source: 'MANUAL' | 'SCHEDULE';
}

interface AppEntryView {
  key: string;
  label: string;
  win?: string[];
  mac?: string[];
  linux?: string[];
}

interface LinksView {
  cloud: 'connected' | 'disconnected' | 'not-configured' | 'unknown';
  dashboard: 'connected' | 'listening' | 'down' | 'unknown';
}

interface ConsentStatusView {
  status: 'granted' | 'not-granted' | 'unknown';
  grantedAt: string | null;
  revocable: boolean;
}

interface ViewState {
  agentVersion: string;
  os: 'macOS' | 'windows' | 'linux';
  state: 'IDLE' | 'PAIRED' | 'FOCUSING';
  paired: boolean;
  pairingCode: string | null;
  capabilities: { focus: 'full' | 'partial' | 'unsupported'; reasons?: string[] };
  session: SessionView | null;
  protected: AppEntryView[];
  allowList: AppEntryView[];
  pairingExpiresAt?: string | null;
  accountEmail?: string | null;
  links?: LinksView;
  consent?: ConsentStatusView;
}

interface EndFocusResult {
  ok: boolean;
  message?: string;
}

interface FocusAgentBridge {
  getState(): Promise<ViewState>;
  endFocus(): Promise<EndFocusResult>;
  quit(): Promise<{ ok: boolean }>;
  showConsentStatus(): Promise<ConsentStatusView>;
}

// Plain global augmentation: this file is a *script* (no imports/exports), not a module.
// The declaration merge is consumed via `window.focusAgent` below; ESLint cannot see that use.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface Window {
  focusAgent?: FocusAgentBridge;
}

// Copy mirrors ui/view-state.ts (docs/UX_SPEC.md §7.1/§5.1); a unit test fails if they drift.
const STATE_HEADLINES = {
  IDLE: '◇ Not paired — waiting for the dashboard to pair',
  PAIRED: '◆ Paired — ready',
  FOCUSING: '◆ Focusing — focus session running',
} as const;

const PAIRING_HINT =
  'Enter this code on the dashboard: Devices → Pair a device. It is shown only in this window ' +
  'and is never sent to the dashboard or the cloud.';
const PAIRING_WAITING = 'Waiting for Focus Mode to issue a pairing code…';
const PAIRING_EXPIRED = 'This code has expired — a new one is on its way.';
const CONSENT_GRANTED_PREFIX = 'First-run permission: granted on ';
const CONSENT_NOT_GRANTED =
  'First-run permission: not granted — you’ll be asked before your first focus session.';
const CONSENT_NOT_REPORTED = 'First-run permission: not reported by this build.';
const START_FROM_DASHBOARD_HINT = 'Start a focus session from the dashboard on this computer.';
const START_AT_LOGIN_NOTE =
  'Focus Mode never starts itself. Turn on Start at login in the tray menu only if you want the ' +
  'Focus Agent available after login. You can switch it off any time.';

const PROTECTED_PREVIEW_LIMIT = 6;

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element #${id}`);
  return element;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

interface CountdownView {
  text: string;
  expired: boolean;
  clock: string;
}

function formatCountdown(endsAt: string): CountdownView {
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return { text: '—', expired: false, clock: '—' };
  const remainingMs = end.getTime() - Date.now();
  if (remainingMs <= 0) return { text: '00:00', expired: true, clock: formatClock(end) };
  const totalSeconds = Math.floor(remainingMs / 1000);
  return {
    text: `${pad2(Math.floor(totalSeconds / 60))}:${pad2(totalSeconds % 60)}`,
    expired: false,
    clock: formatClock(end),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateLabel(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''} ${date.getFullYear()}`.trim();
}

function formatPairingCode(code: string | null): string | null {
  if (code === null || !/^\d{6}$/.test(code)) return null;
  return code.split('').join(' ');
}

function appCountLine(count: number): string {
  if (count <= 0) return 'No extra apps are allowed to stay open yet';
  return `${count} app${count === 1 ? '' : 's'} allowed to stay open`;
}

const bridge = window.focusAgent;

const stateLine = byId('state-line');
const cloudLine = byId('cloud-line');
const dashboardLine = byId('dashboard-line');
const dashboardHint = byId('dashboard-hint');
const pairingSection = byId('pairing-section');
const pairingCode = byId('pairing-code');
const pairingHint = byId('pairing-hint');
const pairingExpiry = byId('pairing-expiry');
const focusSection = byId('focus-section');
const focusCountdown = byId('focus-countdown');
const focusEnds = byId('focus-ends');
const focusSource = byId('focus-source');
const focusAllowList = byId('focus-allowlist');
const alertSection = byId('alert-section');
const alertList = byId('alert-list');
const allowListSummary = byId('allowlist-summary');
const protectedList = byId('protected-list');
const allowList = byId('allowlist');
const allowListEmpty = byId('allowlist-empty');
const consentLine = byId('consent-line');
const startAtLoginNote = byId('start-at-login-note');
const capabilitiesLine = byId('capabilities');
const endFocusButton = byId('end-focus') as HTMLButtonElement;
const quitButton = byId('quit') as HTMLButtonElement;
const actionError = byId('action-error');

let current: ViewState | null = null;
let consentStatus: ConsentStatusView | null = null;

function showActionError(message: string | null): void {
  if (message === null) {
    actionError.hidden = true;
    actionError.textContent = '';
    return;
  }
  actionError.hidden = false;
  actionError.textContent = message;
}

function phaseOf(state: ViewState): 'UNPAIRED' | 'PAIRED' | 'FOCUSING' {
  if (state.state === 'FOCUSING') return 'FOCUSING';
  if (state.state === 'PAIRED' || state.paired) return 'PAIRED';
  return 'UNPAIRED';
}

function renderHeadline(state: ViewState): void {
  const phase = phaseOf(state);
  if (phase === 'PAIRED' && (state.accountEmail ?? null) !== null) {
    stateLine.textContent = `◆ Connected to ${state.accountEmail ?? ''} — ready`;
    return;
  }
  stateLine.textContent =
    phase === 'UNPAIRED'
      ? STATE_HEADLINES.IDLE
      : phase === 'PAIRED'
        ? STATE_HEADLINES.PAIRED
        : STATE_HEADLINES.FOCUSING;
}

function renderLinks(links: LinksView | undefined): void {
  if (links === undefined) {
    cloudLine.textContent = 'Cloud: status not reported by this build';
    dashboardLine.textContent = 'Dashboard link: status not reported by this build';
    return;
  }
  cloudLine.textContent =
    links.cloud === 'connected'
      ? 'Cloud: ✓ Connected'
      : links.cloud === 'disconnected'
        ? 'Cloud: ✕ Disconnected'
        : links.cloud === 'not-configured'
          ? 'Cloud: ✕ Not configured'
          : 'Cloud: status not reported by this build';
  dashboardLine.textContent =
    links.dashboard === 'connected'
      ? 'Dashboard link: ✓ Connected'
      : links.dashboard === 'listening'
        ? 'Dashboard link: waiting for a dashboard'
        : links.dashboard === 'down'
          ? 'Dashboard link: ✕ Not running'
          : 'Dashboard link: status not reported by this build';
}

function renderPairing(state: ViewState): void {
  // No cloud configuration means no code will ever arrive: show the alert instead of a dead panel.
  const show = phaseOf(state) === 'UNPAIRED' && state.links?.cloud !== 'not-configured';
  pairingSection.hidden = !show;
  if (!show) return;
  const code = formatPairingCode(state.pairingCode);
  pairingCode.textContent = code ?? '— — — — — —';
  pairingHint.textContent = code === null ? PAIRING_WAITING : PAIRING_HINT;

  const expiryAt = state.pairingExpiresAt ?? null;
  if (expiryAt === null) {
    pairingExpiry.hidden = true;
    pairingExpiry.textContent = '';
    return;
  }
  const expiry = formatCountdown(expiryAt);
  pairingExpiry.hidden = false;
  pairingExpiry.textContent = expiry.expired ? PAIRING_EXPIRED : `Expires in ${expiry.text}`;
}

function renderCountdown(): void {
  if (current === null || current.state !== 'FOCUSING' || current.session === null) return;
  const countdown = formatCountdown(current.session.endsAt);
  focusCountdown.textContent = countdown.expired
    ? 'Time is up — restoring your windows'
    : `${countdown.text} remaining`;
  focusEnds.textContent = countdown.expired
    ? 'Windows are being restored.'
    : `Ends at ${countdown.clock}`;
}

function renderFocus(state: ViewState): void {
  const focusing = state.state === 'FOCUSING' && state.session !== null;
  focusSection.hidden = !focusing;
  if (!focusing || state.session === null) return;
  renderCountdown();
  focusSource.textContent =
    state.session.source === 'SCHEDULE' ? 'Started by a schedule' : 'Started from the dashboard';
  focusAllowList.textContent = appCountLine(state.allowList.length);
}

function renderAlerts(state: ViewState): void {
  const alerts: { title: string; body: string }[] = [];
  if (state.capabilities.focus === 'unsupported') {
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

  alertSection.hidden = alerts.length === 0;
  alertList.replaceChildren(
    ...alerts.map((alert) => {
      const item = document.createElement('li');
      item.className = 'alerts__item';
      item.setAttribute('role', 'alert');
      const title = document.createElement('strong');
      title.textContent = alert.title;
      const body = document.createElement('p');
      body.className = 'muted';
      body.textContent = alert.body;
      item.append(title, body);
      return item;
    }),
  );
}

function renderAllowList(state: ViewState): void {
  const protectedRows: HTMLElement[] = state.protected
    .slice(0, PROTECTED_PREVIEW_LIMIT)
    .map((app) => {
      const item = document.createElement('li');
      item.textContent = `🔒 ${app.label}`;
      item.dataset.protected = 'true';
      return item;
    });
  const hidden = state.protected.length - Math.min(state.protected.length, PROTECTED_PREVIEW_LIMIT);
  if (hidden > 0) {
    const more = document.createElement('li');
    more.textContent = `+${hidden} more protected`;
    more.dataset.protected = 'true';
    protectedRows.push(more);
  }
  protectedList.replaceChildren(...protectedRows);

  const userRows: HTMLElement[] = state.allowList.map((app) => {
    const item = document.createElement('li');
    item.textContent = app.label;
    return item;
  });
  allowList.replaceChildren(...userRows);
  allowListEmpty.hidden = state.allowList.length > 0;

  const appCount = (count: number): string => `${count} app${count === 1 ? '' : 's'}`;
  allowListSummary.textContent =
    `${appCount(state.protected.length)} protected and ` +
    `${appCount(state.allowList.length)} allowed to stay open`;
}

function renderConsent(consent: ConsentStatusView | null | undefined): void {
  consentLine.dataset.tone = 'muted';
  if (consent === null || consent === undefined || consent.status === 'unknown') {
    consentLine.textContent = CONSENT_NOT_REPORTED;
    return;
  }
  if (consent.status === 'not-granted') {
    consentLine.textContent = CONSENT_NOT_GRANTED;
    return;
  }
  const granted = consent.grantedAt === null ? null : dateLabel(consent.grantedAt);
  consentLine.dataset.tone = 'ok';
  consentLine.textContent =
    granted === null ? 'First-run permission: granted' : `${CONSENT_GRANTED_PREFIX}${granted}`;
}

function renderCapabilities(state: ViewState): void {
  const focus = state.capabilities.focus === 'full' ? 'available' : state.capabilities.focus;
  capabilitiesLine.textContent = `Window control: ${focus} · Focus Agent ${state.agentVersion} · ${state.os}`;
}

function render(state: ViewState): void {
  current = state;
  renderHeadline(state);
  renderLinks(state.links);
  const phase = phaseOf(state);
  dashboardHint.hidden = phase !== 'PAIRED';
  dashboardHint.textContent = phase === 'PAIRED' ? START_FROM_DASHBOARD_HINT : '';
  renderPairing(state);
  renderFocus(state);
  renderAlerts(state);
  renderAllowList(state);
  // Prefer the freshly polled state; the one-shot bridge read is only a fallback.
  renderConsent(state.consent ?? consentStatus);
  renderCapabilities(state);
  startAtLoginNote.textContent = START_AT_LOGIN_NOTE;
}

async function refresh(): Promise<void> {
  if (bridge === undefined) {
    stateLine.textContent = 'Focus Agent bridge unavailable — quit and reopen the Focus Agent.';
    return;
  }
  try {
    render(await bridge.getState());
  } catch (error) {
    stateLine.textContent = 'Could not read the Focus Agent state';
    showActionError(error instanceof Error ? error.message : 'Unknown error');
  }
}

async function loadConsent(): Promise<void> {
  if (bridge === undefined) return;
  try {
    consentStatus = await bridge.showConsentStatus();
  } catch {
    // No consent handler in this build (or a read failure): keep the honest "not reported" line.
    consentStatus = null;
  }
  if (current !== null) renderConsent(current.consent ?? consentStatus);
}

endFocusButton.addEventListener('click', () => {
  if (bridge === undefined) return;
  endFocusButton.disabled = true;
  showActionError(null);
  void bridge
    .endFocus()
    .then((result) => {
      if (!result.ok) {
        showActionError(
          result.message ?? 'Could not restore every window. The session stays journaled.',
        );
      }
      return refresh();
    })
    .catch((error: unknown) => {
      showActionError(error instanceof Error ? error.message : 'Could not end the focus session.');
    })
    .finally(() => {
      endFocusButton.disabled = false;
    });
});

quitButton.addEventListener('click', () => {
  if (bridge === undefined) return;
  quitButton.disabled = true;
  void bridge.quit();
});

showActionError(null);
void loadConsent();
void refresh();
setInterval(() => {
  void refresh();
}, 2_000);
setInterval(renderCountdown, 1_000);
