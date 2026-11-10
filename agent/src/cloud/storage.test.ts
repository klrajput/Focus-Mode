// cloud/storage.test.ts — device-token storage through a mocked Electron `safeStorage` (T-042,
// SEC-6/§7.6). Asserts the encrypted, 0600, atomic write path, the encrypted round-trip across a
// "restart", and the memory-only fallback: when the OS keychain is unavailable the token is never
// written to disk in plaintext and the next start must re-pair.

import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCredentialStore, CREDENTIALS_FILE, type SafeStorageLike } from './storage.js';

const DEVICE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const DEVICE_TOKEN = 'f3b2'.repeat(16);
const CREDENTIALS = { deviceId: DEVICE_ID, deviceToken: DEVICE_TOKEN, userId: USER_ID };

class FakeSafeStorage implements SafeStorageLike {
  available = true;
  encryptThrows = false;
  readonly encryptedPlaintexts: string[] = [];

  async isEncryptionAvailable(): Promise<boolean> {
    return this.available;
  }

  async encryptString(plainText: string): Promise<Buffer> {
    if (this.encryptThrows) throw new Error('keyring locked');
    this.encryptedPlaintexts.push(plainText);
    // Not real crypto: a prefix makes the stored bytes trivially distinguishable from plaintext.
    return Buffer.from(`safe:${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8');
  }

  async decryptString(encrypted: Buffer): Promise<string> {
    const raw = encrypted.toString('utf8');
    if (!raw.startsWith('safe:')) throw new Error('not a safeStorage blob');
    return Buffer.from(raw.slice('safe:'.length), 'base64').toString('utf8');
  }
}

type LogFn = (message: string, ...meta: readonly unknown[]) => void;

let directory = '';

function makeLogger(): {
  error: ReturnType<typeof vi.fn<LogFn>>;
  warn: ReturnType<typeof vi.fn<LogFn>>;
  info: ReturnType<typeof vi.fn<LogFn>>;
  debug: ReturnType<typeof vi.fn<LogFn>>;
} {
  return {
    error: vi.fn<LogFn>(),
    warn: vi.fn<LogFn>(),
    info: vi.fn<LogFn>(),
    debug: vi.fn<LogFn>(),
  };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'focus-agent-credentials-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('save/load through safeStorage', () => {
  it('encrypts the token, writes it 0600 and round-trips across a restart', async () => {
    const safeStorage = new FakeSafeStorage();
    const logger = makeLogger();
    const store = createCredentialStore({ directory, safeStorage, logger });

    await store.save(CREDENTIALS);

    const filePath = path.join(directory, CREDENTIALS_FILE);
    const mode = (await stat(filePath)).mode & 0o777;
    expect(mode).toBe(0o600);

    const storedBytes = await readFile(filePath);
    const storedText = storedBytes.toString('utf8');
    // SEC-6: neither the token nor the rest of the record may be readable on disk.
    expect(storedText).not.toContain(DEVICE_TOKEN);
    expect(storedText).not.toContain(DEVICE_ID);
    expect(safeStorage.encryptedPlaintexts).toHaveLength(1);
    expect(safeStorage.encryptedPlaintexts[0]).toContain(DEVICE_TOKEN);

    // A new store instance is what a restart creates.
    const afterRestart = createCredentialStore({ directory, safeStorage, logger });
    await expect(afterRestart.load()).resolves.toEqual(CREDENTIALS);
  });

  it('clear() deletes the file and load() then returns null', async () => {
    const safeStorage = new FakeSafeStorage();
    const store = createCredentialStore({ directory, safeStorage, logger: makeLogger() });
    await store.save(CREDENTIALS);
    await store.clear();

    await expect(store.load()).resolves.toBeNull();
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('treats a corrupt or undecryptable file as "pair again", never as plaintext', async () => {
    const safeStorage = new FakeSafeStorage();
    const logger = makeLogger();
    await writeFile(path.join(directory, CREDENTIALS_FILE), 'not-a-safe-storage-blob');

    const store = createCredentialStore({ directory, safeStorage, logger });
    await expect(store.load()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/could not be decrypted/i),
      expect.any(String),
    );
  });

  it('rejects a decrypted blob that does not match the credentials schema', async () => {
    const safeStorage = new FakeSafeStorage();
    const logger = makeLogger();
    await writeFile(
      path.join(directory, CREDENTIALS_FILE),
      await safeStorage.encryptString(JSON.stringify({ deviceId: 'nope' })),
    );

    const store = createCredentialStore({ directory, safeStorage, logger });
    await expect(store.load()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/not in the expected format/i));
  });
});

describe('memory-only fallback when safeStorage is unavailable (§7.6)', () => {
  it('never writes a plaintext token and requires re-pairing after a restart', async () => {
    const safeStorage = new FakeSafeStorage();
    safeStorage.available = false;
    const logger = makeLogger();
    const store = createCredentialStore({ directory, safeStorage, logger });

    await store.save(CREDENTIALS);

    // Nothing was written at all.
    await expect(readdir(directory)).resolves.toEqual([]);
    // This run can keep working from memory…
    await expect(store.load()).resolves.toEqual(CREDENTIALS);
    // …but the next start cannot: re-pairing is the honest recovery.
    const afterRestart = createCredentialStore({ directory, safeStorage, logger });
    await expect(afterRestart.load()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/kept in memory only/));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/No plaintext token/));
  });

  it('falls back to memory when encryptString fails at save time', async () => {
    const safeStorage = new FakeSafeStorage();
    safeStorage.encryptThrows = true;
    const logger = makeLogger();
    const store = createCredentialStore({ directory, safeStorage, logger });

    await store.save(CREDENTIALS);

    await expect(readdir(directory)).resolves.toEqual([]);
    await expect(store.load()).resolves.toEqual(CREDENTIALS);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/could not encrypt/i),
      expect.any(String),
    );
  });

  it('warns only once about the memory-only mode', async () => {
    const safeStorage = new FakeSafeStorage();
    safeStorage.available = false;
    const logger = makeLogger();
    const store = createCredentialStore({ directory, safeStorage, logger });

    await store.save(CREDENTIALS);
    await store.load();
    await store.load();

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
