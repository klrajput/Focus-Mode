// link/handlers.test.ts — authenticated local control → FocusController (T-051).
// The native consent gate is real (injected prompt), the driver is the FakeDriver and the
// journal is a real file: these tests cover the exact mapping the dashboard sees — rejection
// codes, the stale-session exit, REC-007 listApps and that no driver error string leaks.

import { afterEach, describe, expect, it } from 'vitest';
import {
  appsMessageSchema,
  focusRejectedMessageSchema,
  stateMessageSchema,
  type EnterFocusMessage,
  type ExitFocusMessage,
} from '@focus-mode/shared';
import { FocusLinkHandlers, type FocusControlTarget } from './handlers.js';
import { FakeDriver } from '../focus/drivers/fake.js';
import type { WindowRef } from '../allowlist.js';
import {
  START,
  cleanupHarnessDirs,
  makeHarness,
  request,
  type Harness,
} from '../focus/controller.harness.js';

const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';

function enterMessage(overrides: Partial<EnterFocusMessage> = {}): EnterFocusMessage {
  return {
    v: 1,
    id: 'd-1',
    type: 'enterFocus',
    durationMin: 25,
    allowList: [{ key: 'vscode', label: 'Visual Studio Code', mac: ['com.microsoft.VSCode'] }],
    reaside: true,
    consent: { acceptedAt: START.toISOString(), version: 'consent-v1' },
    clientSessionId: SESSION_ID,
    ...overrides,
  };
}

function exitMessage(overrides: Partial<ExitFocusMessage> = {}): ExitFocusMessage {
  return { v: 1, id: 'd-2', type: 'exitFocus', sessionId: SESSION_ID, ...overrides };
}

function handlers(harness: Harness): FocusLinkHandlers {
  return new FocusLinkHandlers({ controller: harness.controller });
}

let current: Harness | undefined;

function harness(options: Parameters<typeof makeHarness>[0] = {}): Harness {
  current = makeHarness(options);
  return current;
}

afterEach(async () => {
  await current?.controller.exitFocus('QUIT').catch(() => undefined);
  current = undefined;
  cleanupHarnessDirs();
});

describe('FocusLinkHandlers.enterFocus', () => {
  it('starts a session on the FakeDriver and returns no duplicate focusStarted frame', async () => {
    const h = harness();
    const messages = await handlers(h).enterFocus(enterMessage());

    // focusStarted is broadcast by the link server from the controller event (one frame/event).
    expect(messages).toEqual([]);
    expect(h.controller.getState().state).toBe('FOCUSING');
    expect(h.driver.isAsided('w-slack')).toBe(true);
    expect(h.driver.isAsided('w-chrome')).toBe(false);
    expect(h.driver.isAsided('w-vscode')).toBe(false);
  });

  it('rejects a second session with ALREADY_FOCUSING (FR-024)', async () => {
    const h = harness();
    await handlers(h).enterFocus(enterMessage());
    const messages = await handlers(h).enterFocus(
      enterMessage({ clientSessionId: crypto.randomUUID() }),
    );

    const rejection = focusRejectedMessageSchema.parse(messages[0]);
    expect(rejection.code).toBe('ALREADY_FOCUSING');
    expect(h.controller.getState().state).toBe('FOCUSING');
  });

  it('rejects with NOT_PAIRED on an unpaired agent', async () => {
    const h = harness({ initialPaired: false });
    const messages = await handlers(h).enterFocus(enterMessage());
    expect(focusRejectedMessageSchema.parse(messages[0]).code).toBe('NOT_PAIRED');
    expect(h.driver.getCallLog()).toEqual([]);
  });

  it('maps a declined native dialog to CONSENT_REQUIRED and never touches a window', async () => {
    const h = harness({ grantConsent: false });
    const messages = await handlers(h).enterFocus(enterMessage());
    expect(focusRejectedMessageSchema.parse(messages[0]).code).toBe('CONSENT_REQUIRED');
    expect(h.driver.getCallLog()).toEqual([]);
    expect(h.journal.read()).toBeNull();
  });

  it('forwards reaside=false so the enforcement loop makes zero extra driver calls', async () => {
    const h = harness({ enforcement: { intervalMs: 1_000 } });
    await handlers(h).enterFocus(enterMessage({ reaside: false }));
    expect(h.controller.getState().state).toBe('FOCUSING');
    expect(h.driver.getCallLog().filter((call) => call.method === 'asideWindows')).toHaveLength(1);
  });

  it('maps an unexpected driver failure to a generic INVALID without leaking internals', async () => {
    const failing: FocusControlTarget = {
      enterFocus: async () => {
        throw new Error('koffi EnumWindows exploded at 0xdeadbeef');
      },
      exitFocus: async () => null,
      getState: () => ({ state: 'PAIRED', protected: [], allowList: [] }),
      listRunningApps: async () => [],
    };
    const messages = await new FocusLinkHandlers({ controller: failing }).enterFocus(
      enterMessage(),
    );
    const rejection = focusRejectedMessageSchema.parse(messages[0]);
    expect(rejection.code).toBe('INVALID');
    expect(rejection.message).not.toMatch(/koffi|0xdeadbeef/);
  });
});

describe('FocusLinkHandlers.exitFocus', () => {
  it('restores and returns no duplicate frame; a repeated exit answers the honest state', async () => {
    const h = harness();
    await handlers(h).enterFocus(enterMessage());

    expect(await handlers(h).exitFocus(exitMessage())).toEqual([]);
    expect(h.controller.getState().state).toBe('PAIRED');
    expect(h.driver.asidedHandles()).toEqual([]);
    expect(h.journal.read()).toBeNull();

    const repeated = await handlers(h).exitFocus(exitMessage());
    expect(stateMessageSchema.parse(repeated[0]).state).toBe('PAIRED');
  });

  it('ignores a stale session id instead of ending the running session', async () => {
    const h = harness();
    await handlers(h).enterFocus(enterMessage());
    const messages = await handlers(h).exitFocus(exitMessage({ sessionId: crypto.randomUUID() }));

    expect(stateMessageSchema.parse(messages[0]).state).toBe('FOCUSING');
    expect(h.controller.getState().state).toBe('FOCUSING');
    expect(h.driver.isAsided('w-slack')).toBe(true);
  });

  it('answers with the still-FOCUSING state when the restore fails (tray retry stays available)', async () => {
    class BrokenRestore extends FakeDriver {
      override async restore(): Promise<readonly WindowRef[]> {
        throw new Error('no window server');
      }
    }
    const h = harness({ driver: new BrokenRestore() });
    await handlers(h).enterFocus(enterMessage());

    const messages = await handlers(h).exitFocus(exitMessage());
    expect(stateMessageSchema.parse(messages[0]).state).toBe('FOCUSING');
    expect(h.journal.read()?.sessionId).toBe(SESSION_ID);
  });
});

describe('FocusLinkHandlers.listApps (REC-007)', () => {
  it('returns key + label + running only, never window titles (INV-6)', async () => {
    const h = harness();
    const messages = await handlers(h).listApps();
    const apps = appsMessageSchema.parse(messages[0]).apps;

    const keys = apps.map((app) => app.key);
    expect(keys).toContain('slack');
    expect(keys).toContain('vscode');
    expect(keys).toContain('chrome');
    expect(apps.find((app) => app.key === 'slack')).toEqual({
      key: 'slack',
      label: 'Slack',
      running: true,
    });
    for (const app of apps) {
      expect(Object.keys(app).sort()).toEqual(['key', 'label', 'running']);
      expect(JSON.stringify(app)).not.toMatch(/title|url/i);
    }
  });

  it('maps a listing failure to a generic rejection', async () => {
    const failing: FocusControlTarget = {
      enterFocus: async () => ({ state: 'PAIRED', protected: [], allowList: [] }),
      exitFocus: async () => null,
      getState: () => ({ state: 'PAIRED', protected: [], allowList: [] }),
      listRunningApps: async () => {
        throw new Error('EnumWindows failed');
      },
    };
    const messages = await new FocusLinkHandlers({ controller: failing }).listApps();
    expect(focusRejectedMessageSchema.parse(messages[0]).code).toBe('INVALID');
  });
});

describe('FocusLinkHandlers.getState', () => {
  it('reports agent truth (INV-5) with the active session', async () => {
    const h = harness();
    expect(stateMessageSchema.parse(handlers(h).getState()).state).toBe('PAIRED');
    await h.controller.enterFocus(request({ durationMin: 25 }));
    const state = stateMessageSchema.parse(handlers(h).getState());
    expect(state.state).toBe('FOCUSING');
    expect(state.session?.sessionId).toBe(SESSION_ID);
    expect(state.session?.endsAt).toBe(new Date(START.getTime() + 25 * 60_000).toISOString());
  });
});
