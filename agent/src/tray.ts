// tray.ts — Electron menu-bar/tray presence for the Focus Agent (FR-022, T-059).
// This file is only the thin Electron adapter: ordering, labels, enabled/checked states and the
// icon variant live in the pure model `ui/tray-menu.ts` (unit-tested without a display). It
// imports nothing from `main.ts` and every action is an injected callback, so the tray stays
// self-contained and main keeps the restore semantics.
// Invariants: End focus is always listed and enabled only while FOCUSING — the escape hatch with
// the dashboard closed (INV-5). Quit calls `options.quit()`, which main implements as
// `shutdown()`: `await controller.exitFocus('QUIT')` → stop link/cloud → `app.exit(0)`, i.e.
// restore-before-exit. REC-008: the Start-at-login checkbox mirrors the OS setting, is OFF by
// default and is never enabled by the agent itself. Visual tray behaviour is NEEDS-HUMAN.

import { app, Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { FileConsentStore, NATIVE_CONSENT_VERSION } from './focus/consent.js';
import {
  buildTrayMenu,
  type TrayActionButton,
  type TrayIconState,
  type TrayMenuEntry,
  type TrayViewState,
} from './ui/tray-menu.js';
import type { ConsentStatusView } from './ui/view-state.js';

export type { TrayIconState, TrayMenuEntry, TrayMenuModel, TrayViewState } from './ui/tray-menu.js';

/**
 * 32×32 PNG data URLs generated offline from simple geometry (see the W3 report) so the app
 * ships no binary asset and every platform gets the same three variants from docs/UX_SPEC.md
 * §7.2: outline diamond = idle/unpaired, filled teal = FOCUSING, grey slash = disconnected.
 */
const TRAY_ICON_DATA_URLS: Readonly<Record<TrayIconState, string>> = Object.freeze({
  idle: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAjklEQVR42mPQvbKfYSAxw6gDKDTAAIoHxAEgi99DsQG9HYBsOUWOoIbPKQoJagU72Y6gZpyT5QhqJziSHUGL1E6SelplNaL10TKfE6WfpoUMMebQ0nKizKO15QTNHXQOGPAoGBSJcFBkw0FREA2KonhQVEaDojoeFA2SQdEkGxSN0kHRLB8UHZPRviFVMAC/J2eO+badFAAAAABJRU5ErkJggg==',
  focusing:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAhElEQVR42u2XQQ6AIAwE+yET/n/xE/7DJ2hM6lWhtHQ0HPY8kwDtIsu2SmZkCnxdoGhSBC7wrimjBW74oTFLeMC7JLzgZglPuEnCG94sEQFvkoiCV0tEwqskouGvEiPgjxJIgfQjQFxCxDNEDCLEKEYsI8Q6RhQSRCVDlFJELZ8/o38InBW+DbGfWu8dAAAAAElFTkSuQmCC',
  disconnected:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAvklEQVR42u2XwRHAIAgELYUSKMmi0kGaSFcpwUxmyIw/ObhEH3nwU25F1LNs+1FmRvkBkgnUYgrALXxa6NcAvXgKgrHyVCW8gjIoexjCI94scR2IhCBGA8QStg5EmY3poawAAAyBdjsdItLtVAh0Mh0iMokKEd07GkSmgxEIN8AbENAWsCFCTciCSB1DBkT6IspCNLvGKX4gcjyfSgjLkCjwHNcORJmOCDEkwngNl7Bky5nSJWz5Eh+T/29IiQs1OE7VEojokwAAAABJRU5ErkJggg==',
});

/** Menu countdown freshness: 1 s while FOCUSING, 15 s otherwise (cheap, no animation). */
const FOCUSING_REFRESH_MS = 1_000;
const IDLE_REFRESH_MS = 15_000;

export interface AgentTrayOptions {
  /** Agent truth for the menu (INV-5). Main builds it from `viewState()`. */
  readonly getState: () => TrayViewState;
  readonly showWindow: () => void;
  /** Main decides how to restore; the tray only requests an idempotent exit. */
  readonly endFocus: () => void;
  /** Main's `shutdown()`: restore first, then exit (INV-5). */
  readonly quit: () => void;
  /** REC-008: OS login-item state, read-only; the agent never enables it on its own. */
  readonly startAtLoginEnabled: () => boolean;
  readonly setStartAtLogin: (enabled: boolean) => void;
  /** REC-004: first-run permission record. Optional until main wires the consent module. */
  readonly consentStatus?: () => ConsentStatusView | null;
  /** REC-004 revoke. Omitted → the tray only displays the consent status. */
  readonly resetConsent?: () => void;
  /**
   * DEC-021/T-064: cancel the scheduled run in its heads-up. Omitted → the menu shows no Cancel
   * item, but the window still offers one (main always provides it).
   */
  readonly cancelScheduledSession?: () => void;
}

type TrayImage = ReturnType<typeof nativeImage.createFromDataURL>;

/** Read/clear the local first-run permission record (REC-004). */
interface ConsentReader {
  status(): ConsentStatusView | null;
  revoke(): void;
}

/**
 * Local fallback while main.ts has not yet injected `consentStatus`/`resetConsent` (requested in
 * the W3 report). It reuses the core `FileConsentStore`, so there is still exactly one storage
 * format and one consent semantics — no duplicated consent logic. Injection always wins when
 * present. Reading is local-only and never grants anything (a denial is never stored as consent).
 */
function createConsentFallback(): ConsentReader {
  let store: FileConsentStore | undefined;
  const getStore = (): FileConsentStore => {
    store ??= new FileConsentStore({ directory: app.getPath('userData') });
    return store;
  };
  return {
    status: () => {
      try {
        const record = getStore().read();
        if (record === null || record.version !== NATIVE_CONSENT_VERSION) {
          // Missing or from an older consent copy: the next focus asks again, not "granted".
          return { status: 'not-granted', grantedAt: null, revocable: false };
        }
        return { status: 'granted', grantedAt: record.acceptedAt, revocable: true };
      } catch {
        return null;
      }
    },
    revoke: () => {
      try {
        getStore().clear();
      } catch {
        // Nothing stored (or the file is already gone) — the next start asks again anyway.
      }
    },
  };
}

function createIcon(state: TrayIconState): TrayImage {
  const image = nativeImage.createFromDataURL(TRAY_ICON_DATA_URLS[state]);
  // Keeps the teal/grey artwork as drawn instead of letting macOS recolour it as a template.
  image.setTemplateImage(false);
  return image;
}

export class AgentTray {
  readonly #tray: Tray;
  readonly #options: AgentTrayOptions;
  readonly #images: Readonly<Record<TrayIconState, TrayImage>>;
  readonly #consentFallback: ConsentReader = createConsentFallback();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #destroyed = false;

  constructor(options: AgentTrayOptions) {
    this.#options = options;
    this.#images = Object.freeze({
      idle: createIcon('idle'),
      focusing: createIcon('focusing'),
      disconnected: createIcon('disconnected'),
    });
    this.#tray = new Tray(this.#images.idle);
    this.#tray.setToolTip('Focus Mode — Focus Agent');
    // A left click opens the window; the state itself is always in the menu's first line.
    this.#tray.on('click', () => options.showWindow());
    this.refresh();
  }

  /** Rebuilds icon + tooltip + menu from current state; safe to call repeatedly. */
  refresh(): void {
    if (this.#destroyed) return;
    const state = this.#options.getState();
    const model = buildTrayMenu({
      ...state,
      consent: this.#consentStatus(state),
      startAtLogin: this.#options.startAtLoginEnabled(),
    });

    this.#tray.setImage(this.#images[model.icon]);
    this.#tray.setToolTip(model.tooltip);
    this.#tray.setContextMenu(
      Menu.buildFromTemplate(model.entries.map((entry) => this.#template(entry))),
    );
    // A pending scheduled run counts down in seconds, so refresh it as often as a live focus.
    this.#scheduleRefresh(state.state === 'FOCUSING' || (state.pendingSchedule ?? null) !== null);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#tray.destroy();
  }

  #scheduleRefresh(focusing: boolean): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        this.refresh();
      },
      focusing ? FOCUSING_REFRESH_MS : IDLE_REFRESH_MS,
    );
  }

  /** Injected provider wins; the local fallback keeps the tray honest until main wires it. */
  #consentStatus(state: TrayViewState): ConsentStatusView | null {
    if (this.#options.consentStatus === undefined) return this.#consentFallback.status();
    try {
      return this.#options.consentStatus();
    } catch {
      // A consent read must never take the tray (and the escape hatch) down.
      return state.consent ?? null;
    }
  }

  #revokeConsent(): void {
    if (this.#options.resetConsent !== undefined) {
      this.#options.resetConsent();
    } else {
      this.#consentFallback.revoke();
    }
    this.refresh();
  }

  #template(entry: TrayMenuEntry): MenuItemConstructorOptions {
    if (entry.kind === 'separator') return { type: 'separator' };
    if (entry.kind === 'label') return { label: entry.label, enabled: false };
    if (entry.kind === 'checkbox') {
      return {
        label: entry.label,
        type: 'checkbox',
        checked: entry.checked,
        click: (menuItem) => {
          this.#options.setStartAtLogin(menuItem.checked);
          this.refresh();
        },
      };
    }
    return {
      label: entry.label,
      enabled: entry.enabled,
      click: () => this.#dispatch(entry.action),
    };
  }

  #dispatch(action: TrayActionButton): void {
    switch (action) {
      case 'end-focus':
        this.#options.endFocus();
        return;
      case 'cancel-schedule':
        // DEC-021: cancelling the heads-up starts nothing; main sends `scheduleRunCancelled`.
        this.#options.cancelScheduledSession?.();
        this.refresh();
        return;
      case 'show-window':
      case 'show-pairing-code':
        // DEC-003: the code lives only in the window, so both items reveal the same window.
        this.#options.showWindow();
        return;
      case 'reset-consent':
        this.#revokeConsent();
        return;
      case 'quit':
        this.#options.quit();
        return;
      default: {
        // Exhaustiveness: a new TrayActionButton must get a handler, not be silently ignored.
        const unreachable: never = action;
        void unreachable;
      }
    }
  }

  /**
   * REC-008: true only when the OS already has this app as a login item (a choice the user made
   * earlier). The agent never calls `setLoginItemSettings` at startup, so a fresh install is OFF.
   */
  static loginItemEnabled(): boolean {
    try {
      return app.getLoginItemSettings().openAtLogin;
    } catch {
      return false;
    }
  }
}
