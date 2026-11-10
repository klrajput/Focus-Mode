// server/src/test/app.test.ts — T-010 acceptance: health shapes, 404 envelope, security headers,
// CORS allow-list and body-size/JSON error mapping, all through the real app on a real HTTP stack.
// Why: these are the contract-level invariants every other suite depends on (NFR-002/NFR-003/
// SEC-3); no database is needed, so this file proves the app boots without Mongo.
// Invariants asserted: success envelope `{success:true,data}`, error envelope with a frozen code,
// no HTML error pages, helmet headers present, foreign Origins get no CORS header.

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp, JSON_BODY_LIMIT } from '../app.js';

const app = buildApp();

describe('GET /health (TECHNICAL_DESIGN §11, contract §3.1 #1)', () => {
  it('returns the success envelope with status/db/uptimeSec', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { status: 'ok' } });
    expect(typeof response.body.data.uptimeSec).toBe('number');
    expect(['ok', 'disconnected', 'connecting', 'disconnecting', 'unknown']).toContain(
      response.body.data.db,
    );
  });

  it('is also served under the frozen /api/v1 base (same handler)', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { status: 'ok' } });
  });

  it('GET /health/db reports 503 INTERNAL when mongoose is not connected', async () => {
    const response = await request(app).get('/health/db');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'INTERNAL', message: 'Database is not connected.' },
    });
  });
});

describe('unknown routes (T-010 404 shape)', () => {
  it('returns the frozen error envelope, never Express HTML', async () => {
    const response = await request(app).get('/definitely-not-a-route');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
  });
});

describe('security headers and CORS (SEC-3)', () => {
  it('sets helmet security headers and hides x-powered-by', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });

  it('reflects an allowed Origin from CLIENT_URL', async () => {
    const response = await request(app).get('/health').set('Origin', 'http://localhost:5173');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('omits the CORS header for an origin outside CLIENT_URL', async () => {
    const response = await request(app).get('/health').set('Origin', 'https://evil.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('body parsing limits (TECHNICAL_DESIGN §8)', () => {
  it(`rejects a JSON body larger than ${JSON_BODY_LIMIT} as 400 VALIDATION_ERROR`, async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.com', password: 'x'.repeat(110 * 1024) });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toContain('too large');
  });

  it('rejects malformed JSON as 400 VALIDATION_ERROR (not a 500 HTML page)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body.' },
    });
  });
});
