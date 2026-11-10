// main.ts — main process wiring (T-030/T-050/T-051/T-113/T-064/T-069): app lifecycle, tray,
// dashboard link, journal-first FocusController, REC-004 native consent, REC-005 enforcement, the
// DEC-021 scheduled-session flow (heads-up → allow-list → SCHEDULE start → cloud report) and
// restore-before-exit on every quit path.
// Invariants kept here: INV-2 (a `scheduleDue` announcement is turned into focus only after the
// local ≥10 s heads-up + consent gate, never commanded from the cloud), INV-4/INV-5 (restore
// before emit/exit), FR-027 (session reports come from the controller lifecycle, so a closed
// dashboard tab cannot lose the session), DEC-003 (the pairing code stays in the window).
// Security (SEC-8): contextIsolation + sandbox + no nodeIntegration, navigation/window-open
// denied, preload exposes exactly {getState, endFocus, cancelSchedule, quit, showConsentStatus}.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  powerMonitor,
  safeStorage,
  session as electronSession,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
} from 'electron';
import type { LocalMessageType, OsName } from '@focus-mode/shared';
import { resolveProtectedEntries } from './allowlist.js';
import { CloudClient } from './cloud/client.js';
import { createLifecycleReporter, SessionReporter } from './cloud/reporting.js';
import { createCredentialStore } from './cloud/storage.js';
import { AgentEnvError, loadAgentEnv, type AgentConfig } from './config/env.js';
import { ConsentGate, FileConsentStore, NATIVE_CONSENT_COPY } from './focus/consent.js';
import {
  FocusController,
  type FocusLifecycleEvent,
  type FocusSnapshot,
} from './focus/controller.js';
import { createFocusDriver, resolveRuntimeProtectedApps } from './focus/drivers/index.js';
import { FileJournal } from './focus/journal.js';
import {
  AttestationGate,
  type AttestationBinding,
  type AttestationRequest,
  type AttestationVerification,
} from './link/attestation.js';
import { FocusLinkHandlers } from './link/handlers.js';
import {
  buildFocusEnded,
  buildFocusStarted,
  buildScheduleHeadsUp,
  type LinkSnapshot,
} from './link/messages.js';
import { LinkServer, type LinkAddress } from './link/server.js';
import type { Logger } from './log.js';
import { noopLogger } from './log.js';
import { createElectronLogger } from './log-electron.js';
import { createStderrLogger } from './log-process.js';
import { ScheduleFlow } from './schedule/flow.js';
import { AgentTray } from './tray.js';
import {
  SCHEDULE_HEADSUP_BODY,
  SCHEDULE_HEADSUP_TITLE,
  buildPendingScheduleView,
  type AgentViewState,
  type CancelScheduleResult,
  type ConsentStatusView,
} from './ui/view-state.js';

const APP_NAME = 'Focus Agent';
/**
 * Local hello label for this agent process. The authoritative device identity on the local
 * channel is `authOk {deviceId,userId}` after attestation (T-044); nothing trusts this label.
 */
const AGENT_ID = 'focus-agent-local';
const WINDOW_SIZE = { width: 464, height: 620, minWidth: 380, minHeight: 520 } as const;
const UI_BACKGROUND = '#1E1B4B';
/** Renderer is allowed to call exactly these three channels via the preload (ui/view-state.ts). */
const IPC_CHANNELS = {
  getState: 'agent:get-state',
  endFocus: 'agent:end-focus',
  /** DEC-021: cancel the scheduled-session heads-up. Starts nothing, ever. */
  cancelSchedule: 'agent:cancel-schedule',
  quit: 'agent:quit',
} as const;
/** T-113: a smoke run must fail within 20 s instead of hanging a CI job. */
const SMOKE_TIMEOUT_MS = 20_000;
/** Give the `state` frame time to flush before the smoke process exits 0. */
const SMOKE_EXIT_DELAY_MS = 150;
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

  // Single-instance lock: a second tray agent would fight over the journal and the link port.
  // The smoke hook is exempt because it is a one-shot, isolated run (own userData + port) that
  // must not be blocked by a Focus Agent the user already has open.
  if (!config.smoke && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  // Headless means "no window and no tray": AGENT_HEADLESS (tests) or the T-113 smoke hook.
  const headless = config.headless || config.smoke;
  // The smoke line must be the only stdout output, so headless runs log to stderr only.
  const logger: Logger = config.smoke
    ? createStderrLogger(config.logLevel)
    : createElectronLogger(config.logLevel);
  const os = resolveOsName();

  let mainWindow: BrowserWindow | undefined;
  let tray: AgentTray | undefined;
  let shuttingDown = false;
  let shuttingDownPromise: Promise<void> | undefined;
  const uiIndexPath = resolveUiIndexPath();
  const uiUrl = pathToFileURL(uiIndexPath).toString();

  // Pairing/token state lives in the cloud client; the controller owns the IDLE/PAIRED/FOCUSING
  // truth (INV-5). `cloud` is created after the tray so an early `paired` event can refresh it.
  let cloud: CloudClient | undefined;
  const credentialStore = createCredentialStore({
    directory: app.getPath('userData'),
    // Electron 45's supported async safeStorage API; the sync calls are deprecated and can
    // report a false "unavailable" on macOS, which would silently disable durable pairing.
    safeStorage: {
      isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      encryptString: (plainText) => safeStorage.encryptStringAsync(plainText),
      decryptString: async (encrypted) => (await safeStorage.decryptStringAsync(encrypted)).result,
    },
    logger,
  });
  const currentPairing = (): AttestationBinding | null => cloud?.getPairing() ?? null;
  // No API base URL means the agent cannot register a code or verify attestations: it stays
  // unpaired (honest IDLE, no code shown) instead of pretending to be pair-able.
  const attestationGate =
    config.apiBaseUrl === undefined
      ? undefined
      : new AttestationGate({
          baseUrl: config.apiBaseUrl,
          getBinding: currentPairing,
          logger,
        });
  const verifyAttestation = async (
    request: AttestationRequest,
  ): Promise<AttestationVerification> => {
    if (attestationGate === undefined) {
      return {
        ok: false,
        code: 'UNAUTHENTICATED',
        reason: 'NOT_PAIRED',
        message: 'Attestation verification is not configured.',
      };
    }
    return attestationGate.verify(request);
  };

  /**
   * REC-004: the native first-run dialog. It is shown by this main process only — no IPC
   * channel and no local-channel message can answer it, so a web page cannot grant it.
   */
  async function promptNativeConsent(): Promise<boolean> {
    const options: MessageBoxOptions = {
      type: 'question',
      title: NATIVE_CONSENT_COPY.title,
      message: NATIVE_CONSENT_COPY.title,
      detail: `${NATIVE_CONSENT_COPY.body}\n\n${NATIVE_CONSENT_COPY.detail}`,
      buttons: [NATIVE_CONSENT_COPY.allowButton, NATIVE_CONSENT_COPY.declineButton],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      ...(mainWindow !== undefined && !mainWindow.isDestroyed() ? { modal: true } : {}),
    };
    const result =
      mainWindow !== undefined && !mainWindow.isDestroyed()
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options);
    return result.response === 0;
  }

  const consentGate = new ConsentGate({
    store: new FileConsentStore({ directory: app.getPath('userData'), logger }),
    prompt: promptNativeConsent,
    logger,
  });

  // Filled right after the link server is constructed, so the controller's lifecycle events can
  // broadcast to dashboards that are already connected.
  const link: { server?: LinkServer } = {};

  /**
   * T-069/FR-027: session reports go to the cloud from the controller lifecycle, so a session is
   * persisted even when the dashboard tab was closed (its POST /sessions never runs). The
   * transport is late-bound to `cloud`; a report created while the link is down is queued and
   * flushed on the next `connected` event. REC-006: de-duplicated on `clientSessionId`.
   */
  const reporter = new SessionReporter({
    transport: { send: (message) => cloud?.sendCloudMessage(message) ?? false },
    logger,
  });
  const reportLifecycle = createLifecycleReporter(reporter);

  // DEC-021: the scheduled-session flow (pending heads-up, allow-list fetch, SCHEDULE start).
  // Assigned after `cloud` exists; `viewState()`/IPC read it through this handle.
  let scheduleFlow: ScheduleFlow | undefined;

  /** Native heads-up for a scheduled run; the tray + window are the cancel surfaces (FR-012). */
  function showScheduleNotification(title: string, body: string): void {
    if (headless || config.smoke) return;
    try {
      if (!Notification.isSupported()) {
        logger.warn('Native notifications are not supported here; the tray/window show the run');
        return;
      }
      const notification = new Notification({ title, body, silent: false });
      // Any interaction brings up the window, which carries the Cancel button.
      notification.on('click', () => showWindow());
      notification.show();
    } catch (error) {
      // A notification failure must never take the agent (or the heads-up) down.
      logger.warn('Could not show the scheduled-session notification', error);
    }
  }

  // DEC-006: the OS default browser is protected even if it is not one of the hard-coded
  // browsers (macOS resolves it via NSWorkspace; other platforms return []). Failure is
  // non-fatal — static protection still stands.
  const runtimeProtected = await resolveRuntimeProtectedApps({ logger });

  const controller = new FocusController({
    driver: createFocusDriver({
      configured: config.driver,
      isPackaged: app.isPackaged,
      logger,
    }),
    journal: new FileJournal({ directory: app.getPath('userData'), logger }),
    protectedEntries: resolveProtectedEntries(os, runtimeProtected),
    os,
    consent: consentGate,
    initialPaired: false,
    enforcement: { intervalMs: config.enforceIntervalMs },
    logger,
    onEvent: (event: FocusLifecycleEvent) => {
      if (event.type === 'focusStarted') {
        logger.info('Focus session started', {
          sessionId: event.sessionId,
          endsAt: event.endsAt,
          source: event.source,
          ...(event.scheduleRunId === undefined ? {} : { scheduleRunId: event.scheduleRunId }),
        });
        // One frame per event per authenticated dashboard, whatever triggered the start.
        link.server?.broadcast(buildFocusStarted(event, controller.getState().protected));
        // T-069: one report per started session (MANUAL and SCHEDULE alike). Idempotent by
        // clientSessionId, so the dashboard's own POST /sessions can race it safely (REC-006).
        reportLifecycle(event);
      } else {
        logger.info('Focus session ended', {
          sessionId: event.sessionId,
          reason: event.reason,
          actualMinutes: event.actualMinutes,
          status: event.status,
        });
        link.server?.broadcast(buildFocusEnded(event));
        // Covers every end trigger (dashboard, tray, timer, sleep, crash recovery, unpair, quit):
        // the dashboard-closed path is exactly why this report exists (FR-027).
        reportLifecycle(event);
      }
      tray?.refresh();
    },
  });

  const linkHandlers = new FocusLinkHandlers({ controller, logger });

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
        paired: cloud?.getState().paired ?? false,
        ...(snapshot.session === undefined ? {} : { session: snapshot.session }),
        protected: snapshot.protected,
        allowList: snapshot.allowList,
      };
    },
    getPairing: currentPairing,
    ...(config.apiBaseUrl === undefined
      ? {}
      : {
          // Ed25519 attestation verification (REC-003/SEC-7); fails closed without a base URL.
          verifyAttestation,
        }),
    controlHandlers: linkHandlers,
    onMessageHandled: (type: LocalMessageType) => smokeProgress(type),
    onPaired: () => {
      // A nudge only: the device token comes from polling the cloud (REC-002), never the page.
      logger.info('Dashboard sent the paired nudge; polling the cloud');
      cloud?.notifyPairedNudge();
    },
    logger,
  });

  // Fill the late-bound handle BEFORE the link starts serving: the controller's lifecycle events
  // (focusStarted/focusEnded) are broadcast through it, so without this assignment every
  // dashboard would silently miss the focus transition (T-050/T-051 integration bug found by the
  // W3 E2E gate: the journal showed FOCUSING while no dashboard ever received `focusStarted`).
  link.server = linkServer;

  /**
   * REC-004 state for the agent window/tray (UX_SPEC §5.1). Derived from the same stored record
   * the gate uses, so the window can never show "granted" while the gate would still prompt.
   */
  function consentStatusView(): ConsentStatusView {
    const record = controller.nativeConsentRecord();
    return record === null
      ? { status: 'not-granted', grantedAt: null, revocable: false }
      : { status: 'granted', grantedAt: record.acceptedAt, revocable: true };
  }

  /** `down` when the loopback link never bound; `listening` when no dashboard is attached. */
  function dashboardLinkStatus(): 'connected' | 'listening' | 'down' {
    if (linkAddress === undefined) return 'down';
    return linkServer.connectedClients > 0 ? 'connected' : 'listening';
  }

  function viewState(): AgentViewState {
    const snapshot: FocusSnapshot = controller.getState();
    const cloudState = cloud?.getState();
    const isPaired = cloudState?.paired ?? false;
    const pendingRun = scheduleFlow?.pending() ?? null;
    return {
      agentVersion: app.getVersion(),
      os,
      state: snapshot.state,
      paired: isPaired,
      // The real code from T-042, shown in this window/tray only — never on any wire (DEC-003).
      pairingCode: isPaired ? null : (cloudState?.pairingCode ?? null),
      capabilities: controller.capabilities(),
      session: snapshot.session ?? null,
      protected: snapshot.protected,
      allowList: snapshot.allowList,
      // Read-only view of the native first-run permission (revoke is a tray action).
      consent: consentStatusView(),
      // DEC-021/T-064: the heads-up must be visible in the window (and assertable via IPC), so a
      // scheduled start can never happen without the user having seen a cancellable run.
      pendingSchedule:
        pendingRun === null ? null : buildPendingScheduleView(pendingRun, new Date()),
      // Honest link health for the window (the renderer already has copy for every state).
      links: {
        cloud:
          cloudState === undefined
            ? 'not-configured'
            : cloudState.connected
              ? 'connected'
              : 'disconnected',
        dashboard: dashboardLinkStatus(),
        dashboards: linkServer.connectedClients,
      },
    };
  }

  function showWindow(): void {
    if (headless || mainWindow === undefined) return;
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
    ipcMain.handle(IPC_CHANNELS.cancelSchedule, (event): CancelScheduleResult => {
      assertTrustedSender(event);
      if (scheduleFlow === undefined) {
        return { ok: false, outcome: 'NOTHING_PENDING' };
      }
      // DEC-021: the flow clears the heads-up before sending `scheduleRunCancelled`, so a second
      // click can never produce a second message for the same run.
      const outcome = scheduleFlow.cancel();
      tray?.refresh();
      return outcome === 'CANCELLED'
        ? { ok: true, outcome }
        : { ok: false, outcome, message: 'No scheduled session is waiting to start.' };
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

  /**
   * SEC-8: the agent window is a local, static HTML page and needs no web platform permission
   * (camera, microphone, geolocation, notifications, clipboard, MIDI, fullscreen…). Electron's
   * defaults can grant some of those to a renderer; deny every request and every check so a
   * compromised renderer cannot use the window as a permission proxy.
   */
  function hardenDefaultSession(): void {
    electronSession.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => {
        callback(false);
      },
    );
    electronSession.defaultSession.setPermissionCheckHandler(() => false);
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
        nodeIntegrationInWorker: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
        preload: path.join(DIST_DIR, 'ui', 'preload.cjs'),
      },
    });

    window.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    // A local file page never legitimately redirects; deny it like any other navigation.
    window.webContents.on('will-redirect', (event) => {
      event.preventDefault();
    });
    // No webview may be attached to the agent window (webviewTag is off as well).
    window.webContents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.on('close', (event) => {
      if (shuttingDown) return;
      // Closing the window hides it: the tray stays available (FR-022).
      event.preventDefault();
      window.hide();
    });
    window.once('ready-to-show', () => {
      window.show();
    });
    void window.loadFile(uiIndexPath);
    return window;
  }

  async function shutdown(): Promise<void> {
    if (shuttingDownPromise !== undefined) return shuttingDownPromise;
    shuttingDown = true;
    shuttingDownPromise = (async () => {
      logger.info('Focus Agent shutting down');
      // DEC-021: a heads-up that never elapsed is dropped locally; the cloud reaper records that
      // run as MISSED (no cancel message, because the user did not cancel it).
      scheduleFlow?.dispose();
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
      try {
        await cloud?.stop();
      } catch (error) {
        logger.error('Cloud link shutdown failed', error);
      }
      tray?.destroy();
      tray = undefined;
      if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.destroy();
      app.exit(0);
    })();
    return shuttingDownPromise;
  }

  // -------------------------------------------------------------------------
  // T-113 AGENT_SMOKE: headless one-shot, no window/tray/cloud/pairing.
  // Exactly one stdout line (`SMOKE_READY port=<n>`); one `hello` + `getState` answered;
  // exit 0. Any failure (or no getState within 20 s) exits non-zero.
  // -------------------------------------------------------------------------
  let smokeFailsafe: ReturnType<typeof setTimeout> | undefined;
  let smokeAnswered = false;

  function smokeExit(code: number): void {
    if (smokeFailsafe !== undefined) clearTimeout(smokeFailsafe);
    smokeFailsafe = undefined;
    app.exit(code);
  }

  function smokeProgress(type: LocalMessageType): void {
    if (!config.smoke || type !== 'getState' || smokeAnswered) return;
    smokeAnswered = true;
    // Give the `state` frame time to flush before exiting 0.
    setTimeout(() => smokeExit(0), SMOKE_EXIT_DELAY_MS);
  }

  function armSmokeFailsafe(): void {
    smokeFailsafe = setTimeout(() => {
      process.stderr.write('SMOKE_FAIL no getState was answered within 20 s\n');
      smokeExit(1);
    }, SMOKE_TIMEOUT_MS);
  }

  // Armed before startup: even a hang while binding the port fails the CI job within 20 s.
  if (config.smoke) {
    // A smoke run has no window: skipping the GPU/rasteriser subprocesses avoids a headless
    // container/CI failure mode ("GPU process isn't usable") without touching the security
    // posture of a normal tray run (SEC-8 hardening switches are unchanged).
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-software-rasterizer');
    armSmokeFailsafe();
  }

  await app.whenReady();
  // SEC-8: deny every renderer permission request before any window exists.
  hardenDefaultSession();
  logger.info('Focus Agent starting', {
    version: app.getVersion(),
    os,
    driver: config.driver,
    headless,
    loopbackPort: config.port,
    mode: config.smoke ? 'smoke' : 'normal',
  });
  // FR-023: restore from the journal BEFORE the window/link can report state (INV-4/INV-5).
  const recovery = await controller.recoverFromJournal();
  if (recovery !== null) {
    logger.info('Startup journal recovery finished', {
      sessionId: recovery.sessionId,
      restored: recovery.restored,
      actualMinutes: recovery.actualMinutes,
    });
  }

  let linkAddress: LinkAddress | undefined;
  try {
    linkAddress = await linkServer.start();
    logger.info('Dashboard link ready', { host: linkAddress.host, port: linkAddress.port });
  } catch (error) {
    // The tray remains the escape hatch; a busy link must not stop the agent.
    logger.error('Dashboard link did not start', error);
  }

  if (config.smoke) {
    if (linkAddress === undefined) {
      process.stderr.write('SMOKE_FAIL the loopback link server did not start\n');
      smokeExit(1);
      return;
    }
    // The single machine-readable line `scripts/smoke/launch.mjs` waits for (T-113).
    process.stdout.write(`SMOKE_READY port=${linkAddress.port}\n`);
    return;
  }

  registerIpcHandlers();

  if (!headless) {
    mainWindow = createMainWindow();
    tray = new AgentTray({
      getState: () => {
        const state = viewState();
        return {
          state: state.state,
          paired: state.paired,
          pairingCode: state.pairingCode,
          sessionEndsAt: state.session?.endsAt ?? null,
          consent: state.consent ?? null,
          cloud: state.links?.cloud ?? 'unknown',
          // DEC-021: while a scheduled run is in its heads-up the menu shows the countdown and
          // an always-enabled Cancel — the second escape hatch next to the window (FR-012).
          pendingSchedule: scheduleFlow?.pending() ?? null,
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
      cancelScheduledSession: () => {
        scheduleFlow?.cancel();
      },
      quit: () => {
        void shutdown();
      },
      startAtLoginEnabled: () => AgentTray.loginItemEnabled(),
      setStartAtLogin,
      // REC-004 "Reset focus permission" (UX_SPEC §5.1): one consent source of truth.
      consentStatus: () => consentStatusView(),
      resetConsent: () => {
        controller.revokeNativeConsent();
      },
    });
  }

  // Cloud pairing + presence runs after the tray exists so `paired`/`revoked` can refresh it.
  // Without AGENT_API_BASE_URL there is nothing to pair against, so the agent stays IDLE and the
  // window shows no code rather than a code that can never work.
  if (config.apiBaseUrl === undefined) {
    logger.warn(
      'AGENT_API_BASE_URL is not set; cloud pairing is disabled and no pairing code is issued',
    );
  } else {
    cloud = new CloudClient({
      baseUrl: config.apiBaseUrl,
      agentVersion: app.getVersion(),
      os,
      controller: {
        getState: () => controller.getState(),
        markPaired: () => controller.markPaired(),
        markUnpaired: () => controller.markUnpaired(),
        exitFocus: (reason) => controller.exitFocus(reason),
      },
      store: credentialStore,
      logger,
    });

    cloud.on('paired', (info) => {
      logger.info('Cloud pairing established; local dashboards may now authenticate', {
        deviceId: info.deviceId,
      });
      // KI-010 agent half: dashboards connected before pairing got an unpaired `hello` and no
      // challenge, so a fresh `hello` + `challenge` is re-issued now — no page reload needed.
      linkServer.refreshPairing();
      tray?.refresh();
    });
    cloud.on('revoked', (info) => {
      logger.info('Cloud revoked this device; back to the unpaired flow', { reason: info.reason });
      // KI-010 agent half: the frozen local protocol has no "unpaired" frame, so authenticated
      // dashboards are told by a policy close (1008) and re-handshake as unpaired on reconnect.
      linkServer.notifyUnpaired();
      // A heads-up can no longer start (there is no device token): drop it without pretending the
      // user cancelled — the cloud reaper records that run as MISSED (DEC-021 §4).
      scheduleFlow?.dispose();
      tray?.refresh();
    });
    cloud.on('connected', (info) => {
      // T-069: a report created while the link was down must not be lost (FR-027).
      if (info.connected) reporter.flush();
      tray?.refresh();
    });
    cloud.on('scheduleDue', (message) => {
      // INV-2: this is an announcement. The flow shows the local ≥10 s heads-up and only starts
      // focus after it elapses, through the controller's consent gate (DEC-021).
      scheduleFlow?.handleScheduleDue(message);
    });

    // DEC-021: the scheduled-session flow. Everything it touches is injected, so the cancel /
    // timeout / failure matrix is unit-tested against the FakeDriver with no Electron.
    scheduleFlow = new ScheduleFlow({
      baseUrl: config.apiBaseUrl,
      headsUpMs: config.scheduleHeadsUpMs,
      getDeviceToken: () => cloud?.getDeviceToken() ?? null,
      getCapabilities: () => controller.capabilities(),
      isFocusing: () => controller.isFocusing(),
      enterFocus: (request) => controller.enterFocus(request),
      sendCloud: (message) => cloud?.sendCloudMessage(message) ?? false,
      logger,
      onHeadsUp: (pending) => {
        // Local dashboards get the informational frame; the native notification is the visible
        // heads-up, and the tray/window carry the Cancel affordance (FR-012).
        link.server?.broadcast(buildScheduleHeadsUp(pending));
        showScheduleNotification(
          SCHEDULE_HEADSUP_TITLE,
          `${SCHEDULE_HEADSUP_BODY}\n\n${pending.durationMin} min session starts in ` +
            `${Math.round(config.scheduleHeadsUpMs / 1000)} s — cancel it from the Focus Agent ` +
            'window or its tray menu.',
        );
        logger.info('Scheduled session heads-up is visible; waiting for the user or the window', {
          runId: pending.runId,
          durationMin: pending.durationMin,
          startsAt: pending.startsAt,
        });
        tray?.refresh();
      },
      onStarted: (pending, sessionId) => {
        logger.info('Scheduled session started from the heads-up', {
          runId: pending.runId,
          sessionId,
        });
        tray?.refresh();
      },
      onCancelled: (pending) => {
        logger.info('Scheduled session cancelled by the user', { runId: pending.runId });
        tray?.refresh();
      },
      onFailed: (pending, reason, detail) => {
        // Honest failure: no focus was applied. The user still gets a visible reason.
        showScheduleNotification(
          'Scheduled session did not start',
          `Focus Mode could not start the ${pending.durationMin} min scheduled session: ${detail}.`,
        );
        tray?.refresh();
        logger.warn('Scheduled session failed honestly; nothing was applied', {
          runId: pending.runId,
          reason,
        });
      },
    });

    try {
      await cloud.start();
    } catch (error) {
      // A cloud failure must not take the agent (or its focus restore) down.
      logger.error('Cloud pairing client failed to start', error);
    }
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

  // TD §7.4: record when the machine sleeps and reconcile the absolute deadline on wake.
  powerMonitor.on('suspend', () => {
    logger.info('System suspending', { focusing: controller.isFocusing() });
    controller.recordSuspend();
  });
  powerMonitor.on('resume', () => {
    logger.info('System resumed', { focusing: controller.isFocusing() });
    void controller
      .resumeFromSleep()
      .then((ended) => {
        if (ended !== null) {
          logger.info('Sleep reconcile ended the focus session', {
            reason: ended.reason,
            status: ended.status,
            actualMinutes: ended.actualMinutes,
          });
        }
        tray?.refresh();
      })
      .catch((error: unknown) => {
        logger.error('Sleep reconcile failed; the absolute timer still ends the session', error);
      });
  });
}

app.setName(APP_NAME);

// `bootstrap()` requests the single-instance lock itself (after the validated config decides
// whether this is an isolated smoke run), so the lock is still taken before `app.whenReady()`.
bootstrap().catch((error: unknown) => {
  noopLogger.error('Focus Agent bootstrap failed', error);
  fatal(error instanceof Error ? error.message : String(error));
});
