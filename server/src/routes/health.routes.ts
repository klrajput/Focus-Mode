// server/src/routes/health.routes.ts — liveness/readiness probes (T-010, TECHNICAL_DESIGN §11).
// Why: hosting probes need an unauthenticated endpoint that does not touch auth or the DB schema:
// `/health` reports that the process is up, `/health/db` reports mongoose connectivity. Both return
// the standard success envelope; only `/health/db` can answer 503 (readiness is not a business error
// and is outside the frozen REST status table, so it reuses the generic INTERNAL code).
// Invariants: no secrets/versions leaked; `/health` always 200 while the process runs.

import { Router } from 'express';
import mongoose from 'mongoose';
import { ERROR_CODES, type ApiSuccess } from '@focus-mode/shared';

/** mongoose readyState → wire-friendly name (`ok` only when state === connected). */
const CONNECTION_STATES: Readonly<Record<number, string>> = {
  0: 'disconnected',
  1: 'ok',
  2: 'connecting',
  3: 'disconnecting',
};

export interface HealthData {
  status: 'ok';
  db: string;
  uptimeSec: number;
}

export interface DatabaseHealthData {
  status: 'ok';
  db: 'ok';
}

function databaseState(): string {
  return CONNECTION_STATES[mongoose.connection.readyState] ?? 'unknown';
}

export const healthRouter = Router();

// GET /health (also mounted at /api/v1/health — contract §3.1 path + root probe alias).
healthRouter.get('/', (_req, res) => {
  const body: ApiSuccess<HealthData> = {
    success: true,
    data: { status: 'ok', db: databaseState(), uptimeSec: Math.round(process.uptime()) },
  };
  res.status(200).json(body);
});

// GET /health/db — 200 while mongoose is connected, 503 otherwise.
healthRouter.get('/db', (_req, res) => {
  if (mongoose.connection.readyState === 1) {
    const body: ApiSuccess<DatabaseHealthData> = {
      success: true,
      data: { status: 'ok', db: 'ok' },
    };
    res.status(200).json(body);
    return;
  }
  res.status(503).json({
    success: false,
    error: { code: ERROR_CODES.INTERNAL, message: 'Database is not connected.' },
  });
});
