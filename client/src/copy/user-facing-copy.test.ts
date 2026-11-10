/*
 * Copy-regression test for F-01 / C-01 (HIGH) and F-04 (UX_SPEC §12.2/§12.4).
 *
 * A3's W2 review found 14 internal milestone/task strings rendered to users on 8 routes. This test
 * is the guard that they cannot come back: it loads every non-test source file through Vite's raw
 * glob, strips comments (where task ids are legitimate documentation), and asserts that no JSX
 * copy, string literal or attribute value still contains development jargon. It also asserts the
 * approved replacement copy is present, and that the exact labels A8's Playwright suite depends on
 * are unchanged.
 */

import { describe, expect, it } from 'vitest';

const RAW_SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const CODE = Object.entries(RAW_SOURCES)
  .filter(([path]) => !path.includes('.test.') && !path.startsWith('/src/test/'))
  .map(([path, text]) => ({ path: path.replace('/src/', 'src/'), text: stripComments(text) }))
  .filter((file) => file.text.trim() !== '');

/** Comments keep task ids on purpose; only what a user can see is scanned. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n')
    .replace(/\s+/g, ' ');
}

function filesMatching(pattern: RegExp): string[] {
  return CODE.filter((file) => pattern.test(file.text)).map((file) => file.path);
}

/** The reviewed strings A3 verified in the W1/W2 build (UX_SPEC §12.2, "Current rendered string"). */
const REMOVED_JARGON = [
  'Starting a session needs the live Focus Agent link',
  'it lands in W2 (T-045)',
  'The download links and the pairing dialog land in W2',
  'Editing, manual app add and presets land with T-034',
  'Read-only in W1',
  'Creating schedules lands with T-035',
  'Creating, editing and enabling schedules land with T-035',
  'The live countdown ring and End Focus land with T-031',
  'The Recharts daily-focus chart lands with T-033',
  'Editing lands with T-036',
  'Profile editing, password change and unpair-all land with T-036',
  'Search and filters land with T-073',
  'Deactivate/activate, presets, download links and aggregate stats land with T-073',
  'W1 placeholder: the complete landing page',
  'Until an admin publishes them, no fake installer is offered here',
] as const;

/**
 * Approved replacement copy that must exist.
 * W4 note: the two W2 placeholders "Editing and adding apps" / "Creating and editing schedules"
 * were replaced by the real editor copy below (the features now exist, so a "not available yet"
 * sentence would be a lie).
 */
const APPROVED_REPLACEMENTS = [
  'Connect the Focus Agent to start a session. The Focus Agent moves windows aside',
  'Your apps — these stay open',
  'Protected — always stays open',
  "This app is protected and must stay open during focus. It can't be removed.",
  'No schedules yet. Add one for your next deep-work block.',
  'Times shown in',
  'Focused today',
  'Next scheduled session',
  'No focus sessions yet. Your first session will show up here.',
  'This table is the accessible view of your daily focus minutes.',
  "Profile editing isn't available yet.",
  'Email is managed by your account; changing it needs an admin.',
  'User management actions, presets, download links and aggregate stats',
  'An admin publishes the macOS, Windows and Linux installers.',
  'A scheduled session starts only while your Focus Agent is connected, and only after a 10-second heads-up you can cancel.',
] as const;

describe('user-facing copy (F-01 / C-01 regression)', () => {
  it('scans the real client sources', () => {
    expect(CODE.length).toBeGreaterThan(35);
    expect(CODE.some((file) => file.path === 'src/pages/dashboard.tsx')).toBe(true);
  });

  it('contains no milestone or task jargon outside comments', () => {
    expect(filesMatching(/\bW[0-9]\b/)).toEqual([]);
    expect(filesMatching(/\bT-0\d{2}\b/)).toEqual([]);
    expect(filesMatching(/\b(FR|NFR|DEC|KI)-\d{2,3}\b/)).toEqual([]);
    expect(filesMatching(/\bread-only in W/i)).toEqual([]);
  });

  it('no longer contains any of the reviewed jargon strings', () => {
    for (const jargon of REMOVED_JARGON) {
      const normalised = jargon.replace(/\s+/g, ' ');
      expect(
        CODE.filter((file) => file.text.includes(normalised)).map((file) => file.path),
        `still rendered: ${jargon}`,
      ).toEqual([]);
    }
  });

  it('keeps the approved replacement copy', () => {
    for (const copy of APPROVED_REPLACEMENTS) {
      expect(
        CODE.some((file) => file.text.includes(copy)),
        `missing approved copy: ${copy}`,
      ).toBe(true);
    }
  });

  it('keeps the exact labels the E2E suite asserts on', () => {
    const all = CODE.map((file) => file.text).join(' ');

    expect(all).toContain('Agent connected');
    expect(all).toContain('Device unpaired');
    expect(all).toContain('No device connected — start your Focus Agent');
    expect(all).toContain('Focus Agent status: ');
    expect(all).toContain('Focus started');
    expect(all).toContain('Focus ended — your windows are back.');
  });
});
