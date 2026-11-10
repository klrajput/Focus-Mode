// server/src/controllers/agent.controller.ts — agent-facing REST handlers (T-040/T-043/T-063).
// Why: the Focus Agent has no user JWT; it pre-registers a code digest, polls with its one-time
// enroll secret for the device token, fetches the attestation public key, and (W4) fetches the
// owner's allow-list before a scheduled start. Thin handlers only translate validated input into
// service calls and shape the NFR-002 success envelope.
// Invariants: 201 for register (contract §3.1 #37), 200 for poll/attest-key/allowlist; the device
// token is returned to the agent exactly once and never to a browser session; the private key never
// leaves the server; the allow-list is always the owner's full protected+user set (INV-3).

import type { RequestHandler } from 'express';
import {
  type ApiSuccess,
  type DeviceRegisterInput,
  type EnrollPollInput,
} from '@focus-mode/shared';
import { getAuthenticatedDevice } from '../middlewares/deviceAuth.js';
import { getAllowlist, type PublicAllowlist } from '../services/allowlist.service.js';
import {
  getAttestationPublicKey,
  type AttestationPublicKey,
} from '../services/attestation.service.js';
import {
  pollEnrollment,
  registerPendingDevice,
  type EnrollPollResult,
  type RegisterAgentResult,
} from '../services/pairing.service.js';

type RouteParams = Record<string, string>;

/** POST /api/v1/agent/register — 201 `{deviceId, enrollSecret}` (contract §3.1 #37). */
export const register: RequestHandler<
  RouteParams,
  ApiSuccess<RegisterAgentResult>,
  DeviceRegisterInput
> = async (req, res) => {
  const result = await registerPendingDevice(req.body);
  res.status(201).json({ success: true, data: result });
};

/** POST /api/v1/agent/enroll/poll — 200 `{deviceToken, userId, allowListVersion}` (#38). */
export const enrollPoll: RequestHandler<
  RouteParams,
  ApiSuccess<EnrollPollResult>,
  EnrollPollInput
> = async (req, res) => {
  const result = await pollEnrollment(req.body);
  res.status(200).json({ success: true, data: result });
};

/** GET /api/v1/agent/attest-key — 200 `{publicKey, algorithm}` (public, #40). */
export const attestKey: RequestHandler<RouteParams, ApiSuccess<AttestationPublicKey>> = (
  _req,
  res,
) => {
  res.status(200).json({ success: true, data: getAttestationPublicKey() });
};

/** GET /api/v1/agent/allowlist — 200 owner allow-list for scheduled starts (C-20). */
export const allowlist: RequestHandler<RouteParams, ApiSuccess<PublicAllowlist>> = async (
  req,
  res,
) => {
  const device = getAuthenticatedDevice(req);
  const data = await getAllowlist(device.ownerId);
  res.status(200).json({ success: true, data });
};
