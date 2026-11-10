// ui/renderer.ts — plain-DOM renderer for the sandboxed Focus Agent window (T-030/SEC-8).
// No Node, no imports, no bundler: it is compiled to a classic script and may only call the
// three functions the preload exposes ({getState, endFocus, quit}). It renders state, the
// pairing code (agent-window only, DEC-003), the read-only allow-list and an always-reachable
// End focus / Quit. Nothing here reads window titles or URLs (INV-6).

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
}

interface EndFocusResult {
  ok: boolean;
  message?: string;
}

interface FocusAgentBridge {
  getState(): Promise<ViewState>;
  endFocus(): Promise<EndFocusResult>;
  quit(): Promise<{ ok: boolean }>;
}

// Plain global augmentation: this file is a *script* (no imports/exports), not a module.
// The declaration merge is consumed via `window.focusAgent` below; ESLint cannot see that use.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface Window {
  focusAgent?: FocusAgentBridge;
}

const STATE_LABELS: Record<ViewState['state'], string> = {
  IDLE: '◇ Not paired — waiting for the dashboard',
  PAIRED: '◆ Paired — ready',
  FOCUSING: '◆ Focus session running',
};

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element #${id}`);
  return element;
}

const bridge = window.focusAgent;

const stateLine = byId('state-line');
const pairingSection = byId('pairing-section');
const pairingCode = byId('pairing-code');
const focusSection = byId('focus-section');
const focusCountdown = byId('focus-countdown');
const endFocusButton = byId('end-focus');
const quitButton = byId('quit');
const protectedList = byId('protected-list');
const allowList = byId('allowlist');
const allowListEmpty = byId('allowlist-empty');
const warningSection = byId('warning-section');
const warningText = byId('warning-text');
const capabilitiesLine = byId('capabilities');
const actionError = byId('action-error');

let current: ViewState | null = null;

function showActionError(message: string | null): void {
  if (message === null) {
    actionError.hidden = true;
    actionError.textContent = '';
    return;
  }
  actionError.hidden = false;
  actionError.textContent = message;
}

function formatRemaining(endsAt: string): string {
  const remainingMs = new Date(endsAt).getTime() - Date.now();
  if (remainingMs <= 0) return 'ending…';
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')} remaining`;
}

function renderCountdown(): void {
  if (current?.state !== 'FOCUSING' || current.session === null) return;
  const ends = new Date(current.session.endsAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  focusCountdown.textContent = `${formatRemaining(current.session.endsAt)} · ends ${ends}`;
}

function renderList(container: HTMLElement, apps: readonly AppEntryView[], locked: boolean): void {
  container.replaceChildren();
  for (const app of apps) {
    const item = document.createElement('li');
    item.textContent = locked ? `🔒 ${app.label}` : app.label;
    if (locked) item.dataset.protected = 'true';
    container.append(item);
  }
}

function render(state: ViewState): void {
  current = state;
  stateLine.textContent = STATE_LABELS[state.state];

  const showPairing = !state.paired && state.state === 'IDLE';
  pairingSection.hidden = !showPairing;
  pairingCode.textContent =
    state.pairingCode === null ? '— — — — — —' : state.pairingCode.split('').join(' ');

  const focusing = state.state === 'FOCUSING' && state.session !== null;
  focusSection.hidden = !focusing;
  if (focusing) renderCountdown();

  const protectedPreview = state.protected.slice(0, 6);
  renderList(protectedList, protectedPreview, true);
  if (state.protected.length > protectedPreview.length) {
    const more = document.createElement('li');
    more.textContent = `+${state.protected.length - protectedPreview.length} more protected`;
    more.dataset.protected = 'true';
    protectedList.append(more);
  }

  renderList(allowList, state.allowList, false);
  allowListEmpty.hidden = state.allowList.length > 0;

  const unsupported = state.capabilities.focus === 'unsupported';
  warningSection.hidden = !unsupported;
  warningText.textContent =
    state.capabilities.reasons?.[0] ??
    'Window control is not available on this system, so focus sessions cannot start here.';

  capabilitiesLine.textContent =
    state.capabilities.focus === 'full'
      ? `Window control: available · Focus Agent ${state.agentVersion} · ${state.os}`
      : `Window control: ${state.capabilities.focus} · Focus Agent ${state.agentVersion} · ${state.os}`;
}

async function refresh(): Promise<void> {
  if (bridge === undefined) {
    stateLine.textContent = 'Agent bridge unavailable — reopen the Focus Agent';
    return;
  }
  try {
    render(await bridge.getState());
  } catch (error) {
    stateLine.textContent = 'Could not read the Focus Agent state';
    showActionError(error instanceof Error ? error.message : 'Unknown error');
  }
}

endFocusButton.addEventListener('click', () => {
  if (bridge === undefined) return;
  endFocusButton.setAttribute('disabled', 'true');
  showActionError(null);
  void bridge
    .endFocus()
    .then((result) => {
      if (!result.ok) {
        showActionError(result.message ?? 'Could not restore windows.');
      }
      return refresh();
    })
    .finally(() => {
      endFocusButton.removeAttribute('disabled');
    });
});

quitButton.addEventListener('click', () => {
  if (bridge === undefined) return;
  void bridge.quit();
});

showActionError(null);
void refresh();
setInterval(() => {
  void refresh();
}, 1500);
setInterval(renderCountdown, 1000);
