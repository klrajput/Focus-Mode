// focus/journal.test.ts — atomic journal, schema-validated reads, corruption quarantine (T-032).
// INV-4 depends on this file being durable before any window moves, and INV-5 depends on a
// corrupt/missing journal never crashing startup: corrupt files are quarantined, not thrown.
// INV-6 is enforced by the strict schema: no title/url fields can be stored.

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { journalEntrySchema, FileJournal, type JournalEntry } from './journal.js';

const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';
const STARTED_AT = '2026-11-10T10:00:00.000Z';
const ENDS_AT = '2026-11-10T11:00:00.000Z';

const tempDirs: string[] = [];

function makeJournal(now: Date = new Date('2026-11-10T12:00:00.000Z')): {
  journal: FileJournal;
  directory: string;
} {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-journal-'));
  tempDirs.push(directory);
  return {
    journal: new FileJournal({ directory, now: () => now }),
    directory,
  };
}

function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    version: 1,
    kind: 'FOCUS_SESSION',
    sessionId: SESSION_ID,
    startedAt: STARTED_AT,
    endsAt: ENDS_AT,
    plannedMinutes: 60,
    source: 'MANUAL',
    intent: 'FOCUSING',
    protected: [{ key: 'chrome', label: 'Google Chrome', mac: ['com.google.Chrome'] }],
    allowList: [{ key: 'vscode', label: 'Visual Studio Code', mac: ['com.microsoft.VSCode'] }],
    candidates: [{ handle: 'w-slack', appKey: 'slack', identifier: 'com.tinyspeck.slackmacgap' }],
    changed: [{ handle: 'w-slack', appKey: 'slack', identifier: 'com.tinyspeck.slackmacgap' }],
    ...overrides,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe('FileJournal', () => {
  it('returns null when no journal exists (fresh install)', () => {
    const { journal } = makeJournal();
    expect(journal.read()).toBeNull();
  });

  it('writes a validated entry atomically and reads it back', () => {
    const { journal, directory } = makeJournal();
    const entry = makeEntry();
    journal.write(entry);

    expect(journal.read()).toEqual(entry);
    expect(readdirSync(directory)).toEqual([path.basename(journal.filePath)]);
    expect(JSON.parse(readFileSync(journal.filePath, 'utf8'))).toMatchObject({
      sessionId: SESSION_ID,
      intent: 'FOCUSING',
    });
  });

  it('replaces the journal on a second write without leaving temp files', () => {
    const { journal, directory } = makeJournal();
    journal.write(makeEntry());
    const updated = makeEntry({ changed: [], candidates: [] });
    journal.write(updated);

    expect(journal.read()).toEqual(updated);
    expect(readdirSync(directory)).toHaveLength(1);
  });

  it('never stores window titles or URLs (INV-6)', () => {
    const { journal, directory } = makeJournal();
    journal.write(makeEntry());
    const raw = readFileSync(journal.filePath, 'utf8');
    expect(raw).not.toMatch(/"title"|"url"|"windowTitle"|"address"/);
    expect(readdirSync(directory)).toHaveLength(1);
  });

  it('rejects extra fields such as a title (strict schema)', () => {
    const { journal } = makeJournal();
    const withTitle = { ...makeEntry(), title: 'Secret document — Invoice.pdf' };
    expect(() => journal.write(withTitle as unknown as JournalEntry)).toThrow();
    expect(journal.read()).toBeNull();
  });

  it('quarantines corrupt JSON and returns null instead of throwing', () => {
    const { journal, directory } = makeJournal();
    writeFileSync(journal.filePath, '{not json', 'utf8');

    expect(() => journal.read()).not.toThrow();
    expect(journal.read()).toBeNull();
    const files = readdirSync(directory);
    expect(files.some((file) => file.includes('.corrupt-'))).toBe(true);
    expect(files.some((file) => file === path.basename(journal.filePath))).toBe(false);
  });

  it('quarantines schema-invalid JSON and returns null', () => {
    const { journal, directory } = makeJournal();
    writeFileSync(journal.filePath, JSON.stringify({ version: 2, sessionId: SESSION_ID }), 'utf8');

    expect(journal.read()).toBeNull();
    expect(readdirSync(directory).some((file) => file.includes('.corrupt-'))).toBe(true);
  });

  it('clears the journal', () => {
    const { journal, directory } = makeJournal();
    journal.write(makeEntry());
    journal.clear();
    expect(journal.read()).toBeNull();
    expect(readdirSync(directory)).toHaveLength(0);
  });

  it('creates a missing directory on write', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'focus-journal-parent-'));
    tempDirs.push(parent);
    const journal = new FileJournal({ directory: path.join(parent, 'nested', 'userData') });
    journal.write(makeEntry());
    expect(journal.read()?.sessionId).toBe(SESSION_ID);
  });

  it('exposes a schema whose keys are exactly the safe restore fields', () => {
    expect(Object.keys(journalEntrySchema.shape)).toEqual([
      'version',
      'kind',
      'sessionId',
      'startedAt',
      'endsAt',
      'plannedMinutes',
      'source',
      'intent',
      'protected',
      'allowList',
      'candidates',
      'changed',
    ]);
  });
});
