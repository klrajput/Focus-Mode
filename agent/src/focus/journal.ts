// focus/journal.ts — crash-safe record of what focus changed (T-032, INV-4/INV-5).
// `enterFocus` writes this journal (temp file + fsync + rename) *before* the driver moves any
// window, so a crash/kill can always restore. A missing or corrupt file never throws on
// startup: it is quarantined next to the journal and treated as "nothing to restore", because
// a Focus Agent that refuses to boot would leave the user unable to undo anything.
// INV-6: the schema has no title/url field and rejects unknown keys.

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  appEntrySchema,
  appIdentifierSchema,
  appKeySchema,
  durationMinSchema,
  focusSourceSchema,
  isoDateTimeSchema,
  uuidSchema,
} from '@focus-mode/shared';
import { z } from 'zod';
import { noopLogger, type Logger } from '../log.js';

/** One window recorded for restore; identifiers only, never titles or URLs (INV-6). */
export const journalWindowRefSchema = z.strictObject({
  handle: z.string().min(1).max(200),
  appKey: appKeySchema,
  identifier: appIdentifierSchema.optional(),
});

export const journalEntrySchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('FOCUS_SESSION'),
  sessionId: uuidSchema,
  startedAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  plannedMinutes: durationMinSchema,
  source: focusSourceSchema,
  /** Written before the driver runs: the intent is what recovery trusts (INV-4). */
  intent: z.literal('FOCUSING'),
  protected: z.array(appEntrySchema).max(200),
  allowList: z.array(appEntrySchema).max(50),
  /** Candidates the agent intended to move aside. */
  candidates: z.array(journalWindowRefSchema).max(500),
  /** Windows the driver reported as actually changed; empty until `asideWindows` returns. */
  changed: z.array(journalWindowRefSchema).max(500),
});

export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type JournalWindowRef = z.infer<typeof journalWindowRefSchema>;

/** Storage contract injected into the controller, so tests can observe write ordering. */
export interface FocusJournal {
  readonly filePath: string;
  /** Returns the validated entry, or null when missing/corrupt (corrupt files are quarantined). */
  read(): JournalEntry | null;
  write(entry: JournalEntry): void;
  clear(): void;
}

export interface FileJournalOptions {
  /** `app.getPath('userData')` or the `AGENT_USER_DATA_DIR` test override. */
  readonly directory: string;
  readonly fileName?: string;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

const DEFAULT_FILE_NAME = 'focus-journal.json';
const FILE_MODE = 0o600;

/** Best-effort directory fsync so the rename itself is durable (ignored where unsupported). */
function fsyncDirectory(directory: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(directory, 'r');
    fsyncSync(fd);
  } catch {
    // Directory fsync is not available on every filesystem/OS; the file fsync above is the
    // durability guarantee we rely on.
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

export class FileJournal implements FocusJournal {
  readonly filePath: string;
  readonly #directory: string;
  readonly #logger: Logger;
  readonly #now: () => Date;

  constructor(options: FileJournalOptions) {
    this.#directory = path.resolve(options.directory);
    this.filePath = path.join(this.#directory, options.fileName ?? DEFAULT_FILE_NAME);
    this.#logger = options.logger ?? noopLogger;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Atomic write: write a uniquely named temp file in the same directory, fsync it, then
   * rename it over the journal. A kill at any point leaves either the old valid journal or the
   * new valid journal — never a half-written file (T-032 acceptance).
   */
  write(entry: JournalEntry): void {
    const validated = journalEntrySchema.parse(entry);
    mkdirSync(this.#directory, { recursive: true });
    const tempPath = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    let fd: number | undefined;
    try {
      fd = openSync(tempPath, 'w', FILE_MODE);
      writeFileSync(fd, JSON.stringify(validated, null, 2), 'utf8');
      fsyncSync(fd);
    } catch (error) {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          // ignore close failure, the write error is the one that matters
        }
      }
      rmSync(tempPath, { force: true });
      throw error;
    }
    if (fd !== undefined) closeSync(fd);
    renameSync(tempPath, this.filePath);
    fsyncDirectory(this.#directory);
  }

  /** Never throws for a missing/corrupt journal — startup recovery must always continue. */
  read(): JournalEntry | null {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return null;
      this.#logger.error('Focus journal unreadable; quarantining', this.filePath);
      this.#quarantine();
      return null;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      this.#logger.warn('Focus journal is not valid JSON; quarantining', this.filePath);
      this.#quarantine();
      return null;
    }

    const parsed = journalEntrySchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.#logger.warn('Focus journal failed schema validation; quarantining', this.filePath);
      this.#quarantine();
      return null;
    }
    return parsed.data;
  }

  clear(): void {
    rmSync(this.filePath, { force: true });
  }

  /** Moves a corrupt journal aside for diagnosis without ever deleting user data outright. */
  #quarantine(): void {
    const stamp = this.#now().toISOString().replace(/[:.]/g, '-');
    const quarantinePath = `${this.filePath}.corrupt-${stamp}`;
    try {
      renameSync(this.filePath, quarantinePath);
      this.#logger.warn('Quarantined corrupt focus journal', quarantinePath);
    } catch (error) {
      this.#logger.error('Could not quarantine corrupt focus journal', error);
    }
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (!('code' in error)) return false;
  return error.code === 'ENOENT';
}
