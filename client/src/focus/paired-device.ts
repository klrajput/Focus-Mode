/*
 * Device label helper (T-056/T-057): the dashboard names the paired device only when the API
 * actually returns one. Before attestation/capability data it says nothing rather than inventing a
 * machine name (the W1/W2 review ratified the same rule for the badge tooltip).
 */

import type { Device } from '../api/types';

/** The device the loopback agent maps to: first CONNECTED/FOCUSING, else the first paired one. */
export function pairedDeviceName(items: readonly Device[]): string | null {
  const active = items.find(
    (device) => device.status === 'CONNECTED' || device.status === 'FOCUSING',
  );
  if (active !== undefined) return active.name;

  const paired = items.find((device) => device.pairedAt !== null);
  return paired?.name ?? null;
}
