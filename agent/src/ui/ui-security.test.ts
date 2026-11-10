// ui/ui-security.test.ts — static guards for the sandboxed agent UI surface (SEC-8, INV-6).
// The behaviour is covered by the other colocated tests; these checks fail the build when the
// preload grows a new capability, the CSP weakens, the renderer starts injecting HTML, or the
// tray acquires a way to enable itself at login (REC-008). They mirror agent/src/hardening.test.ts
// and are intentionally cheap string checks.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_IPC_CHANNELS } from './view-state.js';

function read(name: string): string {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('preload bridge (SEC-8)', () => {
  const preload = read('./preload.cts');

  it('invokes exactly the frozen channels and derives the consent read from getState', () => {
    const invokes = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(
      (match) => match[1],
    );
    expect([...new Set(invokes)].sort()).toEqual(
      [AGENT_IPC_CHANNELS.endFocus, AGENT_IPC_CHANNELS.getState, AGENT_IPC_CHANNELS.quit].sort(),
    );
    expect(preload).toContain('showConsentStatus');
    expect(preload).toContain('state.consent ?? UNKNOWN_CONSENT');
  });

  it('exposes one frozen bridge and no event/listener passthrough', () => {
    expect(preload.match(/exposeInMainWorld/g)).toHaveLength(1);
    expect(preload).toContain("exposeInMainWorld('focusAgent'");
    expect(preload).toContain('Object.freeze(bridge)');
    expect(preload).not.toMatch(/ipcRenderer\.(send|sendSync|on|once|postMessage)\(/);
    expect(preload).not.toMatch(/from 'node:/);
    expect(preload).not.toMatch(/\brequire\(/);
  });
});

describe('renderer (classic script, no injection)', () => {
  const renderer = read('./renderer.ts');

  it('writes DOM only through textContent/createElement', () => {
    expect(renderer).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(renderer).not.toMatch(/\beval\(|new Function\(/);
    expect(renderer).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket/);
  });

  it('uses only the four bridge functions', () => {
    const calls = [...renderer.matchAll(/bridge\s*\.\s*(\w+)\(/g)].map((match) => match[1]);
    expect([...new Set(calls)].sort()).toEqual([
      'endFocus',
      'getState',
      'quit',
      'showConsentStatus',
    ]);
  });

  it('never renders an app identifier field (INV-6)', () => {
    for (const field of ['win', 'mac', 'linux', 'title', 'url']) {
      expect(renderer).not.toMatch(new RegExp(`app\\.${field}\\b`));
    }
  });
});

describe('window HTML + CSP (SEC-8)', () => {
  const html = read('./index.html');

  it('keeps a deny-by-default CSP with no network and no inline script', () => {
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
    for (const directive of [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(csp, directive).toContain(directive);
    }
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(html).toContain('<script src="./renderer.js" defer></script>');
  });

  it('gives the renderer an existing element for every lookup (no runtime crash)', () => {
    const renderer = read('./renderer.ts');
    const ids = [...renderer.matchAll(/byId\('([^']+)'\)/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      expect(html, id).toContain(`id="${id}"`);
    }
    const declared = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('declares the read-only allow-list and the End focus escape hatch', () => {
    expect(html).toContain('Allow-list (read-only)');
    expect(html).toContain('id="end-focus"');
    expect(html).toContain('Protected apps can never be removed or moved aside.');
  });
});

describe('tray adapter (REC-008, FR-022)', () => {
  const tray = read('../tray.ts');

  it('ships the three documented icon variants as data URLs', () => {
    const urls = [...tray.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map(
      (match) => match[1],
    );
    expect(urls).toHaveLength(3);
    expect(new Set(urls).size).toBe(3);
  });

  it('never enables itself at login and never imports main.ts', () => {
    expect(tray).not.toMatch(/setLoginItemSettings\s*\(/);
    expect(tray).not.toMatch(/from '\.\/main/);
    expect(tray).toContain('buildTrayMenu');
    expect(tray).toContain('static loginItemEnabled(');
  });

  it('reads the local first-run permission through the core consent store', () => {
    // Until main injects consentStatus/resetConsent, the tray must not claim a consent state:
    // it reads the *same* FileConsentStore the ConsentGate writes (one storage format).
    expect(tray).toContain('FileConsentStore');
    expect(tray).toContain('NATIVE_CONSENT_VERSION');
    expect(tray).toContain('this.#options.consentStatus');
    expect(tray).toContain('this.#options.resetConsent');
  });

  it('routes every user action through an injected callback', () => {
    expect(tray).toContain('options.endFocus()');
    expect(tray).toContain('options.showWindow()');
    expect(tray).toContain('options.quit()');
    expect(tray).toContain('options.setStartAtLogin');
    expect(tray).toContain('options.resetConsent');
  });
});
