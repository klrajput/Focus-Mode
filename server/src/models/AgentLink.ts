// server/src/models/AgentLink.ts — Mongo `agentLinks` collection (REC addition, TECHNICAL_DESIGN §4;
// FR-019/FR-025). Admin-published Focus Agent installer pointers shown on the landing page and
// settings ("Download for macOS"). Only admins write; the endpoint is public because anonymous
// visitors must be able to download the Focus Agent. `publishedBy` is the audit reference to the
// publishing admin. The `{os}` index serves GET /agent-links and the per-OS settings card.

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import type { AgentArch, OsName } from '@focus-mode/shared';
import { AGENT_ARCHES, OS_NAMES } from './enums.js';

/** Semver with optional pre-release/build suffix (shared agentVersionSchema). */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Persisted installer link. */
export interface IAgentLink {
  os: OsName;
  arch: AgentArch;
  /** Card label, e.g. "macOS (Apple silicon)" (2–60 chars). */
  label: string;
  /** Absolute https URL of the installer/artifact; never a local path. */
  url: string;
  version: string;
  /** Admin who published this row (audit only). */
  publishedBy: Types.ObjectId;
  publishedAt: Date;
}

export type AgentLinkDocument = HydratedDocument<IAgentLink>;

/** Only http(s) URLs are accepted — a download link can never be `file:`/`javascript:`. */
function isDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

const agentLinkSchema = new Schema<IAgentLink>(
  {
    os: { type: String, enum: [...OS_NAMES], required: true },
    arch: { type: String, enum: [...AGENT_ARCHES], required: true },
    label: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
      validate: [{ validator: isDownloadUrl, message: 'url must be an absolute http(s) URL' }],
    },
    version: {
      type: String,
      required: true,
      trim: true,
      match: [SEMVER_PATTERN, 'version must be semver, e.g. 1.4.0'],
    },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    publishedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'agentLinks' },
);

// TECHNICAL_DESIGN §4: public GET /agent-links filters/orders by OS.
agentLinkSchema.index({ os: 1 });

export const AgentLink: Model<IAgentLink> = model<IAgentLink>('AgentLink', agentLinkSchema);
