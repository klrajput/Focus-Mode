// server/src/config/env.ts — the single validated source of runtime configuration (T-010/W2).
// Why: NFR-004/SEC-2 put every secret and URL in the environment, and a missing or weak secret must
// stop the process at boot instead of failing on the first request. Every other module imports
// `env` from here — never `process.env` — so validation runs exactly once, with one error message.
// Invariants: JWT_SECRET >= 32 chars (SEC-2), CLIENT_URL is a comma-separated origin allow-list that
// feeds CORS (SEC-3), JWT_EXPIRES_IN is a duration string (`30m`, SEC-2), PAIR_PEPPER >= 32 chars
// (SEC-5, DEC-014) and the ATTEST_* Ed25519 PEM keypair (SEC-7, DEC-013) are REQUIRED in production.
// Test mode (NODE_ENV=test) generates an ephemeral Ed25519 keypair + 256-bit pairing pepper once per
// process, so the suite needs no committed keys or key files; that branch never runs in production.

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// `server/.env` is resolved relative to this file, so `tsx src/...` and `node dist/...` behave the
// same regardless of the shell's cwd. dotenv never overrides already-exported variables
// (CI secrets, hosting dashboards, vitest `test.env`), and a missing file is a silent no-op.
loadDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

/** jsonwebtoken duration strings, e.g. `30m`, `1h`, `7d`. */
const DURATION_PATTERN = /^[1-9]\d*(s|m|h|d)$/;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    MONGO_URI: z
      .string()
      .trim()
      .min(1, 'MONGO_URI is required (copy server/.env.example to server/.env)'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters (SEC-2)'),
    JWT_EXPIRES_IN: z
      .string()
      .regex(DURATION_PATTERN, 'JWT_EXPIRES_IN must be a duration such as 30m')
      .default('30m'),
    /** Comma-separated dashboard origins; CORS reflects only these (SEC-3). */
    CLIENT_URL: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      )
      .pipe(z.array(z.url('CLIENT_URL must be a comma-separated list of absolute origins')).min(1)),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Failed auth requests allowed per IP per 15 min (SEC-4 default 10). */
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).max(1000).default(10),
    /**
     * Express `trust proxy` hop count (W6 SEC-4): 0 = direct connection, 1 = exactly one
     * reverse proxy (Render/Railway) whose X-Forwarded-For is trusted. Never `true`: an
     * unrestricted trust would let any client spoof its IP and bypass per-IP rate limits.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    /** General `/api/v1` requests allowed per IP per minute (W6 SEC-4 defence in depth). */
    RATE_LIMIT_API_MAX: z.coerce.number().int().min(1).max(100_000).default(600),
    /** Per-user per-minute limits for the expensive / user-mutating W5 endpoints (SEC-4). */
    RATE_LIMIT_INSIGHTS_MAX: z.coerce.number().int().min(1).max(10_000).default(60),
    RATE_LIMIT_NOTIFICATIONS_MAX: z.coerce.number().int().min(1).max(10_000).default(120),
    RATE_LIMIT_USERS_MAX: z.coerce.number().int().min(1).max(10_000).default(60),
    RATE_LIMIT_SESSIONS_MAX: z.coerce.number().int().min(1).max(10_000).default(120),
    RATE_LIMIT_ADMIN_MAX: z.coerce.number().int().min(1).max(10_000).default(120),
    /** Per-IP limit for public/unauthenticated endpoints (agent links, attest key, …). */
    RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().min(1).max(10_000).default(60),
    /** SEC-5 pairing pepper: HMAC-SHA256 key for the pairing digest (DEC-014). */
    PAIR_PEPPER: z
      .string()
      .min(32, 'PAIR_PEPPER must be at least 32 characters (SEC-5)')
      .optional(),
    /** SEC-7 attestation keypair: PEM, single-line `\n` escapes are restored below (DEC-013). */
    ATTEST_PRIVATE_KEY: z.string().min(1).optional(),
    ATTEST_PUBLIC_KEY: z.string().min(1).optional(),
    /** Demo seed identities (DEC-013) — public exam values, not secrets; A6's seed script reads them. */
    SEED_ADMIN_EMAIL: z.email().default('admin@demo.com'),
    SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin@123'),
    SEED_USER_EMAIL: z.email().default('kabir@demo.com'),
    SEED_USER_PASSWORD: z.string().min(8).default('Kabir@123'),
  })
  .superRefine((value, ctx) => {
    // Production must never boot with a dev placeholder or without the pairing/attestation keys.
    if (value.NODE_ENV !== 'production') return;
    const requiredSecrets = [
      ['PAIR_PEPPER', value.PAIR_PEPPER, 'SEC-5 (DEC-014 pairing digest)'],
      ['ATTEST_PRIVATE_KEY', value.ATTEST_PRIVATE_KEY, 'SEC-7 (REC-003 attestation signing)'],
      ['ATTEST_PUBLIC_KEY', value.ATTEST_PUBLIC_KEY, 'SEC-7 (GET /agent/attest-key)'],
    ] as const;
    for (const [name, present, reason] of requiredSecrets) {
      if (present === undefined || present.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} is required in production — ${reason}`,
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // Fail fast, before any socket or database connection exists.
  throw new Error(
    `Invalid environment configuration:\n${problems}\n\n` +
      'Fix: copy server/.env.example to server/.env and replace the CHANGE_ME_* values. ' +
      'Tests and CI export these variables directly (server/vitest.config.ts).',
  );
}

const config = parsed.data;
const isTest = config.NODE_ENV === 'test';

/** Env values store PEM on one line with literal `\n`; restore the real newlines (DEC-013). */
function normalizePem(value: string | undefined): string | undefined {
  return value?.replace(/\\n/g, '\n');
}

interface EphemeralTestSecrets {
  pairPepper: string;
  attestPrivateKey: string;
  attestPublicKey: string;
}

/**
 * Test-only secrets, generated once per test process: an Ed25519 keypair and a 256-bit pepper.
 * This is why the server suite needs no committed keys and no vitest env entries for crypto
 * (DEC-013 allows test mode to generate the keypair; the algorithm stays EdDSA). Never logged.
 */
function generateEphemeralTestSecrets(): EphemeralTestSecrets {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    pairPepper: randomBytes(32).toString('base64url'),
    attestPrivateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    attestPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

const ephemeralTestSecrets = isTest ? generateEphemeralTestSecrets() : null;

/** Validated, immutable runtime configuration. Import this — never read `process.env` directly. */
export const env = Object.freeze({
  NODE_ENV: config.NODE_ENV,
  PORT: config.PORT,
  MONGO_URI: config.MONGO_URI,
  JWT_SECRET: config.JWT_SECRET,
  JWT_EXPIRES_IN: config.JWT_EXPIRES_IN,
  /** Parsed CORS allow-list; the raw value of the CLIENT_URL env var. */
  CLIENT_URLS: config.CLIENT_URL as readonly string[],
  LOG_LEVEL: config.LOG_LEVEL,
  RATE_LIMIT_AUTH_MAX: config.RATE_LIMIT_AUTH_MAX,
  /** Express trust-proxy hop count for real client IPs behind a reverse proxy (W6). */
  TRUST_PROXY: config.TRUST_PROXY,
  RATE_LIMIT_API_MAX: config.RATE_LIMIT_API_MAX,
  RATE_LIMIT_INSIGHTS_MAX: config.RATE_LIMIT_INSIGHTS_MAX,
  RATE_LIMIT_NOTIFICATIONS_MAX: config.RATE_LIMIT_NOTIFICATIONS_MAX,
  RATE_LIMIT_USERS_MAX: config.RATE_LIMIT_USERS_MAX,
  RATE_LIMIT_SESSIONS_MAX: config.RATE_LIMIT_SESSIONS_MAX,
  RATE_LIMIT_ADMIN_MAX: config.RATE_LIMIT_ADMIN_MAX,
  RATE_LIMIT_PUBLIC_MAX: config.RATE_LIMIT_PUBLIC_MAX,
  /** SEC-5 pepper; undefined in dev when unconfigured (pairing then answers 500 INTERNAL). */
  PAIR_PEPPER: config.PAIR_PEPPER ?? ephemeralTestSecrets?.pairPepper,
  /** SEC-7 PEM keypair; undefined in dev when unconfigured (attestation then answers 500). */
  ATTEST_PRIVATE_KEY:
    normalizePem(config.ATTEST_PRIVATE_KEY) ?? ephemeralTestSecrets?.attestPrivateKey,
  ATTEST_PUBLIC_KEY:
    normalizePem(config.ATTEST_PUBLIC_KEY) ?? ephemeralTestSecrets?.attestPublicKey,
  SEED_ADMIN_EMAIL: config.SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD: config.SEED_ADMIN_PASSWORD,
  SEED_USER_EMAIL: config.SEED_USER_EMAIL,
  SEED_USER_PASSWORD: config.SEED_USER_PASSWORD,
  isDevelopment: config.NODE_ENV === 'development',
  isTest,
  isProduction: config.NODE_ENV === 'production',
});

export type Env = typeof env;
