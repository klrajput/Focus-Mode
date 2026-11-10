// focus/controller.consent.test.ts — REC-004 is enforced inside the controller, not by the
// page: an `enterFocus` that already carries the dashboard's consent object still has to pass
// the native first-run gate. A denial rejects with CONSENT_REQUIRED and touches nothing.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanupHarnessDirs, makeHarness, request } from './controller.harness.js';

afterEach(() => {
  cleanupHarnessDirs();
});

describe('native first-run consent inside enterFocus', () => {
  it('still asks the native dialog when the page already sent its own consent (FR-009/REC-004)', async () => {
    const harness = makeHarness({ grantConsent: true });
    const pageConsent = { acceptedAt: '2026-11-10T09:59:00.000Z', version: 'consent-v1' };

    await harness.controller.enterFocus(request({ consent: pageConsent }));

    expect(harness.prompts()).toBe(1);
    expect(harness.controller.nativeConsentGranted()).toBe(true);

    // The native decision is cached per device+version: the next start does not ask again.
    await harness.controller.exitFocus('USER');
    await harness.controller.enterFocus(request());
    expect(harness.prompts()).toBe(1);
  });

  it('rejects with CONSENT_REQUIRED and leaves the OS untouched when the dialog is declined', async () => {
    const harness = makeHarness({ grantConsent: false });

    await expect(
      harness.controller.enterFocus(
        request({ consent: { acceptedAt: '2026-11-10T09:59:00.000Z', version: 'consent-v1' } }),
      ),
    ).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });

    expect(harness.controller.getState().state).toBe('PAIRED');
    expect(harness.controller.nativeConsentGranted()).toBe(false);
    expect(harness.driver.getCallLog()).toEqual([]);
    expect(harness.journal.read()).toBeNull();
    expect(harness.events).toEqual([]);
  });

  it('asks again after the user revokes the permission in the tray/agent window', async () => {
    const harness = makeHarness({ grantConsent: true });
    await harness.controller.enterFocus(request());
    expect(harness.prompts()).toBe(1);
    await harness.controller.exitFocus('USER');

    harness.controller.revokeNativeConsent();
    expect(harness.controller.nativeConsentGranted()).toBe(false);

    await harness.controller.enterFocus(request());
    expect(harness.prompts()).toBe(2);
  });
});
