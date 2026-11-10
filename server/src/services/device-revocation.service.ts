// server/src/services/device-revocation.service.ts — unpair one of the user's devices (T-040,
// contract §3.1 #10). Why: revoking must do two things in the right order — first push `revoked`
// to a connected Focus Agent so it restores any active focus and returns to IDLE (INV-2/INV-5),
// then invalidate every credential and remove the pairing so the device disappears from the
// dashboard. Ownership is checked first; a foreign device id behaves exactly like a missing one.
// Invariants: the device token/enroll secret can never be used again (row removed); an offline agent
// is not an error (the push is best-effort — the agent also drops state when its next request 401s);
// deleting is idempotent from the client's perspective (second DELETE → 404 NOT_FOUND).

import { Types } from 'mongoose';
import { ERROR_CODES } from '@focus-mode/shared';
import { logger } from '../config/logger.js';
import { Device } from '../models/Device.js';
import { revokeDevice as pushRevokeToAgent } from '../realtime/agentHub.js';
import { AppError } from '../utils/AppError.js';

/** Success payload of `DELETE /devices/:id` (contract §3.1 #10). */
export interface RevokedDevice {
  id: string;
  revoked: true;
}

/**
 * Revoke + unpair an owned device.
 * The hub push happens before the row is deleted because the hub resolves presence by deviceId and
 * needs to close the live socket; its own DB status write then becomes a harmless no-op.
 */
export async function revokeOwnedDevice(userId: string, deviceId: string): Promise<RevokedDevice> {
  const deviceObjectId = new Types.ObjectId(deviceId);
  const ownerObjectId = new Types.ObjectId(userId);

  const device = await Device.findOne({ _id: deviceObjectId, ownerId: ownerObjectId });
  if (device === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Device not found.');
  }

  // Best-effort: `false` just means the Focus Agent is not connected right now (INV-5 restore is
  // agent-local, so nothing is left stuck). The audit trail lives in the server log, not the API.
  const delivered = await pushRevokeToAgent(deviceId);
  logger.info({ deviceId, delivered }, 'device revoked by owner');

  await Device.deleteOne({ _id: deviceObjectId, ownerId: ownerObjectId });
  return { id: deviceId, revoked: true };
}
