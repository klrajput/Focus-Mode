# DECISIONS.md — Architecture Decision Records

> Format: id · date (IST) · status · context → decision → consequences. Contract/architecture changes follow AGENTS.md §5.
> Status values: **accepted** (in force) · **proposed** (needs human confirmation) · **superseded**.

## DEC-001 — Node runtime: use Node 26.11.1, not a Node 22 install
- **Date:** 2026-11-10 · **Status:** accepted (revisit if a dependency fails)
- **Context:** Blueprint targets Node 22 LTS; this machine has Homebrew Node 26.11.1 and no version manager. Registry engine check today: `electron@45.2.3` requires `node >= 22.12.0`; `mongodb-memory-server@11.3.0` requires `node >= 20.19.0`; `@types/node` latest is 26.6.6 but 22.x line exists (`22.20.5`).
- **Decision:** run the toolchain on Node 26.11.1 (satisfies every declared engine range), pin `@types/node@22.20.5` so the code still compiles against the Node 22 API surface the blueprint targets. No `brew install node@22` needed.
- **Consequences:** one less install approval; CI (.github) will still use Node 22 to match the blueprint. If any tool breaks on Node 26, fall back to `brew install node@22` (BL-02 reopens).

## DEC-002 — npm cache must be redirected inside the workspace (sandbox)
- **Date:** 2026-11-10 · **Status:** accepted (workaround), permanent fix pending human
- **Context:** `~/.npm` is root-owned (previous sudo npm run) → every `npm view/install` fails with `EPERM` because DSH file sandbox also denies HOME writes. Verified consequence and workaround.
- **Decision:** all npm commands use `npm_config_cache=/Users/geetakumari/Desktop/FocusMode/.npmcache`. `.npmcache/` goes into `.gitignore`. CI/unaffected machines use the default cache.
- **Consequences:** workers must export the env var (documented in AGENT_STATUS); permanent fix = human runs `sudo chown -R 501:20 ~/.npm`.

## DEC-003 — Blueprint is authoritative until the PDF is supplied
- **Date:** 2026-11-10 · **Status:** proposed (BL-01)
- **Context:** `PS3_Focus_Mode_Lockdown_Dashboard.pdf` is not present in the workspace. PROJECT.md/REQUIREMENTS/TD are derived from it and tagged [PDF]/[REC]/[DEC].
- **Decision:** implement the blueprint as written; if the human supplies the PDF, diff each [PDF] claim before W2 and log any delta here. This is exactly the master-prompt rule "if blueprint and PDF disagree, stop and ask".
- **Consequences:** small fidelity risk contained by traceability (`docs/REQUIREMENT_TRACEABILITY.md` after T-003).

## DEC-004 — MCP servers are unavailable in this session; documented fallbacks
- **Date:** 2026-11-10 · **Status:** accepted
- **Context:** The Harness ships `@deepseek-ai/dsh-mcp-client` but exposes no MCP-registration tool to this session, and the profile config lives outside the writable sandbox (HOME writes denied). PLUGINS_AND_TOOLS §5.7 requires stating the limitation and using the fallback.
- **Decision:** Playwright **test runner** (`@playwright/test`) instead of Playwright MCP; npm registry + official docs via `web_fetch` instead of Context7; `mongosh` for DB inspection instead of MongoDB MCP; no GitHub MCP (gh CLI + git suffice; commits carry the human identity only).
- **Consequences:** no accessibility-snapshot browser driving from the agent; E2E via Playwright CLI and screenshots on failure. Human may enable MCP in GUI Settings later (BL-09) — no rework needed.

## DEC-005 — macOS driver model after spike S-2
- **Date:** 2026-11-10 · **Status:** accepted · **Supersedes:** TECHNICAL_DESIGN §7.5 macOS "State Events fallback" as primary
- **Context:** S-2 proved `NSRunningApplication.hide()/unhide()` works via one-shot `osascript -l JavaScript` **without any TCC grant**, but the BOOL return value is unreliable and hidden-state reads are stale inside the same process (no run loop). System Events AppleScript fails with privilege violation `-10004` without Automation permission.
- **Decision:** `drivers/darwin.ts` uses one osascript invocation per operation, verifies by a **separate follow-up invocation** with bounded retries, journals bundle ids only, and never relies on System Events. Electron integration (T-053) must re-test whether a long-lived main process sees live state; if yes it may poll in-process, else keep one-shot calls. Fallback via System Events is documented as requiring a user-granted Automation permission (NEEDS-HUMAN if ever used).
- **Consequences:** slight per-operation process spawn cost (acceptable, focus operations are rare); no permission wall on macOS; `docs/PLATFORMS.md` must state this.

## DEC-006 — Default browser is resolved at agent start and added to the protected set
- **Date:** 2026-11-10 · **Status:** accepted
- **Context:** S-3: `NSWorkspace.URLForApplicationToOpenURL` returns `/Applications/Google Chrome.app`; protected set must include the OS default browser even if it is none of the hard-coded ones.
- **Decision:** agent start (macOS) resolves https/http default app → bundle id → adds to the runtime protected set. All known browsers remain hard-coded protected (INV-3); failure to resolve is non-fatal.
- **Consequences:** `shared/src/protected.ts` remains static; the agent's `allowlist.ts` merges runtime additions. On Windows, the same idea uses the `http` ProgId only if spike S-1 can confirm; otherwise fall back to the static list (all known browsers already protected).

## DEC-007 — Git operating model in a single shared checkout
- **Date:** 2026-11-10 · **Status:** proposed (BL-04) · **Owner:** A0
- **Context:** Agent-Teams members share one working directory; 10 concurrent `git` invocations would race on index/branch. The human asked for per-agent branches pushed, then a single `main`.
- **Decision:** workers never run git. Each finished task reports `{branch: feat/<worker>-<scope>, files[], commitSubject}`; **A0** creates the branch, stages only that worker's owned files, commits with the human identity (`klrajput <karanlodhi0552@gmail.com>`), pushes to `origin`, and merges/direct-commits to `main` at wave gates. No `Co-authored-by`/`Generated-by`/tool trailers, no bot identity, no history rewrite.
- **Consequences:** clean, explainable history; branches exist per worker/feature on the remote; the exam's "each member commits" rule still needs the humans to author their own slices (hand-off lists at gates).

## DEC-008 — Candidate P0 "one fully working OS" = macOS arm64 (this machine)
- **Date:** 2026-11-10 · **Status:** proposed (BL-05)
- **Context:** The only real desktop available in this session is macOS 15.7.7 arm64. S-2 proves real hide/unhide is runtime-verifiable here. PDF P0 needs at least one OS really working.
- **Decision:** target macOS as the P0 fully-working OS; implement Windows driver too (contract-tested in CI) but mark real Windows behaviour NEEDS-HUMAN; Linux X11 best-effort, Wayland → `capabilities.focus='unsupported'`.
- **Consequences:** demo/video focuses on macOS; if the human has a Windows PC, Windows can be promoted to P0 and the same checklist (T-100) runs there.

## DEC-009 — Dependency pinning policy
- **Date:** 2026-11-10 · **Status:** accepted
- **Context:** Step 2 requires verifying with `npm view <pkg> version` before pinning; registry was checked today for every package in PLUGINS_AND_TOOLS §2.
- **Decision:** exact versions (no `^`/`~`) in all `package.json` files and the lockfile; **TypeScript hard-pinned 5.9.3** (latest is 7.0.2, but `typescript-eslint@8.72.2` peer-requires `<6.1.0`); `@types/node@22.20.5`; every other package uses today's `latest` (verified list in AGENT_STATUS §0.4). `npm audit` triaged at each wave.
- **Consequences:** reproducible installs; upgrades are deliberate ADRs.

## DEC-010 — Blueprint documents and the public repository
- **Date:** 2026-11-10 · **Status:** proposed (BL-10)
- **Context:** The repo is public; `project-blueprint/` reproduces an exam PDF marked "For examination use only · Do not redistribute". The exam also requires a GitHub repo as submission.
- **Decision (proposed):** make the repo **private until submission** (or keep `project-blueprint/` and the root blueprint copies untracked via `.gitignore`) and commit only product code + our own docs.
- **Consequences:** W0 `git add` must not include the blueprint directory until the human decides. Pushing is otherwise unaffected.

## Provisional acceptance of blueprint assumptions (A-01…A-17)
- **Date:** 2026-11-10 · **Status:** proposed (part of BL-01)
- **Decision:** treat DEVELOPMENT_HANDOVER §5 A-01…A-17 as accepted defaults (e.g. custom duration 1–480 min; ≥10 min/day for streaks; code shown only in the agent UI; outbound cloud WSS for schedules; Bearer 30-min token; consent shown every start + native first-run dialog; Linux X11 only; Safari unsupported for HTTPS dashboard; sleep accounting rules; enforcement loop default ON; BLOCK-1 needs an MV3 extension; macOS default browser protected; installers on GitHub Releases; timezone-based schedules).
- **Consequences:** these become test assertions; if the human overrides any of them, update REQUIREMENTS + this ADR before W2.

## DEC-011 — Traceability deltas found by T-003 validation (A1)
- **Date:** 2026-11-10 · **Status:** accepted
- **Context:** A1 validated the requirement traceability programmatically (blueprint-internal; PDF absent per DEC-003). The **team's** `docs/REQUIREMENT_TRACEABILITY.md` passes all 34 checks (18/18 PDF IDs, 30/30 FR, 17/17 NFR, 8/8 REC, 86 cited task IDs all real, 23 endpoints, 16 local messages, 9 collections, 13 pages). The *blueprint reference* trace doc had 10 gaps, all resolved in the team doc; none changes requirement text.
- **Delta list and disposition:**
  - D-01 FR-019 (admin) absent from reference trace → mapped to T-073/T-074/T-122 (team doc).
  - D-02 FR-021 only a heading there → mapped to T-020, T-045, T-058, T-065…T-077, T-093.
  - D-03 FR-029 absent → mapped to T-072 (+ T-040 for unpair-all).
  - D-04 REC-001 no requirement→task line → mapped to T-041/T-042/T-063/T-064/T-080.
  - D-05 REC-004 no requirement→task line → mapped to T-051/T-059/T-100/T-101.
  - D-06 REC-005 absent → mapped to T-055.
  - D-07 six `/api/v1` paths missing from reference §5 → team doc lists all 23 TD §5.2 endpoints (`/users/me/password`, `/notifications/:id/read`, `/admin/agent-links`, `/admin/stats`, `/agent/allowlist`, `/health` included).
  - D-08 NFR rows covered only as prose ranges there → team doc has 17/17 individual NFR rows with tasks.
  - **D-09 NFR-015 + submission item 1 are HUMAN-ONLY actions** (every team member must appear in git history from their own account). No AI worker can satisfy this — escalated to the human at W0; evidence will be `git shortlog -sn` plus the wave-gate hand-off lists (AGENTS §6).
  - D-10 PDF absent → all `[PDF §n]` claims remain unverifiable against the source (BL-01). Keep as open risk.
- **Consequences:** wave gates cite the team trace doc; the human-only authorship item is tracked as a release gate, not a worker task.

## DEC-012 — Answers to A3's UX-spec open questions (T-007)
- **Date:** 2026-11-10 · **Status:** accepted · **Owner:** A0
- **Q1 system font vs self-hosted Inter:** use a **system font stack** (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`). No extra font download/dependency; keeps CSP simple. `docs/UX_SPEC.md` wins in v1.
- **Q2 notifications bell wave:** bell + `/notifications` UI in **W5** (T-075, Phase 5) because the notifications API lands there. The `/schedules` missed-run toast (W4, T-063) is the interim signal. No fake bell before then.
- **Q3 FocusIndicator on public routes:** shown on **every authenticated route only** (`/dashboard`, `/focus`, `/devices`, `/allowlist`, `/schedules`, `/insights`, `/settings`, `/admin`); hidden on `/`, `/login`, `/signup`. Sessions cannot start unauthenticated, so FR-009 "always visible while focusing" is still met; documented in the UX spec by A3.
- **Q4 StartFocusCard with no agent:** **disable Start + show the reason + "No device connected — start your Focus Agent" card** (never a silent failure). Matches FR-004/FR-005 AC.
- **Q5 `/settings` v1 scope:** omit account deletion; start-at-login stays an **agent tray** toggle (REC-008) and is not a dashboard setting. Keep profile, change password, timezone, default duration, unpair-all, download links.
- **Consequences:** A4 implements the spec as written; any deviation is a UX-spec change request to A3.

## DEC-013 — Contract details frozen before W1 (from A8's T-006 findings)
- **Date:** 2026-11-10 · **Status:** accepted · **Owner:** A0 (A2 freezes in INTEGRATION_CONTRACTS/T-005)
- **API base URL convention:** `VITE_API_BASE_URL` (client) and `AGENT_API_BASE_URL` (agent) are the **full API base URL including the `/api/v1` prefix** — dev `http://localhost:5000/api/v1`, deployed dashboard `/api/v1` (relative, behind the same-origin Vercel/Netlify `/api/*` rewrite). Clients append only endpoint paths; no client or agent hard-codes `/api/v1` anywhere else (NFR-004).
- **Attestation algorithm:** **EdDSA (Ed25519)** — SEC-7 allows RS256/EdDSA; EdDSA keys are small, fast and jsonwebtoken 9.0.3 supports it. `ATTEST_PRIVATE_KEY`/`ATTEST_PUBLIC_KEY` hold single-line PEM (dotenv `\n` expansion documented). 60 s TTL, bound to nonce + aud(deviceId) + sub(userId). If T-043/T-044 hit a tooling blocker, an amendment ADR is required (no silent change).
- **Agent env loading:** add `zod@4.6.7` + `dotenv@18.0.10` to `agent/package.json` in W1 (A7 owns agent/package.json). Dev reads `agent/.env`; packaged builds use process env only; zod validates and fails fast.
- **Seed identities (exam requirement):** `admin@demo.com / Admin@123` (ADMIN) and `kabir@demo.com / Kabir@123` (USER, persona Kabir). A6's T-013 seed, `SEED_*` env vars in `server/.env.example` and A1's README must all state the same values.
- **MongoDB Memory Server on this dev machine:** requires `MONGOMS_DOWNLOAD_DIR=<repo>/node_modules/.cache/mongodb-memory-server` (the sandbox denies writes to `~/.cache`); A5/A9 must set it in the vitest setup or root test script (KI-006). CI downloads its own binary and is unaffected.
- **Consequences:** W1 workers code against these; A2's T-005 doc is the authority and any change needs the AGENTS §5 process.

## DEC-014 — C-01 resolution: pairing-code digest (two-stage, agent never holds the pepper)
- **Date:** 2026-11-10 · **Status:** accepted · **Supersedes:** the implicit derivation in TECHNICAL_DESIGN §5.1 (which is internally inconsistent: it says the agent posts `codeHmac` at `/agent/register`, while the server is expected to HMAC the user-typed code with `PAIR_PEPPER` — the agent never has that pepper, so the two values cannot match as written).
- **Context:** REC-002 needs the cloud to verify a code it never sees in plaintext, with SEC-5 "pairing code HMAC-SHA256 with server pepper, TTL 10 min, single use". The 6-digit code is shown only in the Focus Agent UI and never travels over the local channel (DEC-003/A-03). The wire field name `codeHmac` is frozen by TECHNICAL_DESIGN §5.1 and `shared/src/schemas/device.ts`; its value is a **64-char lowercase SHA-256 hex** of `"focus-mode-pair-v1|" + code` (domain-separated).
- **Decision (two-stage digest):**
  1. Focus Agent generates a 6-digit code, computes `codeHmac = SHA-256("focus-mode-pair-v1|" + code)` (hex) and calls `POST /agent/register {codeHmac, os, name, agentVersion}` over TLS.
  2. Server stores `pairTokenHash = HMAC-SHA256(PAIR_PEPPER, codeHmac)`, `pairExpiresAt = now + 10 min`, `pairAttempts = 0`, `enrollSecretHash`, and returns `{deviceId, enrollSecret}` (secret held only by the agent).
  3. User types the code on `/devices` → `POST /devices/pair {code}` (Bearer JWT). Server recomputes `codeHmac = SHA-256("focus-mode-pair-v1|" + code)`, then `HMAC(PAIR_PEPPER, codeHmac)`, finds the unique pending device, enforces TTL ≤10 min and ≤5 attempts (then invalidates the pending device), binds `ownerId`, clears `pairTokenHash`, and issues the device token (hash stored only).
  4. The dashboard's local `paired` message is only a nudge; the agent learns of success by polling `POST /agent/enroll/poll` and receives the device token exactly once (not through the browser).
- **Why this is safe enough:** the plaintext code never crosses the local channel or the wire; the stored value is peppered so a DB leak without the pepper cannot brute-force the 10^6 space; TTL + attempt limit + per-user/per-IP rate limits bound online guessing; codes are single-use. Residual risk documented in `docs/SECURITY_REVIEW.md` (a compromised TLS endpoint could see the agent's digest and brute-force 10^6 hashes offline — accepted because codes are short-lived and worthless after single use).
- **Rejected alternatives:** agent sends plaintext code to server (violates REC-002/A-03 intent, leaks code); server generates the code and returns it to the agent (simpler but contradicts the frozen blueprint flow/REC-002 and the already-frozen contract); HMAC with `enrollSecret` as key (server keeps only its hash, so it cannot recompute the lookup value later).
- **Consequences:** A5 (T-040) implements register/pair/poll with this derivation; A7 (T-042) computes the domain-separated SHA-256 in the agent; a contract test in W2 must prove agent-register digest + user-typed code resolve to the same pending device and that a 6th attempt invalidates. Frozen in `docs/INTEGRATION_CONTRACTS.md` §12 (C-01).
