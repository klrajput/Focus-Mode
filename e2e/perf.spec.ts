// e2e/perf.spec.ts — NFR-011 latency verification (REC: API p95 ≤ 300 ms on seed data).
//
// Why: NFR-011 is a "measured in QA report" requirement; this spec makes it reproducible and
// regression-catchable. It runs 200 sequential requests per main endpoint against the real E2E API
// (seeded with the DEC-013 demo data, in-memory MongoDB) through Playwright's APIRequestContext —
// the same Express stack the dashboard uses — and computes p50/p95 from real wall-clock timings.
// The numbers are printed for `docs/QA_NOTES.md` and the p95 assertion enforces the REQUIREMENTS
// target; no invented thresholds.
//
// Not measured here: focus-apply ≤3 s and status propagation ≤1 s are covered functionally by the
// focus/pairing/schedule E2E timings (agent + local channel), and agent CPU/RAM are OS-level
// NEEDS-HUMAN measurements (Phase 8 checklist).

import { expect, test } from '@playwright/test';

import { bearer, loginUser } from './helpers/api';
import { API_BASE_URL, DEMO_ADMIN, DEMO_USER } from './helpers/config';

/** NFR-011 (REQUIREMENTS §5): API p95 ≤ 300 ms on seed data. */
const API_P95_TARGET_MS = 300;
const REQUESTS_PER_ENDPOINT = 200;

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function summarise(samples: readonly number[]): { p50: number; p95: number; max: number } {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    p50: Math.round(percentile(sorted, 0.5) * 100) / 100,
    p95: Math.round(percentile(sorted, 0.95) * 100) / 100,
    max: Math.round((sorted[sorted.length - 1] ?? 0) * 100) / 100,
  };
}

test.describe('NFR-011 API latency', () => {
  test('main endpoints stay within the p95 ≤ 300 ms target on seed data', async ({ request }) => {
    test.slow();
    test.setTimeout(180_000);
    const user = await loginUser(request, DEMO_USER);
    const admin = await loginUser(request, DEMO_ADMIN);

    const endpoints = [
      { name: 'GET /health (public)', path: '/health', token: null },
      { name: 'GET /devices', path: '/devices', token: user.accessToken },
      { name: 'GET /sessions?limit=20', path: '/sessions?limit=20', token: user.accessToken },
      { name: 'GET /insights?range=7d', path: '/insights?range=7d', token: user.accessToken },
      {
        name: 'GET /notifications?limit=20',
        path: '/notifications?limit=20',
        token: user.accessToken,
      },
      { name: 'GET /allowlist', path: '/allowlist', token: user.accessToken },
      { name: 'GET /schedules', path: '/schedules', token: user.accessToken },
      { name: 'GET /agent-links (public)', path: '/agent-links', token: null },
      { name: 'GET /admin/users (admin)', path: '/admin/users', token: admin.accessToken },
      { name: 'GET /admin/stats (admin)', path: '/admin/stats', token: admin.accessToken },
    ] as const;

    const rows: { name: string; p50: number; p95: number; max: number }[] = [];

    for (const endpoint of endpoints) {
      const url = `${API_BASE_URL}${endpoint.path}`;
      const headers = endpoint.token === null ? {} : bearer(endpoint.token);
      // Warm-up request (JIT / connection pool) is not part of the measurement.
      const warm = await request.get(url, { headers });
      expect(warm.status(), `${endpoint.name} must succeed before timing`).toBeLessThan(400);

      const samples: number[] = [];
      for (let index = 0; index < REQUESTS_PER_ENDPOINT; index += 1) {
        const started = performance.now();
        const response = await request.get(url, { headers });
        const elapsed = performance.now() - started;
        expect(response.status(), `${endpoint.name} iteration ${index}`).toBeLessThan(400);
        samples.push(elapsed);
      }
      const { p50, p95, max } = summarise(samples);
      rows.push({ name: endpoint.name, p50, p95, max });
      console.log(
        `[perf] ${endpoint.name}: p50=${p50}ms p95=${p95}ms max=${max}ms (n=${REQUESTS_PER_ENDPOINT})`,
      );
    }

    console.log('[perf] table for docs/QA_NOTES.md:');
    console.log('| endpoint | p50 (ms) | p95 (ms) | max (ms) | n |');
    console.log('|---|---|---|---|---|');
    for (const row of rows) {
      console.log(
        `| ${row.name} | ${row.p50} | ${row.p95} | ${row.max} | ${REQUESTS_PER_ENDPOINT} |`,
      );
    }

    const worst = rows.reduce((left, right) => (right.p95 > left.p95 ? right : left));
    expect(
      worst.p95,
      `worst p95 ${worst.p95} ms (${worst.name}) must be ≤ ${API_P95_TARGET_MS} ms (NFR-011)`,
    ).toBeLessThanOrEqual(API_P95_TARGET_MS);
  });
});
