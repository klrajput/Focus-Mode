// server/src/config/env.test.ts — W7 (task-46) coverage for the boot-time configuration gate.
// Why: `config/env.ts` (69.56 % lines / 50 % branch) was only exercised by the suite's own valid
// environment, so the fail-fast paths were unproven: a production deploy missing PAIR_PEPPER or the
// attestation keypair, a weak JWT secret, a malformed CORS allow-list or an unparseable duration must
// stop the process *before* a socket exists (NFR-004/SEC-2/SEC-5/SEC-7). Re-importing the module
// with a stubbed `process.env` is the only way to observe those branches without spawning a process.
// Invariants asserted: test mode synthesises an ephemeral Ed25519 keypair + 256-bit pepper (so the
// suite needs no committed keys), development leaves them undefined, production demands them, PEM
// values stored on one line with literal `\n` are restored, and every failure message names the
// offending variable and the fix.

import { describe, expect, it, vi, afterEach } from 'vitest';

/** Baseline that satisfies the schema; individual tests override only the keys they care about. */
const BASE_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '5000',
  MONGO_URI: 'mongodb://127.0.0.1:27017/focus-mode-test',
  JWT_SECRET: 'CHANGE_ME_test_only_jwt_secret_padding_0000',
  JWT_EXPIRES_IN: '30m',
  CLIENT_URL: 'http://localhost:5173',
  LOG_LEVEL: 'silent',
};

/** Every key this file stubs, so each case starts from the same baseline and is fully restored. */
const MANAGED_KEYS = [
  ...Object.keys(BASE_ENV),
  'PAIR_PEPPER',
  'ATTEST_PRIVATE_KEY',
  'ATTEST_PUBLIC_KEY',
  'TRUST_PROXY',
  'RATE_LIMIT_AGENT_REGISTER_MAX',
  'RATE_LIMIT_AUTH_MAX',
  'RATE_LIMIT_API_MAX',
] as const;

/** A real Ed25519 PKCS#8 PEM (single line with literal `\n`, exactly as a hosting dashboard stores). */
async function singleLineKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString()
      .replace(/\n/g, '\\n'),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString().replace(/\n/g, '\\n'),
  };
}

type EnvModule = typeof import('./env.js');

/** Re-evaluate `config/env.ts` against a fresh stub of `process.env` (validation runs on import). */
async function loadEnv(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Promise<{ ok: true; module: EnvModule } | { ok: false; message: string; error: unknown }> {
  vi.resetModules();
  for (const key of MANAGED_KEYS) vi.stubEnv(key, undefined as unknown as string);
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    vi.stubEnv(key, value as string);
  }
  try {
    return { ok: true, module: await import('./env.js') };
  } catch (error) {
    return { ok: false, message: (error as Error).message, error };
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('valid configuration', () => {
  it('parses defaults and flags for the test profile', async () => {
    const loaded = await loadEnv();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const { env } = loaded.module;

    expect(env.NODE_ENV).toBe('test');
    expect(env.isTest).toBe(true);
    expect(env.isDevelopment).toBe(false);
    expect(env.isProduction).toBe(false);
    expect(env.PORT).toBe(5000);
    expect(env.TRUST_PROXY).toBe(0);
    expect(env.CLIENT_URLS).toEqual(['http://localhost:5173']);
    // Rate-limit defaults are part of the frozen SEC-4 contract.
    expect(env.RATE_LIMIT_AGENT_REGISTER_MAX).toBe(5);
    expect(env.RATE_LIMIT_AUTH_MAX).toBe(10);
    expect(env.RATE_LIMIT_API_MAX).toBe(600);
  });

  it('synthesises an ephemeral Ed25519 keypair and a 256-bit pepper in test mode', async () => {
    const loaded = await loadEnv();
    if (!loaded.ok) throw new Error(`unexpected configuration failure: ${loaded.message}`);
    const { env } = loaded.module;

    expect(env.ATTEST_PRIVATE_KEY).toContain('-----BEGIN PRIVATE KEY-----');
    expect(env.ATTEST_PUBLIC_KEY).toContain('-----BEGIN PUBLIC KEY-----');
    expect(env.ATTEST_PRIVATE_KEY).not.toContain('\\n');
    expect(env.PAIR_PEPPER).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Generated per process: two imports in a fresh module registry must not share a keypair.
    const second = await loadEnv();
    if (!second.ok) throw new Error('unexpected configuration failure');
    expect(second.module.env.ATTEST_PRIVATE_KEY).not.toBe(env.ATTEST_PRIVATE_KEY);
  });

  it('splits, trims and filters the CLIENT_URL allow-list (SEC-3)', async () => {
    const loaded = await loadEnv({
      CLIENT_URL: ' http://localhost:5173 , ,http://localhost:5174, ',
    });
    if (!loaded.ok) throw new Error(`unexpected configuration failure: ${loaded.message}`);

    expect(loaded.module.env.CLIENT_URLS).toEqual([
      'http://localhost:5173',
      'http://localhost:5174',
    ]);
  });

  it('restores literal \\n escapes in a single-line PEM (DEC-013)', async () => {
    const keyPair = await singleLineKeyPair();
    const loaded = await loadEnv({
      NODE_ENV: 'production',
      PAIR_PEPPER: 'a'.repeat(32),
      ATTEST_PRIVATE_KEY: keyPair.privateKey,
      ATTEST_PUBLIC_KEY: keyPair.publicKey,
    });
    if (!loaded.ok) throw new Error(`unexpected configuration failure: ${loaded.message}`);
    const { env } = loaded.module;

    expect(env.ATTEST_PRIVATE_KEY).toContain('\n');
    expect(env.ATTEST_PRIVATE_KEY?.trim()).toMatch(/-----END PRIVATE KEY-----$/);
    expect(env.isProduction).toBe(true);
  });

  it('coerces numeric env strings and keeps development secrets optional', async () => {
    const loaded = await loadEnv({ NODE_ENV: 'development', PORT: '8080', TRUST_PROXY: '1' });
    if (!loaded.ok) throw new Error(`unexpected configuration failure: ${loaded.message}`);
    const { env } = loaded.module;

    expect(env.PORT).toBe(8080);
    expect(env.TRUST_PROXY).toBe(1);
    expect(env.isDevelopment).toBe(true);
    // Documented dev behaviour: pairing/attestation answer 500 until the keys are configured.
    expect(env.PAIR_PEPPER).toBeUndefined();
    expect(env.ATTEST_PRIVATE_KEY).toBeUndefined();
    expect(env.ATTEST_PUBLIC_KEY).toBeUndefined();
  });
});

describe('fail-fast validation', () => {
  it('refuses to boot in production without the pairing pepper and attestation keypair', async () => {
    const loaded = await loadEnv({ NODE_ENV: 'production' });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;

    expect(loaded.message).toContain('Invalid environment configuration');
    expect(loaded.message).toContain('PAIR_PEPPER is required in production');
    expect(loaded.message).toContain('ATTEST_PRIVATE_KEY is required in production');
    expect(loaded.message).toContain('ATTEST_PUBLIC_KEY is required in production');
    // The message must tell the operator how to fix it, not just that it failed.
    expect(loaded.message).toContain('copy server/.env.example to server/.env');
  });

  it('accepts production once all three secrets are present', async () => {
    const keyPair = await singleLineKeyPair();
    const loaded = await loadEnv({
      NODE_ENV: 'production',
      PAIR_PEPPER: 'p'.repeat(48),
      ATTEST_PRIVATE_KEY: keyPair.privateKey,
      ATTEST_PUBLIC_KEY: keyPair.publicKey,
    });

    expect(loaded.ok).toBe(true);
  });

  it('rejects a short JWT_SECRET and names the variable (SEC-2)', async () => {
    const loaded = await loadEnv({ JWT_SECRET: 'too-short' });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;

    expect(loaded.message).toContain('JWT_SECRET must be at least 32 characters (SEC-2)');
  });

  it('rejects a short PAIR_PEPPER even in test mode (SEC-5)', async () => {
    const loaded = await loadEnv({ PAIR_PEPPER: 'short' });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;

    expect(loaded.message).toContain('PAIR_PEPPER must be at least 32 characters (SEC-5)');
  });

  it('rejects a JWT_EXPIRES_IN that is not a duration', async () => {
    const loaded = await loadEnv({ JWT_EXPIRES_IN: 'forever' });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;

    expect(loaded.message).toContain('JWT_EXPIRES_IN must be a duration such as 30m');
  });

  it('rejects a relative or empty CLIENT_URL allow-list', async () => {
    const relative = await loadEnv({ CLIENT_URL: '/relative/path,not a url at all' });
    expect(relative.ok).toBe(false);
    if (!relative.ok) {
      expect(relative.message).toContain('CLIENT_URL must be a comma-separated list');
    }

    const empty = await loadEnv({ CLIENT_URL: ', ,' });
    expect(empty.ok).toBe(false);
  });

  it('rejects a missing MONGO_URI and an out-of-range PORT', async () => {
    const noMongo = await loadEnv({ MONGO_URI: '   ' });
    expect(noMongo.ok).toBe(false);
    if (!noMongo.ok) expect(noMongo.message).toContain('MONGO_URI is required');

    for (const port of ['0', '65536', 'not-a-port']) {
      const badPort = await loadEnv({ PORT: port });
      expect(badPort.ok).toBe(false);
    }
  });

  it('rejects an unknown NODE_ENV and an unknown LOG_LEVEL', async () => {
    expect((await loadEnv({ NODE_ENV: 'staging' })).ok).toBe(false);
    expect((await loadEnv({ LOG_LEVEL: 'verbose' })).ok).toBe(false);
  });
});
