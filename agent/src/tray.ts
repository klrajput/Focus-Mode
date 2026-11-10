// tray.ts — the Focus Agent's menu-bar/tray presence and always-reachable escape hatch (FR-022).
// The menu always exposes End focus while FOCUSING and Quit; Quit goes through the same
// restore-first path as every other exit (INV-5). Start-at-login is a checkbox that defaults to
// the OS state (never enabled by this app) and carries an explanatory line (REC-008).
// Visual/tray behaviour can only be verified by a human on a real desktop (NEEDS-HUMAN).

import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions } from 'electron';
import type { AgentState } from '@focus-mode/shared';

/** 32×32 teal diamond, generated as a PNG data URL so the app ships no binary asset. */
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAiElEQVR42u2XuQ3AIBAEryH3QOc04X5sIZ1D2zz3TECwKTMScI8cZ5XMyBZYPKBoUgQauGpKtMADvzTTEhbwJQkr+LSEJXxKwho+LOEBH5LwgndLeMK7JLzhvxIR8E+JKPirBE4g/QoQjxDxDRGFCFGKEc0I0Y4RAwliJEMMpYixHLGY7N3QJDcS/zhB7wQ2BAAAAABJRU5ErkJggg==';

export interface TrayViewState {
  readonly state: AgentState;
  readonly paired: boolean;
  readonly pairingCode: string | null;
  readonly sessionEndsAt: string | null;
}

export interface AgentTrayOptions {
  readonly getState: () => TrayViewState;
  readonly showWindow: () => void;
  /** Main decides how to restore; the tray only requests an idempotent exit. */
  readonly endFocus: () => void;
  readonly quit: () => void;
  readonly startAtLoginEnabled: () => boolean;
  readonly setStartAtLogin: (enabled: boolean) => void;
}

const STATE_LABELS: Readonly<Record<AgentState, string>> = Object.freeze({
  IDLE: 'Not paired',
  PAIRED: 'Paired',
  FOCUSING: 'Focusing',
});

/** Refreshes the countdown label periodically; menus are static once built. */
const MENU_REFRESH_MS = 15_000;

function remainingLabel(endsAt: string | null, now: Date = new Date()): string {
  if (endsAt === null) return 'Focus session running';
  const remainingMs = new Date(endsAt).getTime() - now.getTime();
  if (remainingMs <= 0) return 'Focus session ending…';
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `Focus session running — ${minutes}:${String(seconds).padStart(2, '0')} left`;
}

export class AgentTray {
  readonly #tray: Tray;
  readonly #options: AgentTrayOptions;
  readonly #refreshTimer: ReturnType<typeof setInterval>;
  #destroyed = false;

  constructor(options: AgentTrayOptions) {
    this.#options = options;
    const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
    icon.setTemplateImage(false);
    this.#tray = new Tray(icon);
    this.#tray.setToolTip('Focus Mode — Focus Agent');
    this.#tray.on('click', () => options.showWindow());
    this.refresh();
    this.#refreshTimer = setInterval(() => this.refresh(), MENU_REFRESH_MS);
  }

  /** Rebuilds tooltip + menu from current state; safe to call repeatedly. */
  refresh(): void {
    if (this.#destroyed) return;
    const state = this.#options.getState();
    const focusing = state.state === 'FOCUSING';
    this.#tray.setToolTip(`Focus Mode — ${STATE_LABELS[state.state]}`);
    this.#tray.setContextMenu(Menu.buildFromTemplate(this.#template(state, focusing)));
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    clearInterval(this.#refreshTimer);
    this.#tray.destroy();
  }

  #template(state: TrayViewState, focusing: boolean): MenuItemConstructorOptions[] {
    const options = this.#options;
    const items: MenuItemConstructorOptions[] = [
      { label: `Focus Mode — ${STATE_LABELS[state.state]}`, enabled: false },
    ];

    if (focusing) items.push({ label: remainingLabel(state.sessionEndsAt), enabled: false });

    items.push(
      {
        label: 'End focus',
        // Always available while FOCUSING; a no-op otherwise (idempotent exit, INV-5).
        enabled: focusing,
        click: () => options.endFocus(),
      },
      { type: 'separator' },
      { label: 'Open Focus Agent', click: () => options.showWindow() },
    );

    if (!state.paired && state.pairingCode !== null) {
      items.push(
        { label: `Pairing code: ${state.pairingCode}`, enabled: false },
        {
          label: 'Enter it on the dashboard: Devices → Pair a device',
          enabled: false,
        },
      );
    }

    items.push(
      { type: 'separator' },
      {
        label: 'Start at login',
        type: 'checkbox',
        checked: options.startAtLoginEnabled(),
        click: (menuItem) => {
          options.setStartAtLogin(menuItem.checked);
          this.refresh();
        },
      },
      {
        label: 'Off by default — Focus Mode never starts itself.',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Quit Focus Agent (restores any active focus)',
        click: () => options.quit(),
      },
    );

    return items;
  }

  /** True when the OS reports the app as a login item (read-only; never set at startup). */
  static loginItemEnabled(): boolean {
    try {
      return app.getLoginItemSettings().openAtLogin;
    } catch {
      return false;
    }
  }
}
