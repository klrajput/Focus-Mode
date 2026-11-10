// ui/tray-menu.ts — pure model of the Focus Agent tray/menu-bar menu (FR-022, REC-008, T-059).
// tray.ts maps these entries onto Electron `MenuItem`s, so ordering, labels, enabled/checked
// states and the icon variant are unit-tested without a display. Copy follows
// docs/UX_SPEC.md §7.2: icon **and** text for every state, never colour/icon alone. The pairing
// code itself stays in the agent window (DEC-003), so the tray item only reveals that window.
// REC-008: "Start at login" is a checkbox whose default is OFF and carries an explanation.

import type { AgentState, FocusSource } from '@focus-mode/shared';
import {
  START_AT_LOGIN_TRAY_HINT,
  dateLabel,
  formatCountdown,
  formatPairingCode,
  startAtLoginView,
  type CloudLinkStatus,
  type ConsentStatusView,
} from './view-state.js';

/** Icon variants required by docs/UX_SPEC.md §7.2 (outline / filled / grey slash). */
export type TrayIconState = 'idle' | 'focusing' | 'disconnected';

/** Actions the tray asks the main process to perform; tray.ts maps them to callbacks. */
export type TrayAction =
  'end-focus' | 'show-window' | 'show-pairing-code' | 'reset-consent' | 'start-at-login' | 'quit';

/** Every action that is a plain menu item (the checkbox is the only non-action control). */
export type TrayActionButton = Exclude<TrayAction, 'start-at-login'>;

export type TrayMenuEntry =
  | { readonly kind: 'label'; readonly label: string }
  | { readonly kind: 'separator' }
  | {
      readonly kind: 'action';
      readonly label: string;
      readonly action: TrayActionButton;
      readonly enabled: boolean;
    }
  | {
      readonly kind: 'checkbox';
      readonly label: string;
      readonly action: 'start-at-login';
      readonly checked: boolean;
    };

/** The slice of agent truth the tray reads on every refresh (INV-5: agent is the truth). */
export interface TrayViewState {
  readonly state: AgentState;
  readonly paired: boolean;
  readonly pairingCode: string | null;
  readonly sessionEndsAt: string | null;
  /** Optional: `MANUAL` / `SCHEDULE` when the session snapshot is available. */
  readonly sessionSource?: FocusSource | null;
  /** Optional: cloud link health; `unknown`/absent keeps the neutral outline icon. */
  readonly cloud?: CloudLinkStatus;
  /** Optional: first-run permission record (REC-004); absent renders "not reported". */
  readonly consent?: ConsentStatusView | null;
}

export interface TrayMenuInput extends TrayViewState {
  /** OS login-item setting read at refresh time; the agent never enables it itself. */
  readonly startAtLogin: boolean;
  readonly now?: Date;
}

export interface TrayMenuModel {
  /** First menu line, also mirrored into the tooltip (never colour/icon only). */
  readonly title: string;
  readonly tooltip: string;
  readonly icon: TrayIconState;
  readonly entries: readonly TrayMenuEntry[];
}

/** Badge vocabulary from docs/UX_SPEC.md §3 (icon + text always). */
export const TRAY_STATE_LABELS: Readonly<Record<AgentState, string>> = Object.freeze({
  IDLE: 'Not paired',
  PAIRED: 'Paired',
  FOCUSING: 'Focusing',
});

function focusLine(state: TrayViewState, now: Date): string {
  if (state.sessionEndsAt === null) return '● Focus session running';
  const countdown = formatCountdown(state.sessionEndsAt, now);
  if (countdown.expired) return '● Focus session ending — restoring windows';
  const source = state.sessionSource === 'SCHEDULE' ? ' (scheduled)' : '';
  return `● Focus session running — ${countdown.text} left${source}`;
}

function iconFor(state: TrayViewState): TrayIconState {
  if (state.state === 'FOCUSING') return 'focusing';
  if (state.cloud === 'disconnected' || state.cloud === 'not-configured') return 'disconnected';
  return 'idle';
}

function consentEntries(consent: ConsentStatusView | null | undefined): TrayMenuEntry[] {
  if (consent === null || consent === undefined || consent.status === 'unknown') {
    return [{ kind: 'label', label: 'Focus permission: not reported by this build' }];
  }
  if (consent.status === 'not-granted') {
    return [{ kind: 'label', label: 'Focus permission: not granted yet' }];
  }
  const granted = consent.grantedAt === null ? null : dateLabel(consent.grantedAt);
  const entries: TrayMenuEntry[] = [
    {
      kind: 'label',
      label:
        granted === null ? 'Focus permission: granted' : `Focus permission: granted on ${granted}`,
    },
  ];
  if (consent.revocable) {
    entries.push({
      kind: 'action',
      action: 'reset-consent',
      label: 'Reset focus permission',
      enabled: true,
    });
  }
  return entries;
}

/** Builds the full menu. Pure: same input + clock ⇒ same output, so it is safe to test. */
export function buildTrayMenu(input: TrayMenuInput): TrayMenuModel {
  const now = input.now ?? new Date();
  const focusing = input.state === 'FOCUSING';
  const stateLabel = TRAY_STATE_LABELS[input.state];
  const entries: TrayMenuEntry[] = [];

  // 1. State line (also the tooltip; the icon is never the only signal).
  entries.push({ kind: 'label', label: `Focus Mode — ${stateLabel}` });
  if (focusing) entries.push({ kind: 'label', label: focusLine(input, now) });

  // 2. The always-reachable escape hatch (INV-5): enabled only while FOCUSING, but never absent.
  entries.push({
    kind: 'action',
    action: 'end-focus',
    label: 'End focus',
    enabled: focusing,
  });
  entries.push({ kind: 'separator' });

  // 3. Window + pairing code (the code exists only in the window, DEC-003).
  entries.push({
    kind: 'action',
    action: 'show-window',
    label: 'Show Focus Agent window',
    enabled: true,
  });
  if (!input.paired) {
    const code = formatPairingCode(input.pairingCode);
    entries.push({
      kind: 'action',
      action: 'show-pairing-code',
      label: 'Show pairing code',
      enabled: code !== null,
    });
    if (code === null) {
      entries.push({ kind: 'label', label: 'Pairing code: waiting for Focus Mode…' });
    }
  }

  // 4. First-run permission status + revoke (REC-004 display; the main process performs it).
  entries.push(...consentEntries(input.consent));
  entries.push({ kind: 'separator' });

  // 5. Start at login — OFF by default, explicitly explained (REC-008).
  const login = startAtLoginView(input.startAtLogin);
  entries.push({
    kind: 'checkbox',
    action: 'start-at-login',
    label: login.label,
    checked: login.checked,
  });
  entries.push({ kind: 'label', label: START_AT_LOGIN_TRAY_HINT });
  entries.push({ kind: 'separator' });

  // 6. Quit restores first (main.shutdown awaits exitFocus before app.exit).
  entries.push({
    kind: 'action',
    action: 'quit',
    label: 'Quit Focus Agent (restores windows first)',
    enabled: true,
  });

  return {
    title: `Focus Mode — ${stateLabel}`,
    tooltip: `Focus Mode — ${stateLabel}`,
    icon: iconFor(input),
    entries,
  };
}
