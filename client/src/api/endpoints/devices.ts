// Device endpoints (INTEGRATION_CONTRACTS §3.1 #8–#11, REC-002/REC-003).
// The 6-digit pairing code is typed here and posted to the cloud only; it never crosses the
// local WebSocket channel (DEC-003). The device token is never returned to the browser.

import type { AttestRequestInput, DevicePairInput, Paginated } from '@focus-mode/shared';

import { apiRequest } from '../http';
import type {
  AttestationResult,
  Device,
  DeviceListParams,
  PairedDevice,
  RevokedDevice,
} from '../types';

export const devicesApi = {
  list: (query: DeviceListParams = {}): Promise<Paginated<Device>> =>
    apiRequest<Paginated<Device>>('/devices', { query }),

  pair: (input: DevicePairInput): Promise<PairedDevice> =>
    apiRequest<PairedDevice>('/devices/pair', { method: 'POST', body: input }),

  /** Unpair/revoke: the server revokes the device token and nudges the Focus Agent (INV-5). */
  remove: (id: string): Promise<RevokedDevice> =>
    apiRequest<RevokedDevice>(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  attest: (id: string, input: AttestRequestInput): Promise<AttestationResult> =>
    apiRequest<AttestationResult>(`/devices/${encodeURIComponent(id)}/attest`, {
      method: 'POST',
      body: input,
    }),
};
