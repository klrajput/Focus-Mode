// hardening.test.ts — static and runtime guards for SEC-8 and the non-negotiable rules.
// These are cheap tripwires that fail the build when someone removes Electron isolation, adds a
// shell string, reads window titles, weakens the CSP or makes the FakeDriver shippable.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { agentCapabilitiesSchema } from '@focus-mode/shared';
import { parseAgentEnv } from './config/env.js';
import { createFocusDriver, FakeDriverNotAllowedError } from './focus/drivers/index.js';
import { FakeDriver } from './focus/drivers/fake.js';
import { journalEntrySchema, journalWindowRefSchema } from './focus/journal.js';
import { noopLogger } from './log.js';
import { AGENT_IPC_CHANNELS } from './ui/view-state.js';

const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));

function read(relativePath: string): string {
  return readFileSync(path.join(SRC_DIR, relativePath), 'utf8');
}

function sourceFiles(): readonly string[] {
  return readdirSync(SRC_DIR, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.cts'))
    .filter((entry) => !entry.endsWith('.test.ts'))
    .sort();
}

describe('Electron hardening (SEC-8)', () => {
  const main = read('main.ts');

  it('enables contextIsolation + sandbox and disables nodeIntegration', () => {
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/sandbox:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/nodeIntegrationInWorker:\s*false/);
    expect(main).toMatch(/webviewTag:\s*false/);
    expect(main).toMatch(/webSecurity:\s*true/);
    expect(main).toMatch(/allowRunningInsecureContent:\s*false/);
    expect(main).not.toMatch(/nodeIntegrationInWorker:\s*true/);
    expect(main).not.toMatch(/\bremote\b\s*:/);
  });

  it('denies navigation, redirects, webviews and window.open', () => {
    expect(main).toMatch(/will-navigate/);
    expect(main).toMatch(/will-redirect/);
    expect(main).toMatch(/will-attach-webview/);
    expect(main).toMatch(/setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*'deny'/);
  });

  it('denies every renderer permission request (SEC-8)', () => {
    expect(main).toMatch(/setPermissionRequestHandler/);
    expect(main).toMatch(/setPermissionCheckHandler/);
    // The handler must answer "no" on both the request and the synchronous check path.
    const request = main.slice(main.indexOf('setPermissionRequestHandler'));
    expect(request.slice(0, 200)).toMatch(/callback\(false\)/);
    const check = main.slice(main.indexOf('setPermissionCheckHandler'));
    expect(check.slice(0, 120)).toMatch(/\(\)\s*=>\s*false/);
  });

  it('uses a single-instance lock and restores before quitting', () => {
    expect(main).toMatch(/requestSingleInstanceLock\(\)/);
    expect(main).toMatch(/before-quit/);
    expect(main).toMatch(/exitFocus\('QUIT'\)/);
    expect(main).toMatch(/SIGTERM/);
    expect(main).toMatch(/SIGINT/);
  });

  it('keeps the agent alive in the tray when the window closes', () => {
    expect(main).toMatch(/window-all-closed/);
    const windowAllClosed = main.slice(main.indexOf("app.on('window-all-closed'"));
    const block = windowAllClosed.slice(0, windowAllClosed.indexOf('});'));
    expect(block).not.toMatch(/app\.quit\(\)/);
  });

  it('has a strict CSP with no inline script, eval or network access', () => {
    const html = read('ui/index.html');
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });

  it('exposes exactly the frozen preload surface (4 IPC channels, no new capability)', () => {
    const preload = read('ui/preload.cts');

    // The renderer surface is frozen: 4 IPC channels. `showConsentStatus` is a derived read over
    // `getState`, not a fifth channel, so the privileged surface did not grow.
    expect(Object.keys(AGENT_IPC_CHANNELS)).toHaveLength(4);
    expect(new Set(Object.values(AGENT_IPC_CHANNELS)).size).toBe(4);
    const invokes = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(
      (match) => match[1],
    );
    expect([...new Set(invokes)].sort()).toEqual([...Object.values(AGENT_IPC_CHANNELS)].sort());

    for (const fn of ['getState', 'endFocus', 'cancelSchedule', 'quit', 'showConsentStatus']) {
      expect(preload).toMatch(new RegExp(`\\b${fn}\\b`));
    }
    expect(preload).toMatch(/Object\.freeze\(bridge\)/);
    expect(preload).not.toMatch(/ipcRenderer\.(send|sendSync|on|once|postMessage)\(/);
    expect(preload).not.toMatch(/exposeInMainWorld\((?!'focusAgent')/);
    expect(preload.match(/exposeInMainWorld/g)).toHaveLength(1);
  });

  it('renders with textContent only (no HTML injection in the renderer)', () => {
    const renderer = read('ui/renderer.ts');
    expect(renderer).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });
});

describe('No shell strings and no window-title access (INV-6, SEC rules)', () => {
  it('never calls shell-string process APIs (execFile/spawn with arg arrays only)', () => {
    for (const file of sourceFiles()) {
      const source = read(file);
      // `exec`/`execSync` take a shell command string; `execFile`/`spawn` with an argument
      // array are the allowed primitives for the W3 drivers.
      expect(source, file).not.toMatch(/\bexec(Sync)?\(/);
      expect(source, file).not.toMatch(/shell:\s*true/);
    }
  });

  it('never reads window titles or URLs from the OS', () => {
    for (const file of sourceFiles()) {
      const source = read(file);
      expect(source, file).not.toMatch(/GetWindowText/);
      expect(source, file).not.toMatch(/kCGWindowName/);
      expect(source, file).not.toMatch(/CGWindowListCopyWindowInfo/);
      expect(source, file).not.toMatch(/AXTitle|AXDocument/);
      expect(source, file).not.toMatch(/\bWin\+D\b|show desktop/i);
      // BrowserWindow has a static title; reading a page/OS title or URL is what INV-6 forbids.
      expect(source, file).not.toMatch(/webContents\.getURL\(|webContents\.getTitle\(/);
      expect(source, file).not.toMatch(/document\.title|location\.href/);
      expect(source, file).not.toMatch(/loadURL\(|openExternal\(/);
    }
  });

  it('has a journal schema without title/url fields', () => {
    expect(Object.keys(journalEntrySchema.shape)).not.toContain('title');
    expect(Object.keys(journalEntrySchema.shape)).not.toContain('url');
    expect(Object.keys(journalWindowRefSchema.shape)).toEqual(['handle', 'appKey', 'identifier']);
  });

  it('never puts the pairing code on the link wire', () => {
    const messages = read('link/messages.ts');
    const server = read('link/server.ts');
    expect(messages).not.toMatch(/pairingCode/);
    expect(server).not.toMatch(/pairingCode/);
  });
});

describe('main-process wiring tripwires', () => {
  it('fills the late-bound link handle so lifecycle frames reach dashboards', () => {
    // Regression guard for the W3 E2E bug: main.ts built the link server but never assigned
    // `link.server`, so focusStarted/focusEnded broadcasts were silent no-ops while the journal
    // and the controller claimed FOCUSING. Static check — the wiring is main-process-only.
    const source = read('main.ts');
    expect(source).toContain('link.server = linkServer');
    expect(source).toContain('link.server?.broadcast(buildFocusStarted(');
    expect(source).toContain('link.server?.broadcast(buildFocusEnded(');
  });

  it('recovers the journal before the link/window can serve state (T-080/FR-023)', () => {
    // Ordering in main.ts is the guarantee that a restarted agent never reports a phantom
    // FOCUSING session: recovery (restore + clear + CRASH_RECOVERY event) must complete before
    // the WebSocket link starts accepting `hello`/`getState` and before the window is created.
    const source = read('main.ts');
    const readyIndex = source.indexOf('await app.whenReady()');
    const recoveryIndex = source.indexOf('await controller.recoverFromJournal()');
    const linkIndex = source.indexOf('await linkServer.start()');
    const windowIndex = source.indexOf('mainWindow = createMainWindow()');
    expect(readyIndex).toBeGreaterThan(-1);
    expect(recoveryIndex).toBeGreaterThan(readyIndex);
    expect(linkIndex).toBeGreaterThan(recoveryIndex);
    expect(windowIndex).toBeGreaterThan(recoveryIndex);
  });
});

describe('driver selection (AGENTS §8)', () => {
  it('refuses the FakeDriver in a packaged build', () => {
    expect(() =>
      createFocusDriver({ configured: 'fake', isPackaged: true, logger: noopLogger }),
    ).toThrow(FakeDriverNotAllowedError);
  });

  it('allows the FakeDriver only outside packaged builds', () => {
    expect(
      createFocusDriver({ configured: 'fake', isPackaged: false, logger: noopLogger }),
    ).toBeInstanceOf(FakeDriver);
  });

  it('selects a real platform driver, never a fake, in a packaged build (W3)', () => {
    const driver = createFocusDriver({ configured: 'real', isPackaged: true, logger: noopLogger });
    expect(driver.name).not.toBe('fake');
    const caps = driver.capabilities();
    expect(agentCapabilitiesSchema.safeParse(caps).success).toBe(true);
    if (process.platform === 'darwin' || process.platform === 'win32') {
      expect(caps.focus).toBe('full');
    }
    if (caps.focus === 'unsupported') {
      expect((caps.reasons ?? []).length).toBeGreaterThan(0);
    }
  });

  it('defaults to the real driver, never fake', () => {
    expect(parseAgentEnv({}).driver).toBe('real');
  });
});
