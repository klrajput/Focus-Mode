// server/src/config/logger.ts — the process-wide pino logger (TECHNICAL_DESIGN §11, NFR-016).
// Why: one structured JSON logger with a fixed redaction list means a password or bearer token
// cannot reach stdout even if a handler logs a raw request or user object. pino-http reuses this
// logger, so request/response logs inherit the same redaction paths.
// Invariants: no `console.log` anywhere in the server (AGENTS §4); levels come from LOG_LEVEL;
// tokens/passwords/cookies are replaced with `[REDACTED]` before serialisation.

import pino, { type Logger } from 'pino';
import { env } from './env.js';

/**
 * Field paths pino must censor. Covers the credential-bearing shapes this API can log: HTTP
 * headers, validated request bodies, and token/password fields of the auth result envelope
 * (both top level and one level of nesting, which is how handlers usually log them).
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  // HTTP headers (pino-http serialises req/res headers).
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  // Validated bodies, if a handler ever logs `req.body` (defence in depth).
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.token',
  'req.body.deviceToken',
  'req.body.enrollSecret',
  'req.body.attestation',
  'req.body.code',
  // Secrets in application log objects: top level and one level of nesting.
  'password',
  '*.password',
  'currentPassword',
  '*.currentPassword',
  'newPassword',
  '*.newPassword',
  'passwordHash',
  '*.passwordHash',
  'accessToken',
  '*.accessToken',
  'deviceToken',
  '*.deviceToken',
  'enrollSecret',
  '*.enrollSecret',
  'attestation',
  '*.attestation',
  'token',
  '*.token',
];

const LOGGER_NAME = 'focus-mode-api';

/** Build a redacted logger; `destination` is injectable so tests can assert the redaction. */
export function createLogger(
  level: string = env.LOG_LEVEL,
  destination?: pino.DestinationStream,
): Logger {
  const options: pino.LoggerOptions = {
    name: LOGGER_NAME,
    level,
    redact: { paths: [...LOG_REDACT_PATHS], censor: '[REDACTED]' },
  };
  return destination ? pino(options, destination) : pino(options);
}

/** Shared application logger (also used by pino-http for request logging). */
export const logger: Logger = createLogger();
