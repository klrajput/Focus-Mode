// e2e/api-sessions.spec.ts — sessions + allow-list API integration against the real Express stack
// and a real MongoDB (T-091 prep / T-060, T-061; FR-008, FR-010, FR-020, FR-024, FR-026, REC-006).
//
// Why: the pairing E2E proves the local channel; this spec proves the cloud contract the dashboard
// and the Focus Agent rely on for session truth — 201 create, one ACTIVE per device (409
// ALREADY_FOCUSING), idempotent finalise + `clientSessionId` idempotency (REC-006), owner scoping
// (foreign device → 404, never 403), filters, and the protected allow-list rejection (INV-3).
// Every call goes through the production Express app (`buildApp`) over real HTTP against the
// E2E API process started by playwright.config.ts — no supertest-style in-process shortcuts.
//
// Fixture: the DEC-013 seed gives the seeded USER two devices; their sessions are all terminal
// (COMPLETED/CANCELLED), so the account starts with no ACTIVE session. Each test creates and
// finalises its own session, so the file is order-independent and leaves no ACTIVE state behind.
//
// Requires A5's W3 endpoints (`POST/PATCH/GET /sessions`, `GET/PUT /allowlist`) — the file-level
// `test.fixme` below is removed once they are merged.

import { expect, test } from '@playwright/test';

import {
  createSession,
  errorCodeOf,
  getAllowlist,
  listDevices,
  listSessions,
  loginUser,
  patchSession,
  putAllowlist,
  rawApiRequest,
  registerUser,
  sessionInput,
  type ApiDevice,
} from './helpers/api';
import { DEMO_USER } from './helpers/config';
import { sessionsAndAllowlistApiShipped } from './helpers/features';

/** Log in as the seeded USER and pick its connected device (the seed guarantees one). */
async function seededAccount(
  request: Parameters<typeof loginUser>[0],
): Promise<{ accessToken: string; device: ApiDevice }> {
  const { accessToken } = await loginUser(request, DEMO_USER);
  const devices = await listDevices(request, accessToken);
  const device = devices.items.find((item) => item.status === 'CONNECTED') ?? devices.items[0];
  expect(device, 'the DEC-013 seed must provide a device for the demo user').toBeDefined();
  return { accessToken, device: device as ApiDevice };
}

/** `PATCH` body that finalises a session the way the dashboard does after `focusEnded`. */
function finaliseBody(status: 'COMPLETED' | 'CANCELLED') {
  return {
    status,
    endedAt: new Date().toISOString(),
    actualMinutes: 25,
    endReason: status === 'COMPLETED' ? 'COMPLETED' : 'USER',
  };
}

const SESSIONS_API_SHIPPED = sessionsAndAllowlistApiShipped();

test.describe('Sessions + allow-list API integration', () => {
  // Self-gating (see e2e/helpers/features.ts): the W3 routers live on a feature branch until A0
  // merges it. Green evidence on that branch: 4/4 passed on `feat/a5-w3-sessions-allowlist`
  // (commit d27d970). On a checkout without the routers these tests are `fixme` — never a fake pass.
  test.fixme(
    !SESSIONS_API_SHIPPED,
    'A5 T-060/T-061 sessions (POST/PATCH/GET /sessions) and allow-list (GET/PUT /allowlist) routers ' +
      'are not mounted in this checkout — the server W3 branch (feat/a5-w3-sessions-allowlist, ' +
      'd27d970) is not merged to the checked-out branch yet.',
  );

  test('POST creates ACTIVE, a second ACTIVE is 409 ALREADY_FOCUSING, PATCH finalises idempotently', async ({
    request,
  }) => {
    const { accessToken, device } = await seededAccount(request);

    await test.step('POST /sessions → 201 ACTIVE for the owned device', async () => {
      // The server caps actualMinutes by elapsed time (session.service.ts), so start 25 min ago.
      const startedAt = new Date(Date.now() - 25 * 60_000).toISOString();
      const input = sessionInput(device.id, { startedAt });
      const session = await createSession(request, accessToken, input);
      expect(session.status).toBe('ACTIVE');
      expect(session.deviceId).toBe(device.id);
      expect(session.plannedMinutes).toBe(25);
      expect(session.source).toBe('MANUAL');
      expect(session.clientSessionId).toBe(input.clientSessionId);
      expect(session.endedAt).toBeNull();

      const second = await rawApiRequest(
        request,
        accessToken,
        'POST',
        '/sessions',
        sessionInput(device.id),
      );
      expect(second.status, 'a second ACTIVE session for the same device is a conflict').toBe(409);
      expect(errorCodeOf(second)).toBe('ALREADY_FOCUSING');

      // Reuse one body for the replay: an identical body is idempotent, a different one conflicts.
      const completedBody = finaliseBody('COMPLETED');
      await test.step('PATCH finalises to COMPLETED (200) and stays idempotent on an identical repeat', async () => {
        const finalised = await patchSession(request, accessToken, session.id, completedBody);
        expect(finalised.id).toBe(session.id);
        expect(finalised.status).toBe('COMPLETED');
        expect(finalised.endedAt).not.toBeNull();
        expect(finalised.actualMinutes).toBe(25);

        const repeat = await rawApiRequest(
          request,
          accessToken,
          'PATCH',
          `/sessions/${session.id}`,
          completedBody,
        );
        expect([200]).toContain(repeat.status);
        expect((repeat.body as { data?: { id?: string } }).data?.id).toBe(session.id);

        const different = await rawApiRequest(
          request,
          accessToken,
          'PATCH',
          `/sessions/${session.id}`,
          finaliseBody('CANCELLED'),
        );
        expect(different.status, 'a different finalisation after finalise is a conflict').toBe(409);
        expect(errorCodeOf(different)).toBe('CONFLICT');
      });

      await test.step('GET /sessions filters expose the finalised session, not it as ACTIVE', async () => {
        const completed = await listSessions(request, accessToken, { status: 'COMPLETED' });
        expect(completed.items.map((item) => item.id)).toContain(session.id);
        const active = await listSessions(request, accessToken, { status: 'ACTIVE' });
        expect(active.items.map((item) => item.id)).not.toContain(session.id);
      });
    });
  });

  test('clientSessionId makes a duplicate POST a no-op (REC-006)', async ({ request }) => {
    const { accessToken, device } = await seededAccount(request);

    const before = await listSessions(request, accessToken);
    const input = sessionInput(device.id, { durationMin: 50 });
    const created = await createSession(request, accessToken, input);
    const duplicate = await rawApiRequest(request, accessToken, 'POST', '/sessions', input);

    expect([200, 201], 'a duplicate report must not be an error').toContain(duplicate.status);
    expect((duplicate.body as { data?: { id?: string } }).data?.id).toBe(created.id);

    const after = await listSessions(request, accessToken);
    expect(after.total, 'a duplicate clientSessionId must not create a second document').toBe(
      before.total + 1,
    );

    await patchSession(request, accessToken, created.id, finaliseBody('CANCELLED'));
  });

  test('input validation, owner scoping and unknown devices (NFR-001/NFR-003)', async ({
    request,
  }) => {
    const { accessToken, device } = await seededAccount(request);

    const invalid = await rawApiRequest(request, accessToken, 'POST', '/sessions', {
      ...sessionInput(device.id),
      durationMin: 0,
    });
    expect(invalid.status).toBe(400);
    expect(errorCodeOf(invalid)).toBe('VALIDATION_ERROR');

    const unknownDevice = await rawApiRequest(request, accessToken, 'POST', '/sessions', {
      ...sessionInput('507f1f77bcf86cd799439011'),
    });
    expect(unknownDevice.status).toBe(404);
    expect(errorCodeOf(unknownDevice)).toBe('NOT_FOUND');

    // Another user's device id must look like a missing resource, never reveal ownership (NFR-003).
    const { auth: otherUser } = await registerUser(request);
    const crossUser = await rawApiRequest(request, otherUser.accessToken, 'POST', '/sessions', {
      ...sessionInput(device.id),
    });
    expect(crossUser.status).toBe(404);
    expect(errorCodeOf(crossUser)).toBe('NOT_FOUND');
  });

  test('allow-list rejects protected-app changes with PROTECTED_ENTRY (INV-3, FR-008)', async ({
    request,
  }) => {
    const { accessToken } = await seededAccount(request);
    const allowlist = await getAllowlist(request, accessToken);
    expect(
      allowlist.protectedApps.length,
      'the server must seed the protected set',
    ).toBeGreaterThan(0);

    await test.step('an unchanged echo is accepted', async () => {
      const saved = await putAllowlist(request, accessToken, {
        userApps: allowlist.userApps,
        protectedApps: allowlist.protectedApps,
      });
      expect(saved.userApps.map((app) => app.key)).toEqual(
        allowlist.userApps.map((app) => app.key),
      );
    });

    await test.step('removing a protected app is rejected with 400 PROTECTED_ENTRY', async () => {
      const removed = await rawApiRequest(request, accessToken, 'PUT', '/allowlist', {
        userApps: allowlist.userApps,
        protectedApps: allowlist.protectedApps.slice(1),
      });
      expect(removed.status).toBe(400);
      expect(errorCodeOf(removed)).toBe('PROTECTED_ENTRY');
    });

    await test.step('altering a protected app label is rejected too', async () => {
      const [first] = allowlist.protectedApps;
      expect(first).toBeDefined();
      const tampered = { ...(first as { key: string; label: string }), label: 'Not Protected' };
      const altered = await rawApiRequest(request, accessToken, 'PUT', '/allowlist', {
        userApps: allowlist.userApps,
        protectedApps: [
          tampered,
          ...allowlist.protectedApps.slice(1).filter((app) => app.key !== tampered.key),
        ],
      });
      expect(altered.status).toBe(400);
      expect(errorCodeOf(altered)).toBe('PROTECTED_ENTRY');
    });

    await test.step('a user app can be added and is persisted', async () => {
      const userApps = [
        ...allowlist.userApps.filter((app) => app.key !== 'e2e-vscode'),
        {
          key: 'e2e-vscode',
          label: 'E2E Visual Studio Code',
          mac: ['com.microsoft.VSCode'],
          win: ['Code.exe'],
        },
      ];
      const saved = await putAllowlist(request, accessToken, { userApps });
      expect(saved.userApps.map((app) => app.key)).toContain('e2e-vscode');
      const reread = await getAllowlist(request, accessToken);
      expect(reread.userApps.map((app) => app.key)).toContain('e2e-vscode');
    });
  });
});
