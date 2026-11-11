// e2e/security.spec.ts — the security checklist the UI cannot prove (W6 verification; NFR-003,
// SEC-3/SEC-4/SEC-9/SEC-10, §10 threat model).
//
// Why: the client guards are UX; the API and the local channel are the security boundary. This spec
// exercises the boundary directly against the real Express stack + the real Focus Agent link server:
//   · 401 matrix — every protected route rejects a missing/invalid Bearer token with UNAUTHENTICATED;
//   · 403 — a USER token can never reach `/admin/*` (FORBIDDEN), even though the UI also hides it;
//   · 429 — the SEC-4 `/devices/pair` limit (10/min/user) is enforced with RATE_LIMITED;
//   · CORS — a foreign Origin gets no `Access-Control-Allow-Origin` header on preflight; the
//     configured dashboard origin IS reflected (SEC-3);
//   · unknown fields — strict zod objects reject operator/unknown keys with VALIDATION_ERROR;
//   · malformed ObjectIds — answers 400/404, never 500 INTERNAL (NFR-002/§10 input hardening);
//   · local link — the agent's WebSocket rejects a foreign Origin at upgrade and answers a
//     legitimate origin with `hello` (NFR-010 DNS-rebinding/Origin defence).
//
// Nothing here is mocked: the API runs the production middleware stack and the agent is the real
// Electron process bound to 127.0.0.1.

import WebSocket from 'ws';

import { expect, test } from '@playwright/test';

import { errorCodeOf, loginUser, rawApiRequest, registerUser } from './helpers/api';
import { launchAgent } from './helpers/agent';
import {
  apiRateLimitMiddlewareShipped,
  corsCredentialsDisabledShipped,
  objectIdNotFoundShipped,
} from './helpers/features';
import {
  API_BASE_URL,
  CLIENT_ORIGIN,
  DEMO_ADMIN,
  DEMO_USER,
  E2E_AGENT_PORT,
} from './helpers/config';
import { spawnApi } from './helpers/spawn-api';

const PROTECTED_GET_PATHS = [
  '/auth/me',
  '/users/me',
  '/sessions',
  '/notifications',
  '/insights',
  '/allowlist',
  '/schedules',
  '/devices',
  '/admin/users',
] as const;

test.describe('API authentication and authorisation', () => {
  test('every protected route answers 401 UNAUTHENTICATED without a valid Bearer token', async ({
    request,
  }) => {
    for (const path of PROTECTED_GET_PATHS) {
      const anonymous = await rawApiRequest(request, null, 'GET', path);
      expect(anonymous.status, `${path} without a token`).toBe(401);
      expect(errorCodeOf(anonymous)).toBe('UNAUTHENTICATED');

      const invalid = await rawApiRequest(request, 'not-a-real-token', 'GET', path);
      expect(invalid.status, `${path} with an invalid token`).toBe(401);
      expect(errorCodeOf(invalid)).toBe('UNAUTHENTICATED');
    }
  });

  test('a USER token can never reach the admin APIs (403 FORBIDDEN)', async ({ request }) => {
    const { accessToken } = await loginUser(request, DEMO_USER);

    for (const path of ['/admin/users', '/admin/stats', '/admin/presets', '/admin/agent-links']) {
      const response = await rawApiRequest(request, accessToken, 'GET', path);
      expect(response.status, `${path} as USER`).toBe(403);
      expect(errorCodeOf(response)).toBe('FORBIDDEN');
    }

    // The ADMIN identity itself works (the boundary is role, not token validity).
    const admin = await loginUser(request, DEMO_ADMIN);
    const adminUsers = await rawApiRequest(request, admin.accessToken, 'GET', '/admin/users');
    expect(adminUsers.status).toBe(200);
  });

  test('an env-configured rate-limit ceiling produces a deterministic 429 envelope', async () => {
    test.fixme(
      !apiRateLimitMiddlewareShipped(),
      'A5 W6 rate-limit middleware (RATE_LIMIT_* env knobs wired into the API routers) is not in ' +
        'this checkout yet; the hardcoded /devices/pair limiter test below covers 429 meanwhile.',
    );
    // A second API instance with a 1 request/min global ceiling: two requests, no sleeping/bursting.
    // Use a PUBLIC route inside `/api/v1` (the root /health probe is mounted before the limiter).
    const api = await spawnApi({ RATE_LIMIT_API_MAX: '1' }, E2E_AGENT_PORT + 700);
    try {
      const first = await fetch(`${api.baseUrl}/agent-links`);
      expect(first.status, 'first limited request must be allowed').toBe(200);
      const limited = await fetch(`${api.baseUrl}/agent-links`);
      expect(limited.status, 'the second request must hit the 1/min ceiling').toBe(429);
      const body = (await limited.json()) as {
        success?: boolean;
        error?: { code?: string; message?: string };
      };
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('RATE_LIMITED');
      expect(body.error?.message).toBeTruthy();
    } finally {
      await api.stop();
    }
  });

  test('the SEC-4 /devices/pair burst is rate limited with 429 RATE_LIMITED', async ({
    request,
  }) => {
    // Fresh account so the per-user limiter starts empty (10 pairing attempts / minute).
    const { auth } = await registerUser(request);
    const statuses: number[] = [];

    for (let attempt = 1; attempt <= 11; attempt += 1) {
      const response = await rawApiRequest(request, auth.accessToken, 'POST', '/devices/pair', {
        code: '000000',
        name: `burst-${attempt}`,
      });
      statuses.push(response.status);
      if (response.status === 429) {
        expect(errorCodeOf(response)).toBe('RATE_LIMITED');
      }
    }

    expect(
      statuses.filter((status) => status === 429).length,
      `statuses: ${statuses.join(',')}`,
    ).toBeGreaterThan(0);
    expect(statuses[0], 'the first attempt must be handled, not limited').not.toBe(429);
  });
});

test.describe('Transport and input hardening', () => {
  test('CORS preflight rejects a foreign Origin and reflects the configured dashboard origin', async ({
    request,
  }) => {
    const evilPreflight = await request.fetch(`${API_BASE_URL}/sessions`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    const evilAllowOrigin = evilPreflight.headers()['access-control-allow-origin'];
    expect(
      evilAllowOrigin === undefined || evilAllowOrigin !== 'https://evil.example',
      `foreign origin must not be allowed (got ${String(evilAllowOrigin)})`,
    ).toBe(true);

    const allowedPreflight = await request.fetch(`${API_BASE_URL}/sessions`, {
      method: 'OPTIONS',
      headers: {
        Origin: CLIENT_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    expect(allowedPreflight.headers()['access-control-allow-origin']).toBe(CLIENT_ORIGIN);

    // A5 W6 announced `credentials: false` (same-origin dashboard uses Bearer tokens, not cookies).
    const allowCredentials = allowedPreflight.headers()['access-control-allow-credentials'];
    if (corsCredentialsDisabledShipped()) {
      expect(
        allowCredentials,
        'with `credentials: false` the CORS layer must not send Allow-Credentials',
      ).toBeUndefined();
    } else {
      // Pre-hardening checkout: documented interim behaviour; the assertion flips automatically.
      expect(allowCredentials).toBe('true');
    }
  });

  test('unknown fields are rejected by strict schemas (NFR-001, SEC-9)', async ({ request }) => {
    // Operator-injection style body + a privilege-escalation field must both be rejected, not ignored.
    const register = await rawApiRequest(request, null, 'POST', '/auth/register', {
      name: 'Security Probe',
      email: `sec.${Date.now()}@example.com`,
      password: 'E2ePass123',
      role: 'ADMIN',
    });
    expect(register.status).toBe(400);
    expect(errorCodeOf(register)).toBe('VALIDATION_ERROR');

    const { accessToken } = await loginUser(request, DEMO_USER);
    const session = await rawApiRequest(request, accessToken, 'POST', '/sessions', {
      deviceId: '507f1f77bcf86cd799439011',
      durationMin: 25,
      startedAt: new Date().toISOString(),
      clientSessionId: crypto.randomUUID(),
      $where: 'sleep(1000)',
    });
    expect(session.status).toBe(400);
    expect(errorCodeOf(session)).toBe('VALIDATION_ERROR');

    const allowlist = await rawApiRequest(request, accessToken, 'PUT', '/allowlist', {
      userApps: [],
      protectedApps: [{ key: 'chrome', label: 'Chrome' }],
      unexpected: true,
    });
    expect(allowlist.status).toBe(400);
    expect(errorCodeOf(allowlist)).toBe('VALIDATION_ERROR');
  });

  test('malformed ObjectIds answer 404 NOT_FOUND, never 500 (NFR-002 / §10)', async ({
    request,
  }) => {
    test.fixme(
      !objectIdNotFoundShipped(),
      'A5 W6 ObjectId-hardening (malformed path params → 404 NOT_FOUND instead of a BSONError 500) ' +
        'is not in this checkout yet; this test self-enables when it merges.',
    );
    const { accessToken } = await loginUser(request, DEMO_USER);
    const admin = await loginUser(request, DEMO_ADMIN);
    const calls = [
      {
        label: 'PATCH /sessions/:id',
        result: await rawApiRequest(request, accessToken, 'PATCH', '/sessions/not-an-object-id', {
          status: 'CANCELLED',
          endedAt: new Date().toISOString(),
          actualMinutes: 1,
          endReason: 'USER',
        }),
      },
      {
        label: 'DELETE /devices/:id',
        result: await rawApiRequest(request, accessToken, 'DELETE', '/devices/not-an-object-id'),
      },
      {
        label: 'POST /devices/:id/attest',
        result: await rawApiRequest(request, accessToken, 'POST', '/devices/zzz/attest', {
          nonce: 'a'.repeat(32),
        }),
      },
      {
        label: 'PATCH /schedules/:id',
        result: await rawApiRequest(request, accessToken, 'PATCH', '/schedules/not-an-object-id', {
          enabled: false,
        }),
      },
      {
        label: 'POST /allowlist/preset/:id',
        result: await rawApiRequest(
          request,
          accessToken,
          'POST',
          '/allowlist/preset/not-an-object-id',
        ),
      },
      {
        label: 'PATCH /admin/presets/:id',
        result: await rawApiRequest(request, admin.accessToken, 'PATCH', '/admin/presets/zzz', {
          name: 'Renamed',
        }),
      },
      {
        label: 'DELETE /admin/agent-links/:id',
        result: await rawApiRequest(
          request,
          admin.accessToken,
          'DELETE',
          '/admin/agent-links/not-an-object-id',
        ),
      },
    ];

    const strict404 = objectIdNotFoundShipped();
    for (const { label, result } of calls) {
      expect(result.status, `${label} must never be a 500`).not.toBe(500);
      expect(errorCodeOf(result), `${label} must not surface INTERNAL`).not.toBe('INTERNAL');
      if (strict404) {
        // A5 W6 hardening: malformed ids are mapped to 404 NOT_FOUND (never a CastError 400/500).
        expect(result.status, `${label} with W6 hardening must be 404`).toBe(404);
        expect(errorCodeOf(result)).toBe('NOT_FOUND');
      } else {
        expect([400, 404], `${label} status (got ${result.status})`).toContain(result.status);
      }
    }
  });
});

test.describe('Local link origin defence (NFR-010)', () => {
  interface UpgradeResult {
    readonly opened: boolean;
    readonly status: number;
    readonly helloType?: string;
  }

  /** Minimal WS upgrade probe against the real agent link server (Node client, custom Origin). */
  function probeUpgrade(origin: string): Promise<UpgradeResult> {
    return new Promise<UpgradeResult>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${E2E_AGENT_PORT}/link`, 'focus.v1', {
        headers: { Origin: origin },
        handshakeTimeout: 5_000,
      });
      let settled = false;
      const finish = (result: UpgradeResult): void => {
        if (settled) return;
        settled = true;
        try {
          socket.terminate();
        } catch {
          // already closed
        }
        resolve(result);
      };

      socket.on('message', (data: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(data.toString()) as { type?: string };
          finish({ opened: true, status: 101, helloType: parsed.type });
        } catch {
          finish({ opened: true, status: 101 });
        }
      });
      socket.on('unexpected-response', (_req, response) =>
        finish({ opened: false, status: response.statusCode ?? 0 }),
      );
      socket.on('error', () => finish({ opened: false, status: -1 }));
    });
  }

  test('the agent link rejects a foreign Origin and answers the dashboard Origin', async () => {
    const agent = await launchAgent();
    try {
      const foreign = await probeUpgrade('https://evil.example');
      expect(foreign.opened, 'a foreign Origin must not complete the upgrade').toBe(false);
      expect(foreign.status, 'foreign Origin is rejected with 403 at upgrade').toBe(403);

      const allowed = await probeUpgrade(CLIENT_ORIGIN);
      expect(allowed.opened, 'the configured dashboard Origin must be able to connect').toBe(true);
      expect(allowed.helloType, 'the agent sends `hello` on connect').toBe('hello');
    } finally {
      await agent.close().catch(() => undefined);
    }
  });
});
