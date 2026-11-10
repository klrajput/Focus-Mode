// server/src/test/validation.test.ts — T-014 acceptance: the shared zod schemas are the validator
// (NFR-001) and NoSQL-operator/prototype keys never reach a handler (NFR-003, SEC-9).
// Why: these cases are the security-facing half of the API contract, and they are all decided before
// any database access — so this suite runs without Mongo and stays fast/deterministic.
// Invariants asserted: every failure is 400 VALIDATION_ERROR with `details[] = [{path,message}]`;
// `{"email":{"$ne":null}}` is rejected; unknown fields are rejected (strict objects).

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

const app = buildApp();

function detailsOf(body: unknown): { path: string; message: string }[] {
  const candidate = body as { error?: { details?: unknown } };
  expect(Array.isArray(candidate.error?.details)).toBe(true);
  return candidate.error?.details as { path: string; message: string }[];
}

describe('NoSQL operator injection (NFR-003, SEC-9)', () => {
  it('rejects {"email":{"$ne":null}} on login with 400 VALIDATION_ERROR', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password: 'anything' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Request contains forbidden keys');
    expect(detailsOf(response.body)).toEqual([
      { path: 'email.$ne', message: expect.stringContaining('not allowed') },
    ]);
  });

  it('rejects operator keys nested in arrays and dotted keys ($where, a.b)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: { $gt: '' },
        email: 'kabir.new@demo.com',
        password: 'Kabir@123',
        'profile.role': 'ADMIN',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const paths = detailsOf(response.body).map((detail) => detail.path);
    expect(paths).toContain('name.$gt');
    expect(paths).toContain('profile.role');
  });

  it('rejects an operator key smuggled through the query string', async () => {
    const response = await request(app).get('/api/v1/auth/me?%24where=1');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(detailsOf(response.body)).toEqual([
      { path: 'query.$where', message: expect.stringContaining('not allowed') },
    ]);
  });
});

describe('zod body validation via shared schemas (NFR-001)', () => {
  it('rejects unknown fields (strict object) with a per-field detail path', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Kabir', email: 'kabir.new@demo.com', password: 'Kabir@123', role: 'ADMIN' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Request validation failed');
    expect(detailsOf(response.body)).toEqual([
      { path: 'role', message: 'Unknown field "role" is not allowed' },
    ]);
  });

  it('returns the shared password rule message for a weak password', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Kabir', email: 'kabir.new@demo.com', password: 'short' });

    expect(response.status).toBe(400);
    const details = detailsOf(response.body);
    expect(details).toContainEqual({
      path: 'password',
      message: 'Password must be at least 8 characters',
    });
  });

  it('reports every missing required field (details[] shape is [{path,message}])', async () => {
    const response = await request(app).post('/api/v1/auth/register').send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' },
    });
    const details = detailsOf(response.body);
    expect(details.length).toBeGreaterThanOrEqual(3);
    for (const detail of details) {
      expect(Object.keys(detail).sort()).toEqual(['message', 'path']);
      expect(typeof detail.path).toBe('string');
      expect(typeof detail.message).toBe('string');
    }
    expect(details.map((detail) => detail.path)).toEqual(
      expect.arrayContaining(['name', 'email', 'password']),
    );
  });

  it('rejects a wrong-typed body (object for a string field) with 400', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 42, password: 'Kabir@123' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
