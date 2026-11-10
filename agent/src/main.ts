// main.ts — Focus Agent Electron lifecycle (T-030): single-instance lock, window + tray,
// loopback link, journal-first FocusController, and restore-before-exit on every quit path.
// Closing the window only hides it (the tray must keep offering End focus/Quit, FR-022);
// `window-all-closed` never quits. SIGTERM/SIGINT/before-quit all call `exitFocus()` first
// (INV-5). Sleeping/resuming is recorded here; full reconcile is T-050.
// Security (SEC-8): contextIsolation + sandbox + no nodeIntegration, navigation/window-open
// denied, preload exposes exactly {getState, endFocus, quit}.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  type IpcMainInvokeEvent,
} from 'electron';
import type { OsName } from '@focus-mode/shared';
import { resolveProtectedEntries } from './allowlist.js';
import { AgentEnvError, loadAgentEnv, type AgentConfig } from './config/env.js';
import { FocusController, type FocusSnapshot } from './focus/controller.js';
import { createFocusDriver } from './focus/drivers/index.js';
import { FileJournal } from './focus/journal.js';
import { LinkServer } from './link/server.js';
import type { LinkSnapshot } from './link/messages.js';
import type { Logger } from './log.js';
import { noopLogger } from './log.js';
import { createElectronLogger } from './log-electron.js';
import { generatePairingCode, pairCodeLogLabel, type PairingCode } from './pairing.js';
import { AgentTray } from './tray.js';
import type { AgentViewState } from './ui/view-state.js';

const APP_NAME = 'Focus Agent';
/** The cloud assigns a real device id on pairing (W2/T-042); W1 is local-only. */
const AGENT_ID = 'focus-agent-local';
const WINDOW_SIZE = { width: 464, height: 620, minWidth: 380, minHeight: 520 } as const;
const UI_BACKGROUND = '#1E1B4B';
/** Renderer is allowed to call exactly these three channels via the preload. */
const IPC_CHANNELS = {
  getState: 'agent:get-state',
  endFocus: 'agent:end-focus',
  quit: 'agent:quit',
} as const;
/** Compiled main lives in `dist/`, so preload and HTML live in `dist/ui/`. */
const DIST_DIR = fileURLToPath(new URL('.', import.meta.url));

function resolveOsName(): OsName {
  if (process.platform === 'darwin') return 'macOS';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

/** Prefers the build copy; falls back to the source tree when running dev without a copy. */
function resolveUiIndexPath(): string {
  const built = path.join(DIST_DIR, 'ui', 'index.html');
  if (existsSync(built)) return built;
  return path.join(app.getAppPath(), 'src', 'ui', 'index.html');
}

function fatal(message: string): void {
  process.stderr.write(`${message}\n`);
  try {
    dialog.showErrorBox('Focus Agent could not start', message);
  } catch {
    // Headless environments have no dialog backend; stderr above is the record.
  }
  app.exit(1);
}

function loadConfigOrExit(): AgentConfig | null {
  try {
    // dotenv is dev-only; packaged builds must receive real environment variables (DEC-013).
    return loadAgentEnv({ loadDotenv: !app.isPackaged });
  } catch (error) {
    fatal(
      error instanceof AgentEnvError
        ? error.message
        : `Unexpected configuration error: ${String(error)}`,
    );
    return null;
  }
}

async function bootstrap(): Promise<void> {
  const loadedConfig = loadConfigOrExit();
  if (loadedConfig === null) return;
  const config: AgentConfig = loadedConfig;

  // Must happen before `app.getPath('userData')` is used for the journal (tests/dev override).
  if (config.userDataDir !== undefined) app.setPath('userData', config.userDataDir);

  const logger: Logger = createElectronLogger(config.logLevel);
  const os = resolveOsName();

  let mainWindow: BrowserWindow | undefined;
  let tray: AgentTray | undefined;
  let shuttingDown = false;
  let shuttingDownPromise: Promise<void> | undefined;
  const uiIndexPath = resolveUiIndexPath();
  const uiUrl = pathToFileURL(uiIndexPath).toString();

  const paired = false; // Persisted pairing + cloud poll arrive in W2 (T-042).
  const pairing: PairingCode = generatePairingCode();

  const controller = new FocusController({
    driver: createFocusDriver({
      configured: config.driver,
      isPackaged: app.isPackaged,
      logger,
    }),
    journal: new FileJournal({ directory: app.getPath('userData'), logger }),
    protectedEntries: resolveProtectedEntries(os, []),
    os,
    initialPaired: paired,
    logger,
    onEvent: (event) => {
      if (event.type === 'focusStarted') {
        logger.info('Focus session started', {
          sessionId: event.sessionId,
          endsAt: event.endsAt,
          source: event.source,
        });
      } else {
        logger.info('Focus session ended', {
          sessionId: event.sessionId,
          reason: event.reason,
          actualMinutes: event.actualMinutes,
        });
      }
      tray?.refresh();
    },
  });

  const linkServer = new LinkServer({
    port: config.port,
    allowedOrigins: config.allowedOrigins,
    identity: {
      agentId: AGENT_ID,
      agentVersion: app.getVersion(),
      os,
      capabilities: controller.capabilities(),
    },
    getSnapshot: (): LinkSnapshot => {
      const snapshot: FocusSnapshot = controller.getState();
      return {
        state: snapshot.state,
        paired,
        ...(snapshot.session === undefined ? {} : { session: snapshot.session }),
        protected: snapshot.protected,
        allowList: snapshot.allowList,
      };
    },
    onPaired: () => {
      // Only a nudge: the device token is obtained by polling the cloud (W2/T-042).
      logger.info('Dashboard sent the paired nudge; cloud poll handler lands in T-042');
      tray?.refresh();
    },
    logger,
  });

  function viewState(): AgentViewState {
    const snapshot: FocusSnapshot = controller.getState();
    return {
      agentVersion: app.getVersion(),
      os,
      state: snapshot.state,
      paired,
      pairingCode: paired ? null : pairing.value,
      capabilities: controller.capabilities(),
      session: snapshot.session ?? null,
      protected: snapshot.protected,
      allowList: snapshot.allowList,
    };
  }

  function showWindow(): void {
    if (config.headless === true || mainWindow === undefined) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  function assertTrustedSender(event: IpcMainInvokeEvent): void {
    const frameUrl = event.senderFrame?.url ?? '';
    if (frameUrl.split('#')[0] !== uiUrl) {
      throw new Error('Rejected IPC from an untrusted frame');
    }
  }

  function registerIpcHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.getState, (event) => {
      assertTrustedSender(event);
      return viewState();
    });
    ipcMain.handle(IPC_CHANNELS.endFocus, async (event) => {
      assertTrustedSender(event);
      try {
        await controller.exitFocus('USER');
        tray?.refresh();
        return { ok: true };
      } catch (error) {
        logger.error('End focus requested from the agent window failed', error);
        return {
          ok: false,
          message:
            'Could not restore every window. The session stays journaled and will be retried ' +
            'at the next start.',
        };
      }
    });
    ipcMain.handle(IPC_CHANNELS.quit, (event) => {
      assertTrustedSender(event);
      void shutdown();
      return { ok: true };
    });
  }

  function setStartAtLogin(enabled: boolean): void {
    try {
      // REC-008: never enabled by the app itself, only by this explicit user toggle.
      app.setLoginItemSettings({ openAtLogin: enabled });
      logger.info('Start-at-login preference changed', { enabled });
    } catch (error) {
      logger.error('Could not change the start-at-login preference', error);
    }
  }

  function createMainWindow(): BrowserWindow {
    const window = new BrowserWindow({
      ...WINDOW_SIZE,
      show: false,
      title: 'Focus Mode — Focus Agent',
      backgroundColor: UI_BACKGROUND,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        preload: path.join(DIST_DIR, 'ui', 'preload.cjs'),
      },
    });

    window.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.on('close', (event) => {
      if (shuttingDown || config.headless) return;
      // Closing the window hides it: the tray stays available (FR-022).
      event.preventDefault();
      window.hide();
    });
    window.once('ready-to-show', () => {
      if (!config.headless) window.show();
    });
    void window.loadFile(uiIndexPath);
    return window;
  }

  async function shutdown(): Promise<void> {
    if (shuttingDownPromise !== undefined) return shuttingDownPromise;
    shuttingDown = true;
    shuttingDownPromise = (async () => {
      logger.info('Focus Agent shutting down');
      try {
        // INV-5: restore before exit; a failure keeps the journal for next-start recovery.
        await controller.exitFocus('QUIT');
      } catch (error) {
        logger.error('Quit restore failed; the journal is kept for the next start', error);
      }
      try {
        await linkServer.stop();
      } catch (error) {
        logger.error('Dashboard link shutdown failed', error);
      }
      tray?.destroy();
      tray = undefined;
      if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.destroy();
      app.exit(0);
    })();
    return shuttingDownPromise;
  }

  await app.whenReady();
  logger.info('Focus Agent starting', {
    version: app.getVersion(),
    os,
    driver: config.driver,
    headless: config.headless,
    loopbackPort: config.port,
  });
  // Presence only: the digits must never reach the log or the wire (DEC-003).
  logger.debug(pairCodeLogLabel(pairing));

  // FR-023: restore from the journal BEFORE the window/link can report state.
  const recovery = await controller.recoverFromJournal();
  if (recovery !== null) {
    logger.info('Startup journal recovery finished', {
      sessionId: recovery.sessionId,
      restored: recovery.restored,
      actualMinutes: recovery.actualMinutes,
    });
  }

  registerIpcHandlers();

  try {
    const address = await linkServer.start();
    logger.info('Dashboard link ready', { host: address.host, port: address.port });
  } catch (error) {
    // The tray remains the escape hatch; a busy link must not stop the agent.
    logger.error('Dashboard link did not start', error);
  }

  if (!config.headless) {
    mainWindow = createMainWindow();
    tray = new AgentTray({
      getState: () => {
        const state = viewState();
        return {
          state: state.state,
          paired: state.paired,
          pairingCode: state.pairingCode,
          sessionEndsAt: state.session?.endsAt ?? null,
        };
      },
      showWindow,
      endFocus: () => {
        void controller
          .exitFocus('USER')
          .then(() => tray?.refresh())
          .catch((error: unknown) => {
            logger.error('End focus from the tray failed; journal kept', error);
          });
      },
      quit: () => {
        void shutdown();
      },
      startAtLoginEnabled: () => AgentTray.loginItemEnabled(),
      setStartAtLogin,
    });
  }

  app.on('second-instance', () => {
    showWindow();
  });
  app.on('activate', () => {
    showWindow();
  });

  // A tray app keeps running with no windows; End focus/Quit stay reachable (FR-022).
  app.on('window-all-closed', () => {
    // Intentionally empty: quitting here would remove the escape hatch.
  });

  app.on('before-quit', (event) => {
    // Always defer to `shutdown()`: it restores first and only then calls `app.exit(0)`.
    // This also covers a second quit event arriving mid-restore (a plain `return` here would
    // let Electron exit before restore finished, violating INV-5).
    event.preventDefault();
    if (!shuttingDown) void shutdown();
  });

  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });

  powerMonitor.on('suspend', () => {
    logger.info('System suspending', { focusing: controller.isFocusing() });
  });
  powerMonitor.on('resume', () => {
    // Extension point (T-050): compare against the absolute endsAt and end with SLEEP, or
    // re-apply the aside set and keep the remaining time. W1 only records the event so the
    // timer (which fires late after wake) still ends the session.
    logger.info('System resumed', { focusing: controller.isFocusing() });
    tray?.refresh();
  });
}

app.setName(APP_NAME);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  bootstrap().catch((error: unknown) => {
    noopLogger.error('Focus Agent bootstrap failed', error);
    fatal(error instanceof Error ? error.message : String(error));
  });
}
