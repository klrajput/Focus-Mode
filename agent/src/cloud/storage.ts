// cloud/storage.ts — durable device-token storage through Electron `safeStorage` (T-042, SEC-6).
// The 256-bit device token is encrypted with the OS keychain and written 0600 under
// `app.getPath('userData')`, so a stolen disk cannot impersonate the device. When the OS reports
// secure storage as unavailable (e.g. Linux without a keyring) the token is kept ONLY in memory:
// plaintext never touches the disk and the user must pair again after a restart (§7.6).
// Electron 45 deprecates the synchronous safeStorage calls (and they report "unavailable" on some
// macOS setups), so this module uses the supported asynchronous API — same keychain guarantee.

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { objectIdSchema } from '@focus-mode/shared';
import { z } from 'zod';
import { noopLogger, type Logger } from '../log.js';

/** Persisted pairing record: the cloud device id, its bearer token and the paired owner. */
export const deviceCredentialsSchema = z.strictObject({
  deviceId: objectIdSchema,
  deviceToken: z.string().min(32).max(512),
  userId: objectIdSchema,
});
export type DeviceCredentials = z.infer<typeof deviceCredentialsSchema>;

/** The subset of Electron's asynchronous `safeStorage` API this module needs (mockable). */
export interface SafeStorageLike {
  isEncryptionAvailable(): Promise<boolean>;
  encryptString(plainText: string): Promise<Buffer>;
  decryptString(encrypted: Buffer): Promise<string>;
}

/** Async store so main can await a durable write before reporting PAIRED. */
export interface CredentialStore {
  load(): Promise<DeviceCredentials | null>;
  save(credentials: DeviceCredentials): Promise<void>;
  clear(): Promise<void>;
}

export interface CredentialStoreOptions {
  /** `app.getPath('userData')` — never a hard-coded path (NFR-004). */
  readonly directory: string;
  readonly safeStorage: SafeStorageLike;
  readonly logger?: Logger;
  /** Overridden only by tests. */
  readonly fileName?: string;
}

export const CREDENTIALS_FILE = 'device-credentials.bin';
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

class SafeStorageCredentialStore implements CredentialStore {
  readonly #directory: string;
  readonly #safeStorage: SafeStorageLike;
  readonly #logger: Logger;
  readonly #filePath: string;

  /** Set only when the OS keychain is unavailable; cleared on `clear()`. */
  #memory: DeviceCredentials | undefined;
  #warnedAboutMemoryOnly = false;

  constructor(options: CredentialStoreOptions) {
    this.#directory = options.directory;
    this.#safeStorage = options.safeStorage;
    this.#logger = options.logger ?? noopLogger;
    this.#filePath = path.join(options.directory, options.fileName ?? CREDENTIALS_FILE);
  }

  async load(): Promise<DeviceCredentials | null> {
    // A memory copy exists only when writing was impossible (or as the last save's mirror);
    // it is the safest answer and keeps a keyring failure from looking like an unpaired agent.
    if (this.#memory !== undefined) return this.#memory;

    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.#filePath);
    } catch (error) {
      if (!isMissingFile(error)) {
        this.#logger.warn('Could not read the stored device token', errorMessage(error));
      }
      // No stored pairing: do not touch the OS keychain yet, so an unpaired start can show its
      // pairing code immediately (the keychain is initialised lazily on the first save).
      return null;
    }

    if (!(await this.#encryptionAvailable())) {
      this.#warnMemoryOnly();
      return null;
    }

    try {
      const decrypted = await this.#safeStorage.decryptString(encrypted);
      const parsed = deviceCredentialsSchema.safeParse(JSON.parse(decrypted) as unknown);
      if (!parsed.success) {
        this.#logger.warn('The stored device token is not in the expected format');
        return null;
      }
      return parsed.data;
    } catch (error) {
      // A keychain change (or a profile copy from another machine) makes the blob unreadable;
      // pairing again is the honest recovery and never a silent plaintext fallback.
      this.#logger.warn(
        'The stored device token could not be decrypted; pairing again is required',
        errorMessage(error),
      );
      return null;
    }
  }

  async save(credentials: DeviceCredentials): Promise<void> {
    const parsed = deviceCredentialsSchema.parse(credentials);

    if (!(await this.#encryptionAvailable())) {
      this.#memory = parsed;
      this.#warnMemoryOnly();
      return;
    }

    let encrypted: Buffer;
    try {
      encrypted = await this.#safeStorage.encryptString(JSON.stringify(parsed));
    } catch (error) {
      // Encryption failed at write time: keep the token in memory rather than on disk in clear.
      this.#logger.warn(
        'safeStorage could not encrypt the device token; keeping it in memory only',
        errorMessage(error),
      );
      this.#memory = parsed;
      this.#warnMemoryOnly();
      return;
    }

    // Write to a sibling temp file and rename, so a crash mid-write cannot leave a torn token.
    const tempPath = `${this.#filePath}.${process.pid}.tmp`;
    await mkdir(this.#directory, { recursive: true, mode: DIRECTORY_MODE });
    await writeFile(tempPath, encrypted, { mode: FILE_MODE });
    await rename(tempPath, this.#filePath);
    // `rename` keeps the temp file's 0600 mode; chmod is defensive for pre-existing files.
    await chmod(this.#filePath, FILE_MODE);
    this.#memory = parsed;
  }

  async clear(): Promise<void> {
    this.#memory = undefined;
    try {
      await rm(this.#filePath, { force: true });
    } catch (error) {
      this.#logger.warn('Could not delete the stored device token', errorMessage(error));
    }
  }

  async #encryptionAvailable(): Promise<boolean> {
    try {
      return await this.#safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  #warnMemoryOnly(): void {
    if (this.#warnedAboutMemoryOnly) return;
    this.#warnedAboutMemoryOnly = true;
    this.#logger.warn(
      'OS secure storage (safeStorage) is unavailable, so the device token is kept in memory ' +
        'only; this Focus Agent will have to pair again after a restart. No plaintext token is ' +
        'written to disk.',
    );
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

/** Production factory; `main.ts` passes Electron's real `safeStorage` and userData directory. */
export function createCredentialStore(options: CredentialStoreOptions): CredentialStore {
  return new SafeStorageCredentialStore(options);
}
