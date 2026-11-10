// shared/src/schemas/auth.ts — signup/login payloads (FR-001, NFR-001).
// Used by the dashboard forms and the server `validate()` middleware verbatim, so password
// rules can never diverge. Emails are trimmed and lower-cased here (one canonical form in DB).
// Strict objects: unknown fields are rejected, which also blocks operator injection (SEC-9).

import { z } from 'zod';

const emailShape = z.string().trim().toLowerCase().max(254);

/** RFC-valid, trimmed, lower-cased (REQUIREMENTS §7). */
export const emailSchema = emailShape.pipe(z.email('Expected a valid email address'));

/**
 * REQUIREMENTS §7 / SEC-1: 8–72 chars because bcrypt silently truncates beyond 72 bytes;
 * at least one letter and one digit.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one digit');

export const registerSchema = z.strictObject({
  name: z.string().trim().min(2).max(60),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.strictObject({
  // No composition rules on login: a legacy password must fail as 401, not as 400.
  email: emailSchema,
  password: z.string().min(1).max(72),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
