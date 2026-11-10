// server/src/services/device.service.ts — device read model + ownership lookup (T-040, contract §3.3).
// Why: the wire "device" shape (`{id,name,os,status,agentVersion,pairedAt,lastSeenAt,capabilities?}`)
// is built by whitelisting fields in one mapper, so nothing else (hashes, owner ids, internal
// fields) can leak into a response (NFR-013/SEC-10). Listing is always scoped to the authenticated
// owner — a foreign device id must behave exactly like a missing one (404, NFR-003).
// Invariants: every response id is a 24-hex string; timestamps are ISO-8601 UTC or null; capacity
// `capabilities` is omitted while the Focus Agent has not reported it; list shape is NFR-009.

import { Types } from 'mongoose';
import {
  ERROR_CODES,
  type DeviceListQuery,
  type DeviceStatus,
  type OsName,
  type Paginated,
} from '@focus-mode/shared';
import { Device, type DeviceDocument } from '../models/Device.js';
import { AppError } from '../utils/AppError.js';
import { toObjectIdOrNotFound } from '../utils/object-id.js';

/** Device capability summary from the local `hello` message (optional until the agent reports). */
export interface DeviceCapabilitiesShape {
  focus: 'full' | 'partial' | 'unsupported';
  reasons?: string[];
}

/** `device` shape returned by GET /devices, POST /devices/pair (INTEGRATION_CONTRACTS §3.3). */
export interface PublicDevice {
  id: string;
  name: string;
  os: OsName;
  status: DeviceStatus;
  agentVersion: string;
  pairedAt: string | null;
  lastSeenAt: string | null;
  capabilities?: DeviceCapabilitiesShape;
}

/** Structural view shared by Mongoose documents and `.lean()` results. */
export interface DeviceLike {
  _id: unknown;
  name: string;
  os: OsName;
  status: DeviceStatus;
  agentVersion: string;
  pairedAt?: Date | null;
  lastSeenAt?: Date | null;
  capabilities?: { focus: 'full' | 'partial' | 'unsupported'; reasons?: string[] } | null;
}

/** Sortable device fields (frozen list schema). `createdAt` is aliased to `_id` (see comment below). */
const SORT_FIELDS: Readonly<Record<'name' | 'lastSeenAt' | 'createdAt', string>> = {
  name: 'name',
  lastSeenAt: 'lastSeenAt',
  // The Device model has no `createdAt` column (TECHNICAL_DESIGN §4); the ObjectId embeds its
  // creation second, so sorting by `_id` preserves the documented "createdAt" ordering.
  createdAt: '_id',
};

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function toObjectId(value: string): Types.ObjectId {
  // W6/SEC-9: a malformed device id is a missing device (404), never a 500.
  return toObjectIdOrNotFound(value, 'Device not found.');
}

/** Whitelist + serialise one device document for API responses. */
export function toPublicDevice(device: DeviceLike): PublicDevice {
  const capabilities = device.capabilities ?? null;
  return {
    id: String(device._id),
    name: device.name,
    os: device.os,
    status: device.status,
    agentVersion: device.agentVersion,
    pairedAt: toIsoString(device.pairedAt),
    lastSeenAt: toIsoString(device.lastSeenAt),
    ...(capabilities === null
      ? {}
      : {
          capabilities: {
            focus: capabilities.focus,
            ...(capabilities.reasons !== undefined && capabilities.reasons.length > 0
              ? { reasons: capabilities.reasons }
              : {}),
          },
        }),
  };
}

/** Translate the frozen `sort` query value into a Mongo sort document. */
function resolveSort(sort: string): { [field: string]: 1 | -1 } {
  const descending = sort.startsWith('-');
  const requested = (descending ? sort.slice(1) : sort) as keyof typeof SORT_FIELDS;
  return { [SORT_FIELDS[requested] ?? '_id']: descending ? -1 : 1 };
}

/** Escape user input for a case-insensitive MongoDB regex (search is not a pattern language). */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** NFR-009 paginated list of the user's own devices (pending devices have no owner and never show). */
export async function listDevices(
  userId: string,
  query: DeviceListQuery,
): Promise<Paginated<PublicDevice>> {
  const ownerId = toObjectId(userId);
  const filter: Record<string, unknown> = { ownerId };
  if (query.search !== undefined) {
    filter.name = { $regex: escapeRegex(query.search), $options: 'i' };
  }

  const [total, devices] = await Promise.all([
    Device.countDocuments(filter),
    Device.find(filter)
      .sort(resolveSort(query.sort))
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
  ]);

  return {
    items: devices.map((device) => toPublicDevice(device)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
}

/** 404 unless the device exists AND belongs to `userId` (never reveal another user's device). */
export async function getOwnedDevice(userId: string, deviceId: string): Promise<DeviceDocument> {
  const device = await Device.findOne({ _id: toObjectId(deviceId), ownerId: toObjectId(userId) });
  if (device === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Device not found.');
  }
  return device;
}
