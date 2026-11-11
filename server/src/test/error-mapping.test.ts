// server/src/test/error-mapping.test.ts — W7 (task-46): the driver-error → HTTP envelope mapping
// proven through the REAL app (real routes, real middleware stack, real MongoDB), not probes alone.
// Why: `middlewares/error.ts` and `utils/mongo-errors.ts` decide whether a failure is a 409, a 400 or
// an opaque 500, and the W6 follow-ups added the `CastError`/`BSONError` → 404 rule. The existing
// suite only asserted a hand-built 11000 object on a probe route and the *route-level* 404 (which is
// actually an AppError from the safe id parser), so the driver-error classifications themselves were
// unexercised. Here the error values are genuine (`ValidationError` from a real document,
// `CastError`/`BSONError` from Mongoose/BSON, `E11000` from the users unique index) and they travel
// through a real endpoint and the real central handler.
// Invariants asserted (NFR-002/§8): duplicate email → 409 CONFLICT naming the field; unparseable id
// from the driver → 404 NOT_FOUND (never a cast 500); schema ValidationError → 400 VALIDATION_ERROR
// with `details[]`; an unknown failure → 500 INTERNAL with a generic message and no leaked internals;
// a valid token for a deleted user → 401 UNAUTHENTICATED.

import express, { type Express } from 'express';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../middlewares/error.js';
import { getAuthenticatedUser, requireRole } from '../middlewares/auth.js';
import { notFound } from '../middlewares/not-found.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import {
  bearer,
  clearTestDatabase,
  createDirectUser,
  createTestApp,
  registerTestUser,
  startTestDatabase,
  stopTestDatabase,
} from './helpers.js';

const UNKNOWN_OBJECT_ID = '507f1f77bcf86cd799439099';

let app: Express;

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
  app = createTestApp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A real Mongoose ValidationError produced by validating a real (unsaved) document. */
async function realValidationError(): Promise<mongoose.Error.ValidationError> {
  const invalid = new User({ name: 'X', email: 'not-an-email' });
  const validationError = await invalid.validate().catch((error: unknown) => error);
  if (!(validationError instanceof mongoose.Error.ValidationError)) {
    throw new Error('expected the User schema to reject the invalid fixture');
  }
  return validationError;
}

/** A real BSON parse error thrown by the driver when an id cannot be parsed. */
function realBsonError(): unknown {
  try {
    const invalid = new Types.ObjectId('not-an-object-id');
    throw new Error(`expected BSON parsing to fail, got ${String(invalid)}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('expected BSON parsing')) throw error;
    return error;
  }
}

describe('duplicate-key (E11000)', () => {
  it('answers 409 CONFLICT for a duplicate email register through the real route', async () => {
    const first = await registerTestUser(app);
    expect(first.response.status).toBe(201);

    // The second registration collides on the real `users.email` unique index; auth.service maps the
    // driver error to CONFLICT (it must not surface as an opaque 500).
    const second = await registerTestUser(app);
    expect(second.response.status).toBe(409);
    expect(second.response.body).toEqual({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'An account with this email already exists.',
      },
    });
    expect(second.response.body.error.details).toBeUndefined();
    expect(JSON.stringify(second.response.body)).not.toContain('E11000');
    expect(await User.countDocuments()).toBe(1);
  });

  it('maps a REAL driver E11000 that escapes a service to 409 CONFLICT naming the field', async () => {
    // Capture a genuine duplicate-key rejection from the users unique index.
    await createDirectUser({ email: 'raced@demo.com' });
    const driverError = await createDirectUser({ email: 'raced@demo.com' }).catch(
      (error: unknown) => error,
    );
    expect((driverError as { code?: number }).code).toBe(11000);

    const registration = await registerTestUser(app);
    const token: string = registration.response.body.data.accessToken;
    vi.spyOn(User, 'findByIdAndUpdate').mockImplementationOnce(() => {
      throw driverError;
    });
    const response = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(token))
      .send({ name: 'Renamed User' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    // `duplicateKeyFields(keyValue)` drives the message: the client learns which field collided.
    expect(response.body.error.message).toBe('A record with this email already exists.');
  });

  it('falls back to a generic CONFLICT message when the driver omitted keyValue', async () => {
    await createDirectUser({ email: 'raced2@demo.com' });
    const driverError = await createDirectUser({ email: 'raced2@demo.com' }).catch(
      (error: unknown) => error,
    );
    // Older/newer drivers do not always populate keyValue; the mapping must still be a 409.
    const keyless = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });

    const registration = await registerTestUser(app);
    const token: string = registration.response.body.data.accessToken;
    vi.spyOn(User, 'findByIdAndUpdate').mockImplementationOnce(() => {
      throw keyless;
    });
    const response = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(token))
      .send({ name: 'Renamed User' });

    expect((driverError as { code?: number }).code).toBe(11000);
    expect(response.status).toBe(409);
    expect(response.body.error).toEqual({
      code: 'CONFLICT',
      message: 'A record with the same unique value already exists.',
    });
  });
});

describe('unparseable path/owner id (CastError / BSONError) → 404', () => {
  it('answers 404 for a malformed id at the route boundary (safe parser, no driver error)', async () => {
    const registration = await registerTestUser(app);
    const token: string = registration.response.body.data.accessToken;

    const response = await request(app)
      .patch('/api/v1/notifications/not-an-object-id/read')
      .set(bearer(token));

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Notification not found.' },
    });
  });

  it('maps a REAL Mongoose CastError to 404 NOT_FOUND instead of a 500', async () => {
    const registration = await registerTestUser(app);
    const token: string = registration.response.body.data.accessToken;

    vi.spyOn(Notification, 'findOne').mockImplementationOnce(() => {
      throw new mongoose.Error.CastError('ObjectId', 'not-an-object-id', '_id');
    });
    const response = await request(app)
      .patch(`/api/v1/notifications/${UNKNOWN_OBJECT_ID}/read`)
      .set(bearer(token));

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Resource not found.' },
    });
    expect(JSON.stringify(response.body)).not.toContain('CastError');
  });

  it('maps a REAL BSON parse error to 404 NOT_FOUND', async () => {
    const registration = await registerTestUser(app);
    const token: string = registration.response.body.data.accessToken;
    const bsonError = realBsonError();

    vi.spyOn(Notification, 'findOne').mockImplementationOnce(() => {
      throw bsonError;
    });
    const response = await request(app)
      .patch(`/api/v1/notifications/${UNKNOWN_OBJECT_ID}/read`)
      .set(bearer(token));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(response.body)).not.toContain('BSON');
  });
});

describe('Mongoose ValidationError → 400 VALIDATION_ERROR with details[]', () => {
  it('flattens a REAL document validation failure into {path, message} details', async () => {
    const registration = await registerTestUser(app);
    const token: string = registration.response.body.data.accessToken;
    const validationError = await realValidationError();

    expect(validationError.errors.email?.message).toBe('Invalid email address');
    vi.spyOn(User, 'findByIdAndUpdate').mockImplementationOnce(() => {
      throw validationError;
    });
    const response = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(token))
      .send({ name: 'Renamed User' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Data validation failed');
    expect(response.body.error.details).toContainEqual({
      path: 'email',
      message: 'Invalid email address',
    });
    expect(response.body.error.details).toContainEqual({
      path: 'passwordHash',
      message: expect.stringContaining('Path `passwordHash` is required') as unknown as string,
    });
  });
});

describe('unknown failure → 500 INTERNAL (no leak)', () => {
  it('hides a genuine internal error behind the generic envelope', async () => {
    const registration = await registerTestUser(app);
    const token: string = registration.response.body.data.accessToken;

    vi.spyOn(User, 'findByIdAndUpdate').mockImplementationOnce(() => {
      throw new Error('internal detail: db password hunter2');
    });
    const response = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(token))
      .send({ name: 'Renamed User' });

    const raw = JSON.stringify(response.body);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'INTERNAL', message: 'An unexpected error occurred.' },
    });
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('internal detail');
    expect(raw).not.toContain('stack');
  });

  it('maps an unknown body-parser error `type` to 500 rather than inventing a 400', async () => {
    const probe = express();
    probe.get('/probe', () => {
      // Body-parser sets a string `type`; an unrecognised one must fall through to INTERNAL.
      throw Object.assign(new Error('unparseable body failure'), { type: 'weird.unknown.type' });
    });
    probe.use(notFound);
    probe.use(errorHandler);

    const response = await request(probe).get('/probe');
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL');
  });

  it('maps a non-object throw to 500 instead of dereferencing it', async () => {
    const probe = express();
    probe.get('/probe', () => {
      // Anything can be thrown in JS; the handler must not assume `Error`.
      throw 'string failure';
    });
    probe.use(errorHandler);

    const response = await request(probe).get('/probe');
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL');
  });
});

describe('authentication failures map to 401', () => {
  it('rejects a valid token whose user row was deleted (revoked account)', async () => {
    const registration = await registerTestUser(app);
    const token: string = registration.response.body.data.accessToken;
    const userId: string = registration.response.body.data.user.id;

    expect((await request(app).get('/api/v1/users/me').set(bearer(token))).status).toBe(200);
    await User.deleteOne({ _id: userId });
    const response = await request(app).get('/api/v1/users/me').set(bearer(token));

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
    });
  });

  it('requireRole mounted without requireAuth refuses instead of crashing', async () => {
    const probe = express();
    probe.get('/probe', requireRole('USER'), (_req, res) => {
      res.status(200).json({ success: true, data: {} });
    });
    probe.use(errorHandler);

    const response = await request(probe).get('/probe');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('getAuthenticatedUser refuses a request that never went through requireAuth', () => {
    expect(() => getAuthenticatedUser({} as Parameters<typeof getAuthenticatedUser>[0])).toThrow(
      AppError,
    );
  });
});
