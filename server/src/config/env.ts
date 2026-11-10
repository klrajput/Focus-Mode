// server/src/config/env.ts — the single validated source of runtime configuration (T-010).
// Why: NFR-004/SEC-2 put every secret and URL in the environment, and a missing or weak secret must
// stop the process at boot instead of failing on the first request. Every other module imports
// `env` from here — never `process.env` — so validation runs exactly once, with one error message.
// Invariants: JWT_SECRET >= 32 chars (SEC-2), CLIENT_URL is a comma-separated origin allow-list that
// feeds CORS (SEC-3), JWT_EXPIRES_IN is a jsonwebtoken duration string (`30m`, SEC-2).
// NODE_ENV=test is supported: `server/vitest.config.ts` supplies these values and the test helper
// connects to a temporary mongodb-memory-server instead of MONGO_URI.

import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// `server/.env` is resolved relative to this file, so `tsx src/...` and `node dist/...` behave the
// same regardless of the shell's cwd. dotenv never overrides already-exported variables
// (CI secrets, hosting dashboards, vitest `test.env`), and a missing file is a silent no-op.
loadDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

/** jsonwebtoken duration strings, e.g. `30m`, `1h`, `7d`. */
const DURATION_PATTERN = /^[1-9]\d*(s|m|h|d)$/;

const envSchema = z.object({
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
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Failed auth requests allowed per IP per 15 min (SEC-4 default 10). */
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).max(1000).default(10),
  /** SEC-5 pairing pepper; required by T-040 (/agent/register), optional until that route exists. */
  PAIR_PEPPER: z.string().min(32, 'PAIR_PEPPER must be at least 32 characters (SEC-5)').optional(),
  /** SEC-7 attestation keypair; required by T-043 (/devices/:id/attest), optional until then. */
  ATTEST_PRIVATE_KEY: z.string().min(1).optional(),
  ATTEST_PUBLIC_KEY: z.string().min(1).optional(),
  /** Demo seed identities (DEC-013) — public exam values, not secrets; A6's seed script reads them. */
  SEED_ADMIN_EMAIL: z.email().default('admin@demo.com'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin@123'),
  SEED_USER_EMAIL: z.email().default('kabir@demo.com'),
  SEED_USER_PASSWORD: z.string().min(8).default('Kabir@123'),
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
  PAIR_PEPPER: config.PAIR_PEPPER,
  ATTEST_PRIVATE_KEY: config.ATTEST_PRIVATE_KEY,
  ATTEST_PUBLIC_KEY: config.ATTEST_PUBLIC_KEY,
  SEED_ADMIN_EMAIL: config.SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD: config.SEED_ADMIN_PASSWORD,
  SEED_USER_EMAIL: config.SEED_USER_EMAIL,
  SEED_USER_PASSWORD: config.SEED_USER_PASSWORD,
  isDevelopment: config.NODE_ENV === 'development',
  isTest: config.NODE_ENV === 'test',
  isProduction: config.NODE_ENV === 'production',
});

export type Env = typeof env;
