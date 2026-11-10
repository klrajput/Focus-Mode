// shared/src/schemas/auth-user.test.ts — signup/login and profile/password payloads (FR-001, FR-029).
// Password composition, email normalisation and "at least one field" update rules are asserted
// with valid AND invalid fixtures (NFR-001); strictness proves unknown fields never reach Mongo.

import { describe, expect, it } from 'vitest';
import { emailSchema, loginSchema, passwordSchema, registerSchema } from './auth.js';
import { changePasswordSchema, profilePatchSchema } from './user.js';

describe('passwordSchema (REQUIREMENTS §7, SEC-1)', () => {
  it('accepts 8–72 char passwords with a letter and a digit', () => {
    for (const password of ['abcd1234', 'Password1', 'K4bir!focus']) {
      expect(passwordSchema.safeParse(password).success).toBe(true);
    }
    expect(passwordSchema.safeParse('a'.repeat(71) + '1').success).toBe(true); // 72
  });

  it('rejects too short, too long, all-letter and all-digit passwords', () => {
    for (const password of ['Pass1', 'password', '12345678', '', 'a'.repeat(72) + '1']) {
      expect(passwordSchema.safeParse(password).success).toBe(false);
    }
    expect(passwordSchema.safeParse(12345678).success).toBe(false);
  });
});

describe('emailSchema', () => {
  it('trims and lower-cases valid emails', () => {
    expect(emailSchema.parse('  Kabir@DEMO.com ')).toBe('kabir@demo.com');
    expect(emailSchema.safeParse('kabir@demo.com').success).toBe(true);
  });

  it('rejects malformed emails', () => {
    for (const email of ['not-an-email', 'a@', '@demo.com', '', 'a b@demo.com']) {
      expect(emailSchema.safeParse(email).success).toBe(false);
    }
  });
});

describe('registerSchema', () => {
  it('accepts a valid signup and normalises name + email', () => {
    const result = registerSchema.safeParse({
      name: '  Kabir  ',
      email: ' Kabir@Demo.COM ',
      password: 'Password1',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      name: 'Kabir',
      email: 'kabir@demo.com',
      password: 'Password1',
    });
  });

  it('rejects weak passwords, bad emails and short names', () => {
    const valid = { name: 'Kabir', email: 'kabir@demo.com', password: 'Password1' };
    expect(registerSchema.safeParse({ ...valid, password: 'password' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: '12345678' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, name: 'K' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, name: 'x'.repeat(61) }).success).toBe(false);
  });

  it('rejects unknown fields such as role/isActive (NFR-013)', () => {
    const valid = { name: 'Kabir', email: 'kabir@demo.com', password: 'Password1' };
    expect(registerSchema.safeParse({ ...valid, role: 'ADMIN' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, isActive: false }).success).toBe(false);
    expect(registerSchema.safeParse({ name: 'Kabir', email: 'kabir@demo.com' }).success).toBe(
      false,
    );
  });
});

describe('loginSchema', () => {
  it('accepts any existing credential shape (no composition rules on login)', () => {
    expect(loginSchema.safeParse({ email: 'kabir@demo.com', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'admin@demo.com', password: 'Admin@123' }).success).toBe(
      true,
    );
  });

  it('rejects empty passwords, bad emails and unknown fields', () => {
    expect(loginSchema.safeParse({ email: 'kabir@demo.com', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    expect(
      loginSchema.safeParse({ email: 'kabir@demo.com', password: 'x', role: 'ADMIN' }).success,
    ).toBe(false);
  });
});

describe('profilePatchSchema', () => {
  it('accepts any non-empty subset of profile fields', () => {
    expect(profilePatchSchema.safeParse({ name: 'Kabir' }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ timezone: 'Asia/Kolkata' }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ defaultDurationMin: 50 }).success).toBe(true);
    expect(
      profilePatchSchema.safeParse({
        name: 'Kabir',
        timezone: 'Europe/London',
        defaultDurationMin: 25,
      }).success,
    ).toBe(true);
  });

  it('rejects an empty patch, invalid timezone/bounds and unknown fields', () => {
    expect(profilePatchSchema.safeParse({}).success).toBe(false);
    expect(profilePatchSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ timezone: '+05:30' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ defaultDurationMin: 0 }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ defaultDurationMin: 481 }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ role: 'ADMIN' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ email: 'new@demo.com' }).success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('accepts a valid change', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'OldPass1',
        newPassword: 'NewPass12',
      }).success,
    ).toBe(true);
  });

  it('rejects reuse, weak new passwords, missing fields and unknown fields', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'SamePass1',
        newPassword: 'SamePass1',
      }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'OldPass1', newPassword: 'weak' }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: '', newPassword: 'NewPass12' }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({ newPassword: 'NewPass12', role: 'ADMIN' }).success,
    ).toBe(false);
  });
});
