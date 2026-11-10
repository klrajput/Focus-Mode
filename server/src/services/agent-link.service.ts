// server/src/services/agent-link.service.ts — public Focus Agent download links (T-072, FR-019/FR-029).
// Why: anonymous visitors on the landing page and signed-in users on `/settings` both need the
// current installer pointers; admins own the CRUD (T-073), so this module is read-only.
// Invariants: public data only — `publishedBy` (audit admin id) is never exposed; URLs are absolute
// http(s) values validated by the model; the response is the NFR-009 paginated envelope with a fixed
// deterministic order (OS, then arch, then id) so paging is stable.

import type { AgentArch, OsName, Paginated } from '@focus-mode/shared';
import { AgentLink } from '../models/AgentLink.js';
import { buildPaginated, pageSkip, type PageLimitQuery } from '../utils/pagination.js';
import { toIsoString } from '../utils/serialize.js';

/** `agent link` wire shape (INTEGRATION_CONTRACTS §3.3). */
export interface PublicAgentLink {
  id: string;
  os: OsName;
  arch: AgentArch;
  label: string;
  url: string;
  version: string;
  publishedAt: string | null;
}

interface AgentLinkLike {
  _id: unknown;
  os: OsName;
  arch: AgentArch;
  label: string;
  url: string;
  version: string;
  publishedAt?: unknown;
}

/** Whitelist + serialise one installer link (never exposes `publishedBy`). */
export function toPublicAgentLink(link: AgentLinkLike): PublicAgentLink {
  return {
    id: String(link._id),
    os: link.os,
    arch: link.arch,
    label: link.label,
    url: link.url,
    version: link.version,
    publishedAt: toIsoString(link.publishedAt),
  };
}

/** GET /agent-links — public paginated installer list (no auth, contract §3.1 #25). */
export async function listAgentLinks(query: PageLimitQuery): Promise<Paginated<PublicAgentLink>> {
  const [total, links] = await Promise.all([
    AgentLink.countDocuments(),
    AgentLink.find()
      .sort({ os: 1, arch: 1, _id: 1 })
      .skip(pageSkip(query.page, query.limit))
      .limit(query.limit)
      .lean(),
  ]);

  return buildPaginated(
    links.map((link) => toPublicAgentLink(link)),
    query.page,
    query.limit,
    total,
  );
}
