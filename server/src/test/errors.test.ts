// server/src/test/errors.test.ts — T-010 acceptance for the central error middleware (NFR-002) and
// log redaction (NFR-016). Why: NFR-002 requires a forced 500 to return a generic INTERNAL message
// with no stack trace, and every failure class (AppError, zod, duplicate key, body parser) must map
// to the frozen envelope. The probes below mount the real `notFound` + `errorHandler` on a tiny
// Express app so each mapping is isolated and the production app stays free of test routes.

import { Writable } from 'node:stream';
import express, { type Express, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../config/logger.js';
import { errorHandler } from '../middlewares/error.js';
import { notFound } from '../middlewares/not-found.js';
import { AppError } from '../utils/AppError.js';

function errorProbe(handler: (req: Request, res: Response) => void): Express {
  const app = express();
  app.use(express.json());
  app.get('/probe', handler);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

describe('errorHandler mappings (NFR-002)', () => {
  it('hides an unexpected error behind a generic 500 INTERNAL with no stack', async () => {
    const app = errorProbe(() => {
      throw new Error('internal detail: db password hunter2');
    });

    const response = await request(app).get('/probe');
    const rawBody = JSON.stringify(response.body);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'INTERNAL', message: 'An unexpected error occurred.' },
    });
    expect(rawBody).not.toContain('stack');
    expect(rawBody).not.toContain('hunter2');
    expect(response.body.error.details).toBeUndefined();
  });

  it('maps an AppError to its frozen code + HTTP status', async () => {
    const app = errorProbe(() => {
      throw new AppError('CONFLICT', 'An account with this email already exists.');
    });

    const response = await request(app).get('/probe');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'CONFLICT', message: 'An account with this email already exists.' },
    });
  });

  it('derives AppError status from the frozen ERROR_HTTP_STATUS map', () => {
    expect(new AppError('ACCOUNT_DISABLED', 'disabled').status).toBe(403);
    expect(new AppError('RATE_LIMITED', 'slow down').status).toBe(429);
    expect(new AppError('PAIRING_EXPIRED', 'expired').status).toBe(410);
  });

  it('maps a thrown ZodError to 400 VALIDATION_ERROR with details[]', async () => {
    const schema = z.object({ email: z.string().min(5, 'Email is too short') });
    const app = errorProbe(() => {
      schema.parse({ email: 'a' });
    });

    const response = await request(app).get('/probe');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual([{ path: 'email', message: 'Email is too short' }]);
  });

  it('maps a MongoDB duplicate-key (11000) error to 409 CONFLICT', async () => {
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyValue: { email: 'kabir@demo.com' },
    });
    const app = errorProbe(() => {
      throw duplicateKeyError;
    });

    const response = await request(app).get('/probe');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(response.body.error.message).toContain('email');
  });

  it('wraps an unmatched route in the 404 envelope via notFound', async () => {
    const app = errorProbe((_req, res) => {
      res.status(200).json({ success: true, data: {} });
    });

    const response = await request(app).get('/nope');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
  });
});

describe('logger redaction (NFR-016)', () => {
  it('censors authorization headers, passwords and tokens before they reach the log stream', () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const testLogger = createLogger('info', stream);

    testLogger.info(
      {
        req: { headers: { authorization: 'Bearer super-secret-token', cookie: 'sid=abc' } },
        body: { password: 'hunter2', newPassword: 'hunter3' },
        passwordHash: '$2b$12$secret-hash',
        accessToken: 'secret-access-token',
      },
      'redaction probe',
    );

    const output = chunks.join('');
    expect(output).toContain('redaction probe');
    expect(output).toContain('[REDACTED]');
    for (const secret of [
      'super-secret-token',
      'sid=abc',
      'hunter2',
      'hunter3',
      'secret-hash',
      'secret-access-token',
    ]) {
      expect(output).not.toContain(secret);
    }
  });
});
