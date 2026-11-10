// server/src/controllers/devices.controller.ts — dashboard device handlers (T-040/T-043/T-072).
// Why: the browser pairs with a 6-digit code, lists/revokes its own devices and asks the cloud for
// a short-lived attestation bound to a local-channel challenge nonce. Controllers stay thin:
// validation happened in middleware, ownership/business rules live in the services.
// Invariants: 200 for pair (contract §3.1 #8), list, attest (#11); the device token is never
// returned to the browser; a foreign device id is a 404, never a 403 (NFR-003); attestation is only
// issued for a connected device of the authenticated owner (NO_DEVICE_CONNECTED otherwise).

import type { RequestHandler } from 'express';
import {
  ERROR_CODES,
  type ApiSuccess,
  type AttestRequestInput,
  type DeviceListQuery,
  type DevicePairInput,
  type Paginated,
} from '@focus-mode/shared';
import { getAuthenticatedUser } from '../middlewares/auth.js';
import { getValidatedQuery } from '../middlewares/validate.js';
import { signDeviceAttestation, type DeviceAttestation } from '../services/attestation.service.js';
import { getOwnedDevice, listDevices, type PublicDevice } from '../services/device.service.js';
import { pairDevice, type PairDeviceResult } from '../services/pairing.service.js';
import {
  revokeAllDevicesForUser,
  revokeOwnedDevice,
  type RevokedDevice,
  type UnpairAllResult,
} from '../services/device-revocation.service.js';
import { AppError } from '../utils/AppError.js';

type RouteParams = Record<string, string>;

/** POST /api/v1/devices/pair — 200 `{device}` (contract §3.1 #8). */
export const pair: RequestHandler<
  RouteParams,
  ApiSuccess<PairDeviceResult>,
  DevicePairInput
> = async (req, res) => {
  const result = await pairDevice(getAuthenticatedUser(req).id, req.body);
  res.status(200).json({ success: true, data: result });
};

/** GET /api/v1/devices — 200 paginated devices of the authenticated user (#9). */
export const list: RequestHandler<RouteParams, ApiSuccess<Paginated<PublicDevice>>> = async (
  req,
  res,
) => {
  const user = getAuthenticatedUser(req);
  const query = getValidatedQuery<DeviceListQuery>(res);
  const data = await listDevices(user.id, query);
  res.status(200).json({ success: true, data });
};

/** POST /api/v1/devices/:id/attest — 200 `{attestation, expiresAt, algorithm}` (#11). */
export const attest: RequestHandler<
  RouteParams,
  ApiSuccess<DeviceAttestation>,
  AttestRequestInput
> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const deviceId = req.params.id;
  if (deviceId === undefined) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Device not found.');
  }
  const device = await getOwnedDevice(user.id, deviceId);
  if (device.status !== 'CONNECTED') {
    throw new AppError(
      ERROR_CODES.NO_DEVICE_CONNECTED,
      'No device connected — start your Focus Agent.',
    );
  }

  const data = signDeviceAttestation({ userId: user.id, deviceId, nonce: req.body.nonce });
  res.status(200).json({ success: true, data });
};

/** POST /api/v1/devices/unpair-all — 200 `{unpaired}`; revokes every device (FR-029, delta C-23). */
export const unpairAll: RequestHandler<RouteParams, ApiSuccess<UnpairAllResult>> = async (
  req,
  res,
) => {
  const user = getAuthenticatedUser(req);
  const data = await revokeAllDevicesForUser(user.id);
  res.status(200).json({ success: true, data });
};

/** DELETE /api/v1/devices/:id — 200 `{id, revoked:true}` (contract §3.1 #10). */
export const remove: RequestHandler<RouteParams, ApiSuccess<RevokedDevice>> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const deviceId = req.params.id;
  if (deviceId === undefined) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Device not found.');
  }
  const data = await revokeOwnedDevice(user.id, deviceId);
  res.status(200).json({ success: true, data });
};
