// focus/consent.test.ts — REC-004 native first-run permission: stored locally, versioned,
// revocable, never granted by a web page. The dialog itself is Electron-owned (main.ts); these
// tests prove the gate that surrounds it: first run prompts, later runs reuse the decision, a
// version bump re-asks, a denial/exception never grants, and revocation asks again.

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConsentGate,
  FileConsentStore,
  NATIVE_CONSENT_COPY,
  NATIVE_CONSENT_FILE_NAME,
  NATIVE_CONSENT_VERSION,
  type ConsentStore,
  type NativeConsentRequest,
} from './consent.js';

const REQUEST: NativeConsentRequest = {
  durationMin: 25,
  allowList: [{ key: 'vscode', label: 'Visual Studio Code' }],
  protectedApps: [{ key: 'chrome', label: 'Google Chrome' }],
  reaside: true,
};

const now = (): Date => new Date('2026-11-10T10:00:00.000Z');
const tempDirs: string[] = [];

function makeDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-consent-'));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe('FileConsentStore', () => {
  it('returns null when nothing was decided yet', () => {
    const store = new FileConsentStore({ directory: makeDirectory() });
    expect(store.read()).toBeNull();
  });

  it('persists a decision as a private (0600) JSON file and reads it back', () => {
    const directory = makeDirectory();
    const store = new FileConsentStore({ directory });
    const record = { version: NATIVE_CONSENT_VERSION, acceptedAt: now().toISOString() };
    store.write(record);

    expect(store.filePath).toBe(path.join(directory, NATIVE_CONSENT_FILE_NAME));
    expect(statSync(store.filePath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(store.filePath, 'utf8'))).toEqual(record);
    expect(store.read()).toEqual(record);
  });

  it('treats a corrupt file as "not granted" instead of throwing on startup', () => {
    const directory = makeDirectory();
    const store = new FileConsentStore({ directory });
    store.write({ version: NATIVE_CONSENT_VERSION, acceptedAt: now().toISOString() });
    writeFileSync(store.filePath, '{not json', 'utf8');

    expect(store.read()).toBeNull();
  });

  it('clears the stored decision on revoke', () => {
    const directory = makeDirectory();
    const store = new FileConsentStore({ directory });
    store.write({ version: NATIVE_CONSENT_VERSION, acceptedAt: now().toISOString() });
    store.clear();
    expect(store.read()).toBeNull();
  });
});

describe('ConsentGate', () => {
  it('prompts on the first focus, stores the decision and never prompts again', async () => {
    const store = new FileConsentStore({ directory: makeDirectory() });
    const prompt = vi.fn(async () => true);
    const gate = new ConsentGate({ store, prompt, now });

    const first = await gate.ensure(REQUEST);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith(REQUEST);
    expect(first).toEqual({
      granted: true,
      prompted: true,
      record: { version: NATIVE_CONSENT_VERSION, acceptedAt: now().toISOString() },
    });
    expect(store.read()?.version).toBe(NATIVE_CONSENT_VERSION);

    const second = await gate.ensure(REQUEST);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ granted: true, prompted: false });
    expect(gate.isGranted()).toBe(true);
  });

  it('never stores a denial and fails closed when the dialog itself throws', async () => {
    const store = new FileConsentStore({ directory: makeDirectory() });
    const declined = new ConsentGate({ store, prompt: async () => false, now });
    await expect(declined.ensure(REQUEST)).resolves.toEqual({ granted: false, prompted: true });
    expect(store.read()).toBeNull();
    expect(declined.isGranted()).toBe(false);

    const broken = new ConsentGate({
      store,
      prompt: async () => {
        throw new Error('no dialog backend');
      },
      now,
    });
    await expect(broken.ensure(REQUEST)).resolves.toEqual({ granted: false, prompted: true });
    expect(store.read()).toBeNull();
  });

  it('re-asks when the stored consent version is older (copy/behaviour changed)', async () => {
    const store = new FileConsentStore({ directory: makeDirectory() });
    store.write({ version: 'native-consent-v0', acceptedAt: now().toISOString() });
    const prompt = vi.fn(async () => true);
    const gate = new ConsentGate({ store, prompt, now, version: 'native-consent-v2' });

    expect(gate.isGranted()).toBe(false);
    await gate.ensure(REQUEST);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(store.read()?.version).toBe('native-consent-v2');
  });

  it('asks again after a revoke and never auto-grants', async () => {
    const store = new FileConsentStore({ directory: makeDirectory() });
    const prompt = vi.fn(async () => true);
    const gate = new ConsentGate({ store, prompt, now });

    await gate.ensure(REQUEST);
    gate.revoke();
    expect(gate.isGranted()).toBe(false);

    const outcome = await gate.ensure(REQUEST);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ granted: true, prompted: true });
  });

  it('still grants this session when the decision cannot be persisted (asks again next start)', async () => {
    const write = vi.fn(() => {
      throw new Error('disk full');
    });
    const store: ConsentStore = {
      filePath: '/nonexistent/consent.json',
      read: () => null,
      write,
      clear: () => undefined,
    };
    const gate = new ConsentGate({ store, prompt: async () => true, now });

    await expect(gate.ensure(REQUEST)).resolves.toMatchObject({ granted: true, prompted: true });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('keeps the exact UX_SPEC §5.1 dialog copy (native dialog labels)', () => {
    expect(NATIVE_CONSENT_COPY.title).toBe('Let Focus Mode move other apps aside?');
    expect(NATIVE_CONSENT_COPY.allowButton).toBe('Allow and continue');
    expect(NATIVE_CONSENT_COPY.declineButton).toBe('Not now');
    expect(NATIVE_CONSENT_COPY.body).toContain('They are not closed and nothing is deleted.');
    expect(NATIVE_CONSENT_COPY.detail).toContain('stored on this computer only');
    expect(NATIVE_CONSENT_COPY.detail).toContain('Reset focus permission');
  });
});
