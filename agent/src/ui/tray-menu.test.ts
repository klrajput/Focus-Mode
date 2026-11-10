// ui/tray-menu.test.ts — tray ordering, labels, enabled/checked states and icon choice (FR-022,
// REC-008, T-059). The Electron adapter in tray.ts is NEEDS-HUMAN; this file pins everything that
// can be asserted without a display, especially the invariants: End focus is always listed but
// enabled only while FOCUSING, the pairing code never appears in a menu label (DEC-003), and
// Start at login is a checkbox that defaults to OFF with an explanation.

import { describe, expect, it } from 'vitest';
import {
  buildTrayMenu,
  TRAY_STATE_LABELS,
  type TrayMenuEntry,
  type TrayMenuInput,
} from './tray-menu.js';

const NOW = new Date('2026-11-10T10:17:50.000Z');

function makeInput(overrides: Partial<TrayMenuInput> = {}): TrayMenuInput {
  return {
    state: 'IDLE',
    paired: false,
    pairingCode: '482916',
    sessionEndsAt: null,
    startAtLogin: false,
    now: NOW,
    ...overrides,
  };
}

function findAction(
  entries: readonly TrayMenuEntry[],
  action: 'end-focus' | 'show-window' | 'show-pairing-code' | 'quit',
) {
  const entry = entries.find(
    (candidate): candidate is Extract<TrayMenuEntry, { kind: 'action' }> =>
      candidate.kind === 'action' && candidate.action === action,
  );
  if (entry === undefined) throw new Error(`missing action ${action}`);
  return entry;
}

function labels(entries: readonly TrayMenuEntry[]): string[] {
  return entries.flatMap((entry) => (entry.kind === 'separator' ? [] : [entry.label]));
}

describe('tray menu — unpaired/IDLE', () => {
  const model = buildTrayMenu(makeInput());

  it('always leads with icon + text and a matching tooltip', () => {
    expect(model.title).toBe('Focus Mode — Not paired');
    expect(model.tooltip).toBe('Focus Mode — Not paired');
    expect(model.icon).toBe('idle');
    expect(labels(model.entries)[0]).toBe('Focus Mode — Not paired');
    expect(TRAY_STATE_LABELS.IDLE).toBe('Not paired');
  });

  it('lists End focus disabled and Quit enabled (escape hatch always present, INV-5)', () => {
    expect(findAction(model.entries, 'end-focus').enabled).toBe(false);
    expect(findAction(model.entries, 'quit').enabled).toBe(true);
    expect(findAction(model.entries, 'show-window').enabled).toBe(true);
  });

  it('offers "Show pairing code" without putting the code in a menu label (DEC-003)', () => {
    expect(findAction(model.entries, 'show-pairing-code').enabled).toBe(true);
    expect(labels(model.entries).some((label) => label.includes('482916'))).toBe(false);
  });

  it('disables "Show pairing code" while no real code exists', () => {
    const waiting = buildTrayMenu(makeInput({ pairingCode: null }));
    expect(findAction(waiting.entries, 'show-pairing-code').enabled).toBe(false);
    expect(labels(waiting.entries)).toContain('Pairing code: waiting for Focus Mode…');
  });

  it('shows the start-at-login checkbox OFF by default with its explanation (REC-008)', () => {
    const checkbox = model.entries.find((entry) => entry.kind === 'checkbox');
    expect(checkbox).toEqual({
      kind: 'checkbox',
      action: 'start-at-login',
      label: 'Start at login',
      checked: false,
    });
    expect(labels(model.entries)).toContain('Off by default — Focus Mode never starts itself.');
  });

  it('mirrors an explicit OS login-item choice without changing the default', () => {
    const checkbox = buildTrayMenu(makeInput({ startAtLogin: true })).entries.find(
      (entry) => entry.kind === 'checkbox',
    );
    expect(checkbox?.kind === 'checkbox' && checkbox.checked).toBe(true);
  });

  it('reports consent as not reported until main wires the consent module (REC-004)', () => {
    expect(labels(model.entries)).toContain('Focus permission: not reported by this build');
  });

  it('never hides Quit last', () => {
    expect(labels(model.entries).at(-1)).toBe('Quit Focus Agent (restores windows first)');
  });
});

describe('tray menu — FOCUSING', () => {
  const focusing = buildTrayMenu(
    makeInput({ state: 'FOCUSING', paired: true, sessionEndsAt: '2026-11-10T11:00:00.000Z' }),
  );

  it('switches the icon and shows the live countdown line', () => {
    expect(focusing.icon).toBe('focusing');
    expect(focusing.title).toBe('Focus Mode — Focusing');
    expect(labels(focusing.entries)).toContain('● Focus session running — 42:10 left');
  });

  it('enables End focus only while FOCUSING', () => {
    expect(findAction(focusing.entries, 'end-focus').enabled).toBe(true);
    expect(
      findAction(buildTrayMenu(makeInput({ state: 'PAIRED', paired: true })).entries, 'end-focus')
        .enabled,
    ).toBe(false);
  });

  it('marks a scheduled session and reports an expired timer honestly', () => {
    const scheduled = buildTrayMenu(
      makeInput({
        state: 'FOCUSING',
        paired: true,
        sessionSource: 'SCHEDULE',
        sessionEndsAt: '2026-11-10T11:00:00.000Z',
      }),
    );
    expect(labels(scheduled.entries).some((label) => label.includes('(scheduled)'))).toBe(true);

    const over = buildTrayMenu(
      makeInput({ state: 'FOCUSING', paired: true, sessionEndsAt: '2026-11-10T10:00:00.000Z' }),
    );
    expect(labels(over.entries)).toContain('● Focus session ending — restoring windows');
  });

  it('never claims a countdown when no end time was reported', () => {
    const noEnd = buildTrayMenu(makeInput({ state: 'FOCUSING', paired: true }));
    expect(labels(noEnd.entries)).toContain('● Focus session running');
  });
});

describe('tray menu — link health icon', () => {
  it('uses the grey slash when the cloud link is down or not configured', () => {
    expect(buildTrayMenu(makeInput({ cloud: 'disconnected' })).icon).toBe('disconnected');
    expect(buildTrayMenu(makeInput({ cloud: 'not-configured' })).icon).toBe('disconnected');
  });

  it('uses the outline when connected and the filled diamond while focusing', () => {
    expect(buildTrayMenu(makeInput({ paired: true, cloud: 'connected' })).icon).toBe('idle');
    expect(
      buildTrayMenu(
        makeInput({ state: 'FOCUSING', paired: true, cloud: 'disconnected', sessionEndsAt: null }),
      ).icon,
    ).toBe('focusing');
  });
});

describe('tray menu — consent status and revoke (REC-004)', () => {
  it('shows a stored grant with its date and an enabled reset', () => {
    const model = buildTrayMenu(
      makeInput({
        consent: { status: 'granted', grantedAt: '2026-11-02T12:00:00.000Z', revocable: true },
      }),
    );
    expect(labels(model.entries)).toContain('Focus permission: granted on 2 Nov 2026');
    const reset = model.entries.find(
      (entry) => entry.kind === 'action' && entry.action === 'reset-consent',
    );
    expect(reset?.kind === 'action' && reset.enabled).toBe(true);
  });

  it('omits reset when the grant is not revocable', () => {
    const model = buildTrayMenu(
      makeInput({
        consent: { status: 'granted', grantedAt: '2026-11-02T12:00:00.000Z', revocable: false },
      }),
    );
    expect(
      model.entries.some((entry) => entry.kind === 'action' && entry.action === 'reset-consent'),
    ).toBe(false);
  });

  it('shows a denial without a reset item', () => {
    const model = buildTrayMenu(
      makeInput({ consent: { status: 'not-granted', grantedAt: null, revocable: false } }),
    );
    expect(labels(model.entries)).toContain('Focus permission: not granted yet');
    expect(
      model.entries.some((entry) => entry.kind === 'action' && entry.action === 'reset-consent'),
    ).toBe(false);
  });
});

describe('tray menu — stability', () => {
  it('is deterministic for the same state and clock', () => {
    expect(buildTrayMenu(makeInput())).toEqual(buildTrayMenu(makeInput()));
  });

  it('contains no separators at the very start or end', () => {
    const entries = buildTrayMenu(makeInput()).entries;
    expect(entries[0]?.kind).not.toBe('separator');
    expect(entries.at(-1)?.kind).not.toBe('separator');
  });
});
