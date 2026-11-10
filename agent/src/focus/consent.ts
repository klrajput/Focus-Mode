// focus/consent.ts — native first-run permission for moving windows aside (T-051, REC-004).
// The dashboard's consent modal (FR-009) is shown before *every* start and can be answered by a
// web page, so it is not enough: the very first focus on this device also needs a decision made
// inside the Focus Agent process. The decision is stored locally, versioned, revocable, and a
// denial is never stored as consent (UX_SPEC §5.1). This module is Electron-free: the native
// dialog is injected as `NativeConsentPrompt`, which keeps the gate unit-testable and makes the
// "a page can never answer it" property structural (the gate only ever calls the prompt).

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
import { isoDateTimeSchema, type AppEntry } from '@focus-mode/shared';
import { z } from 'zod';
import { noopLogger, type Logger } from '../log.js';

/** Version of the native consent text/behaviour. Bump to re-ask every user (UX_SPEC §5.1). */
export const NATIVE_CONSENT_VERSION = 'native-consent-v1';
/** File under `app.getPath('userData')` — local only, never uploaded (REC-004, NFR-013). */
export const NATIVE_CONSENT_FILE_NAME = 'native-consent.json';

/**
 * Exact copy from UX_SPEC §5.1. Kept here (not inline in main.ts) so the text is asserted by a
 * test and cannot drift from the spec while the dialog implementation changes.
 */
export const NATIVE_CONSENT_COPY = Object.freeze({
  title: 'Let Focus Mode move other apps aside?',
  body:
    'Focus Mode will minimise or hide your other open apps while a focus session runs. ' +
    'They are not closed and nothing is deleted. Your web browsers, the Focus Agent, system ' +
    'essentials and your allow-listed apps stay open and usable.\n\n' +
    'You can end focus at any time from the dashboard, from the tray menu, or by quitting the ' +
    'Focus Agent.',
  detail:
    'This choice is stored on this computer only. You can revoke it in the tray menu → ' +
    'Focus Mode settings → Reset focus permission.',
  allowButton: 'Allow and continue',
  declineButton: 'Not now',
} as const);

/** Stored local decision. `version` mismatches force a fresh prompt after a copy change. */
export const consentRecordSchema = z.strictObject({
  version: z.string().trim().min(1).max(32),
  acceptedAt: isoDateTimeSchema,
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;

/** What the native dialog needs to explain before the first focus (copy placeholders). */
export interface NativeConsentRequest {
  readonly durationMin: number;
  readonly allowList: readonly AppEntry[];
  readonly protectedApps: readonly AppEntry[];
  /** REC-005 per-session "keep distractions aside" toggle, default ON. */
  readonly reaside: boolean;
}

/** Implemented in `main.ts` with Electron's native dialog; never reachable from the web page. */
export type NativeConsentPrompt = (request: NativeConsentRequest) => Promise<boolean>;

export type ConsentOutcome =
  | { readonly granted: true; readonly record: ConsentRecord; readonly prompted: boolean }
  | { readonly granted: false; readonly prompted: true };

/** Persistence contract; injection lets tests observe writes and simulate failures. */
export interface ConsentStore {
  readonly filePath: string;
  /** Returns the stored record, or null when missing/corrupt (corruption never blocks boot). */
  read(): ConsentRecord | null;
  write(record: ConsentRecord): void;
  clear(): void;
}

export interface FileConsentStoreOptions {
  /** `app.getPath('userData')` or `AGENT_USER_DATA_DIR` in tests. */
  readonly directory: string;
  readonly fileName?: string;
  readonly logger?: Logger;
}

const CONSENT_FILE_MODE = 0o600;

/** Atomic local JSON store: temp file + fsync + rename, so a crash cannot grant/revoke half-way. */
export class FileConsentStore implements ConsentStore {
  readonly filePath: string;
  readonly #directory: string;
  readonly #logger: Logger;

  constructor(options: FileConsentStoreOptions) {
    this.#directory = path.resolve(options.directory);
    this.filePath = path.join(this.#directory, options.fileName ?? NATIVE_CONSENT_FILE_NAME);
    this.#logger = options.logger ?? noopLogger;
  }

  write(record: ConsentRecord): void {
    const validated = consentRecordSchema.parse(record);
    mkdirSync(this.#directory, { recursive: true });
    const tempPath = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    let fd: number | undefined;
    try {
      fd = openSync(tempPath, 'w', CONSENT_FILE_MODE);
      writeFileSync(fd, JSON.stringify(validated, null, 2), 'utf8');
      fsyncSync(fd);
    } catch (error) {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          // The write error is the one that matters.
        }
      }
      rmSync(tempPath, { force: true });
      throw error;
    }
    if (fd !== undefined) closeSync(fd);
    renameSync(tempPath, this.filePath);
  }

  /** A corrupt consent file means "not granted": the user is asked again, never auto-allowed. */
  read(): ConsentRecord | null {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (!isNotFound(error)) {
        this.#logger.warn('Native consent file is unreadable; asking again', this.filePath);
      }
      return null;
    }
    try {
      const parsed = consentRecordSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      // fall through to the warning below
    }
    this.#logger.warn('Native consent file is invalid; asking again', this.filePath);
    return null;
  }

  clear(): void {
    rmSync(this.filePath, { force: true });
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (!('code' in error)) return false;
  return error.code === 'ENOENT';
}

export interface ConsentGateOptions {
  readonly store: ConsentStore;
  /** Native dialog owned by the Focus Agent main process (REC-004). */
  readonly prompt: NativeConsentPrompt;
  readonly version?: string;
  readonly now?: () => Date;
  readonly logger?: Logger;
}

/**
 * First-ever-focus gate. A stored decision for the current version skips the dialog; every
 * other path calls the injected native prompt exactly once. A prompt failure is treated as a
 * denial (fail closed) so a broken dialog can never silently grant OS control.
 */
export class ConsentGate {
  readonly #store: ConsentStore;
  readonly #prompt: NativeConsentPrompt;
  readonly #version: string;
  readonly #now: () => Date;
  readonly #logger: Logger;

  constructor(options: ConsentGateOptions) {
    this.#store = options.store;
    this.#prompt = options.prompt;
    this.#version = options.version ?? NATIVE_CONSENT_VERSION;
    this.#now = options.now ?? (() => new Date());
    this.#logger = options.logger ?? noopLogger;
  }

  get version(): string {
    return this.#version;
  }

  /** True only for a stored grant of the current consent version. */
  isGranted(): boolean {
    const stored = this.#store.read();
    return stored !== null && stored.version === this.#version;
  }

  currentRecord(): ConsentRecord | null {
    return this.isGranted() ? this.#store.read() : null;
  }

  /** Asked before the *first* focus on this device; later sessions reuse the stored decision. */
  async ensure(request: NativeConsentRequest): Promise<ConsentOutcome> {
    const stored = this.#store.read();
    if (stored !== null && stored.version === this.#version) {
      return { granted: true, record: stored, prompted: false };
    }

    let accepted = false;
    try {
      accepted = await this.#prompt(request);
    } catch (error) {
      this.#logger.error(
        'The native first-run consent dialog failed; treating it as declined',
        error instanceof Error ? error.message : 'unknown error',
      );
      accepted = false;
    }

    if (!accepted) {
      this.#logger.info('Native first-run consent declined; no focus will be applied');
      return { granted: false, prompted: true };
    }

    const record: ConsentRecord = {
      version: this.#version,
      acceptedAt: this.#now().toISOString(),
    };
    try {
      this.#store.write(record);
    } catch (error) {
      // The dialog answer is authoritative for this session; failing to persist only means the
      // user is asked again next time (never a silent permanent grant).
      this.#logger.error(
        'Native consent was granted but could not be stored; it will be asked again next start',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
    return { granted: true, record, prompted: true };
  }

  /** Tray / agent-window "Reset focus permission" (UX_SPEC §5.1). Never grants anything. */
  revoke(): void {
    try {
      this.#store.clear();
      this.#logger.info('Native first-run consent revoked; it will be asked on the next start');
    } catch (error) {
      this.#logger.error(
        'Could not clear the stored native consent',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
}
