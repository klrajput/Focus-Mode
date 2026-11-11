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

## DEC-015 — W1 implementation decisions (client transport, local-channel errno, CI security tooling)
- **Date:** 2026-11-10 · **Status:** accepted · **Owner:** A0
- **Client HTTP transport = typed `fetch` wrapper, not axios.** TECHNICAL_DESIGN §3 said "axios instance"; axios was deliberately not installed (PLUGINS_AND_TOOLS §2 lists it as part of the frontend stack but the pinned dependency set from T-001 did not include it). A4 implemented `client/src/api/http.ts` as a typed fetch transport with identical contract semantics: full base incl. `/api/v1` (DEC-013), Bearer token, `{success,data}` unwrap, `{success:false,error}` → `ApiError{code,status,message,details}`, 401 → session expiry only for authenticated requests, abort passthrough. One dependency fewer = easier viva and smaller bundle. Swapping to axios later would touch one file; not planned.
- **Login 401 copy is provisional.** `docs/UX_SPEC.md` has no string for a 401 on `POST /auth/login`; the client uses "Email or password is incorrect." A3 must ratify it (or supply the official string) in the W2 UX review. No other copy deviates.
- **Local-channel oversized frame close code.** `docs/INTEGRATION_CONTRACTS.md` §4.2 says close `1008` for violations, but the `ws` library's `maxPayload` (16 KB) closes with `1009` (message too big). Behaviour is correct (fail closed, disconnect); A2 will amend §4.2 to document `1009` for oversized frames in the contracts-v1.1 pass. The dashboard must treat both as "disconnected".
- **Typed REST *response* schemas (A2's C-04) deferred** to contracts-v1.1 (post-W2). W1 clients hand-type response bodies in `client/src/api/types.ts`; request bodies already use the shared zod schemas. Not a release blocker.
- **CI secret scanning uses the checksum-pinned official gitleaks CLI, not `gitleaks/gitleaks-action`.** The pinned action v3.0.0 exposes no config-file input (only license/version/summary flags), so it ignored the reviewed `.gitleaks.toml` allowlist and failed on intentionally-public values. The workflow now downloads gitleaks v8.30.1 `linux_x64` from the official release, verifies its published sha256, and runs `gitleaks git --config .gitleaks.toml`; the scan remains fully enabled. Locally reproduced: full-history scan with the allowlist → **no leaks** (the one finding was a fake `JWT_SECRET` in `server/vitest.config.ts`, now an explicit `CHANGE_ME_*` placeholder and the test-fixtures path is allowlisted).
- **`.gitattributes` `* text=auto eol=lf`** (A0 fix): the Windows CI runner checked out CRLF, making `prettier --check` fail on every file. Cross-platform requirement (NFR-005/CI matrix).
- **`@focus-mode/shared` workspace links + `pretypecheck`/`pretest` hooks** (A0 fix): without a declared workspace dependency and a pre-build of `shared` (which resolves to `dist/`), CI `typecheck`/`test` failed with "Cannot find module '@focus-mode/shared'". Root scripts now build `shared` before typecheck/test; `--passWithNoTests` keeps per-branch CI honest where a workspace has no tests yet (it never masks failures when tests exist).

## DEC-016 — Attestation JWT: EdDSA (Ed25519) implemented with `node:crypto`, not `jsonwebtoken` (amends DEC-013)
- **Date:** 2026-11-10 · **Status:** accepted · **Amends:** DEC-013 (attestation algorithm). **Algorithm is unchanged — only the library claim in DEC-013 was wrong.**
- **Context:** DEC-013 stated that `jsonwebtoken@9.0.3` supports EdDSA. A5 verified against the installed package that this is **false**: `node_modules/jsonwebtoken/sign.js` defines `SUPPORTED_ALGS = ['RS256','RS384','RS512','ES256','ES384','ES512','HS256','HS384','HS512','none']` (plus PS\*), and `jws` has no EdDSA support. Calling `jwt.sign(..., {algorithm:'EdDSA'})` throws `"algorithm" must be a valid string enum value`. No dependency may be added just for this (keep viva surface small; no new packages without review).
- **Decision:** the attestation remains an **RFC 8037 EdDSA JWT with Ed25519 keys** — header `{"alg":"EdDSA","typ":"JWT"}`, payload `{sub: userId, aud: deviceId, nonce, iat, exp: iat+60, iss: 'focus-mode-api'}`, signature = `base64url(crypto.sign(null, headerB64 + "." + payloadB64, privateKey))`. Server signs and agent verifies with **`node:crypto`** (`createPrivateKey`/`createPublicKey`, `crypto.sign`/`crypto.verify` with `null` algorithm for Ed25519). `jsonwebtoken@9.0.3` is used only for the HS256 user access token (SEC-2), exactly as before. Any standard JOSE library can verify the attestation (wire format is standard); our own tests verify signatures with independent `node:crypto` calls, not with the signer's code path.
- **Consequences:** A5 (T-043) signs via node:crypto; A7 (T-044) verifies via node:crypto (already instructed in task-14); A2 records the implementation note in `docs/INTEGRATION_CONTRACTS.md` §5.2/§6; A9 cites the verified claim in `docs/SECURITY_REVIEW.md` (SEC-7 still satisfied: EdDSA, 60 s TTL, nonce+aud+sub bound). No dependency change; no wire-format change for clients that just pass the token through.

## DEC-017 — Pairing attempt limiting is a per-user latch (SEC-5 clarification, C-14)
- **Date:** 2026-11-10 · **Status:** accepted · **Context:** SEC-5/FR-026 require "≤5 attempts per code, then invalidation". With DEC-014's digest lookup the server never knows which pending device a *wrong* code was meant for (the peppered digest is the lookup key and a non-matching digest identifies nothing), so per-code attempt counters are not implementable in the plaintext-free design.
- **Decision:** implement attempts 1–5 as `400 INVALID_PAIRING_CODE` and the 6th+ attempt as `410 PAIRING_EXPIRED`, latched **per authenticated user** for the 10-minute code TTL (server-side), on top of the existing rate limits (10/min/user on `/devices/pair`, 5/min/IP on `/agent/register`, public registration throttled). Correct codes from other users are unaffected. This is the reading documented in INTEGRATION_CONTRACTS C-14; A2 documented the shipped behaviour.
- **Residual risk (accepted, to be re-verified by A9 in W6):** an attacker who registers many accounts could try more than 5 codes overall; mitigated by account-creation rate limits, the 10-minute TTL, single-use codes, and the 6-digit space. No requirement text changes.
- **Consequences:** tests assert the 5→400 / 6th→410 latch; Security review documents the residual risk; if the graders require strict per-code semantics, the mitigation is a global pending-device attempt counter keyed by a coarse code-prefix bucket (documented, not implemented).

## DEC-018 — W2 known drift deferred to W3 (copy + refresh consistency)
- **Date:** 2026-11-10 · **Status:** accepted · **Context:** A3's W2 UX review found 14 internal milestone/task-jargon strings rendered to users on 8 routes (HIGH; UX_SPEC §12.2) and A8's E2E found the badge does not update after pair/unpair without a reload (FR-004 no-refresh gap; KI-010).
- **Decision:** both are **W3 tasks for A4/A7**, not W2 blockers: W2's gate is "dashboard pairs a real agent against the real server, badge live" — which A8's E2E proved for the initial-connect path (with the reload caveat documented in KI-010). Fixes are tracked as F-01 (copy, 14 strings) and the paired-nudge re-handshake path; W3's focus UI work touches the same components, so bundling avoids churn.
- **Consequences:** W2 gate records the refresh gap as an open High issue; W3 must close F-01 + KI-010 before the W3 gate; release cannot ship with user-visible milestone jargon.

## DEC-019 — W3 API additions and frozen-contract clarifications (C-15…C-18)
- **Date:** 2026-11-10 · **Status:** accepted · **Owner:** A0 (A2 to record in INTEGRATION_CONTRACTS)
- **C-15 `GET /api/v1/sessions/active` (USER)** added: returns `{session: Session|null}` for the user's current ACTIVE session (dashboard refresh after reload / link reconnect). Not in the frozen 41-operation table; **keep and document**, it uses only frozen response shapes.
- **C-16 `POST /api/v1/allowlist/preset/:id?mode=merge|replace`** added (default merge): applies an admin preset to userApps while filtering protected apps and never touching `protectedApps`; **keep and document** (T-061/FR-020 AC requires preset application; the frozen doc listed presets read-only only).
- **C-17 `GET /sessions` filters** stay exactly the frozen set `page,limit,sort,search,from,to,status,source` (no `deviceId` filter — adding it would need a shared-schema change; not required by any AC). Clients must not send `deviceId`.
- **C-18 `GET /schedules` ordering:** implemented as `startTime asc, _id asc` (useful for the schedules UI) rather than the generic `createdAt desc` convention; **accepted** and documented as a per-resource sort. Replayed `POST /sessions` (same `clientSessionId` and same body) returns **200** with the original session while the first create is **201** — contract row updated to list both; clients treat both as success.
- **Consequences:** A2 updates `docs/INTEGRATION_CONTRACTS.md` §3.1/§3.2 + §12 in the next contracts pass; client must not add a `deviceId` filter; no other W3 deviation found (all other routes/flags/status codes match the frozen contract — A5 verified).

## DEC-020 — W3 real-OS verification stance, and the W3 integration bug found at the gate
- **Date:** 2026-11-10 · **Status:** accepted
- **Real-OS evidence (macOS, P0):** `scripts/verify/macos-focus-smoke.ts` drives the REAL `FocusController` + REAL `DarwinDriver` on this machine: hides its own TextEdit instance, verifies the hide from a **separate** osascript process (DEC-005), clears the journal, proves a second `exitFocus` is a no-op, restores and verifies the restore. Result `PASS darwin/arm64`. This is the FOCUS-1/FOCUS-2 evidence for the demo OS; the full Phase-8 checklist (tray clicks, sleep/resume on a physical laptop, installer) remains T-101 NEEDS-HUMAN.
- **Windows (T-052) / Linux X11 (T-054):** implemented behind the frozen `FocusDriver` and exercised by the mocked-native contract suites (24 + 23 tests) and CI on `windows-latest`; **runtime window control is unverified** (no such desktops here) → stays NEEDS-HUMAN for T-100/T-102. Linux Wayland honestly reports `capabilities.focus='unsupported'`; the dashboard blocks Start.
- **Integration bug found by the W3 E2E gate (fixed):** `agent/src/main.ts` declared the late-bound `link` handle and broadcast `focusStarted`/`focusEnded` through `link.server?.broadcast(...)` but never assigned `link.server = linkServer`. The controller/journal correctly entered FOCUSING while no dashboard ever received a lifecycle frame (E2E: URL stayed /dashboard, no ACTIVE session). Root cause fixed, plus a static wiring tripwire in `hardening.test.ts` so it cannot regress silently. This is why the gate runs E2E against the merged app, not only unit suites.
- **Carried into W4 (not release-blocking yet, but must close before the W4 gate):** KI-010 (High) is only partially fixed — badge refreshes without reload after *unpair*, but still requires a reload after *pairing* (the provider must re-handshake when the agent reports PAIRED / re-issues a challenge on an unauthenticated socket). Owner A4 + A7; DEC-018's requirement to close it before the W3 gate was not fully met and is explicitly recorded here instead of being hidden.

## DEC-021 — Schedule-run lifecycle contract (cloud → agent → cloud) and the agent allow-list fetch
- **Date:** 2026-11-10 · **Status:** accepted · **Owner:** A0 (implemented by A2/A5/A7)
- **Context:** FR-012/FR-025 need a scheduled session that starts while no dashboard is open, a cancellable heads-up, and honest run records (STARTED / MISSED / CANCELLED_BY_USER). The frozen protocol only had cloud→agent `scheduleDue` and agent→cloud `session.started/ended` with no way to link a run to a session or report a cancellation.
- **Decision (additive, backward-compatible):**
  1. Scheduler tick sends `scheduleDue {runId,scheduleId,durationMin,allowListVersion}` and creates `ScheduleRun(STARTED)`; it is idempotent per local minute via `Schedule.lastRunAt`.
  2. The agent fetches the user's allow-list for the scheduled start via **`GET /api/v1/agent/allowlist`** (device-token auth; returns `{protectedApps,userApps,version}`) — new endpoint C-20.
  3. The agent shows a native **≥10 s cancellable heads-up**; cancel → new agent→cloud message **`scheduleRunCancelled {runId, at}`** → run `CANCELLED_BY_USER`; accept/timeout → `controller.enterFocus(source:'SCHEDULE', …)` (REC-004 consent still applies) → agent→cloud `session.started {…, source:'SCHEDULE', scheduleRunId}` links the session to the run and confirms it.
  4. Offline device at due time → `ScheduleRun(MISSED)` + `Notification`, never a forced start. A STARTED run with no linked session 2 minutes after dispatch → `MISSED` + notification by a sweeper/reaper.
- **INV-2 unchanged:** cloud→agent remains exactly `[scheduleDue, revoked]`; the two additions are agent→cloud only (asserted by shared tests).
- **Consequences:** cloud channel is now 6 messages (4 agent→cloud, 2 cloud→agent); local channel unchanged (16). INTEGRATION_CONTRACTS C-19/C-20, `shared/src/protocol.ts` + tests, server scheduler/reaper/reporting and the agent schedule flow all cite this ADR.

## DEC-022 — W4 gate exceptions and evidence scope
- **Date:** 2026-11-11 · **Status:** accepted
- **Passed:** scheduled-session round-trip is proven end-to-end on the real scheduler (E2E: create → minute tick → `scheduleDue` → agent ≥10 s heads-up → source SCHEDULE focus → run recorded → session persisted; server unit tests cover offline MISSED + notification and stale-run sweep; agent 495 tests; dashboard-closed reporting E2E proves FR-027/REC-006 with exactly one finalised session).
- **Exception 1 (honest skip):** the missed-run **E2E** self-gates until `GET /api/v1/notifications` is merged in W5 (T-075). The MISSED path itself is implemented and covered by `server/src/test/{scheduler,reaper,schedule-run}.test.ts`; no REST surface exists yet to assert the notification from Playwright.
- **Exception 2 (NEEDS-HUMAN / KI-013):** native tray menu clicks and OS notification visuals cannot be driven/read by Playwright `_electron`; the equivalent controller path is covered by the agent-window End Focus E2E, but the literal tray click + banner appearance remain on the Phase-8 checklist.
- **Bonus (W8 evidence landed early):** release workflow dispatch `42858934575` produced **real unsigned installers** for Windows (NSIS + portable), macOS arm64/x64 (dmg + zip) and Linux (AppImage + deb) via native GitHub runners, with **4/4 `AGENT_SMOKE` jobs green** and **zero GitHub Releases created** (tag-only guard intact). Signing/notarisation, tag publishing and installer-level launch remain NEEDS-HUMAN/unverified and are documented in `docs/RELEASING.md`.

## DEC-023 — W4/W5 UX review ratifications and fix routing (A3 §13)
- **Date:** 2026-11-11 · **Status:** accepted · **Owner:** A0 (review by A3)
- **Ratifications (R1–R7, spec amended by A3 in `docs/UX_SPEC.md` §5/§13):**
  - **R1:** the "first focus on this device" consent sentence is agent-side only in v1 — the dashboard cannot read agent-local consent state (no contract field, and faking it after the first session would be dishonest); the native REC-004 dialog remains the gate. Ratified.
  - **R2:** consent modal title stays `Start a {duration}-minute focus session?` (E2E-locked by A8's focus spec). Ratified.
  - **R3:** `/focus` "Stays open" shows the fixed protected categories + allow-listed app labels (no stepped-aside count because the frozen contract exposes no such field — honest omission). Ratified.
  - **R4:** W4 operational copy additions (schedule next-run line, timezone labels, per-widget retry) are acceptable. Ratified.
  - **R5:** streak display lives on `/insights`, not `/dashboard` (dashboard keeps Today/next/recent). Ratified.
  - **R6:** new notification UI copy ("No notifications yet.", unread count wording) approved. Ratified.
  - **R7:** countdown ring stroke is viewBox-scaled (responsive) rather than a fixed px token. Ratified.
- **Fixes routed:** **F-101 (MED, safety-adjacent)** — StartFocusCard must not send `enterFocus` while the allow-list query is pending/failed (would send `userApps: []` and tell the user "none yet" when the truth is "unknown") → **A4, before the W5 gate**; F-102…F-109/F-111/F-113 copy/a11y fixes → A4 next wave; **F-110** (no NFR-006 Playwright viewport `scrollWidth` spec exists) → A8 (W5/W7 E2E); F-112 re-review W5 pages after merge → A3 at the W6 gate.
- **Consequences:** W5 gate requires F-101 fixed + W5 pages reviewed; F-110 is an explicit W7 test requirement; the review's PENDING rows are re-checked after the W5 merge (not treated as passes).

## DEC-024 — W5 gate evidence and remaining scope
- **Date:** 2026-11-11 · **Status:** accepted
- **Passed:** all P0/P1 pages are now real and E2E-verified on merged `main` — insights (seeded totals match API; empty state), notifications bell (real unread count and mark-read), admin (users table + aggregate stats match API; USER blocked in UI and API; deactivate/reactivate via real UI), settings (password change semantics, unpair-all with agent revocation, real download links), landing, plus the previously-passed focus/pairing/schedule/session-reporting suites. The **missed-run E2E is un-gated and green** (offline at due time → MISSED run + notification, no focus). 27/27 Playwright tests, 0 skipped; 1128 unit tests; lint/format/typecheck/build clean.
- **MED safety fix applied at the gate:** F-101 — StartFocusCard could send `enterFocus` with `userApps: []` while the allow-list query was pending/failed; now blocked with visible reasons ("Loading your allow-list…", "Couldn't load your allow-list. Retry before starting focus.") and two regression tests. Recorded as A0 hotfix per DEC-023 routing.
- **Known limits carried (unchanged):** Windows/Linux **runtime** window control (KI-005, NEEDS-HUMAN T-100/T-102); native tray menus + OS notifications not Playwright-automatable (KI-013, NEEDS-HUMAN Phase-8); headless agent has no renderer window (KI-009); signing/notarisation + tag publishing + installer-level launch NEEDS-HUMAN; F-102…F-113 UX polish (copy/a11y/targets) queued for W6; C-21…C-24 contract additions pending A2 fold-in.
- **Consequences:** W6 starts from a fully wired product surface; no P0/P1 page is a placeholder any more. W6 must not change frozen contracts without the AGENTS §5 process.


## DEC-025 — W6 gate: security posture, measurable targets, and the test-only rate-limit knob
- **Date:** 2026-11-11 · **Status:** accepted
- **Security:** A9's independent adversarial pass ran 148 checks against the real stack and reported **no Critical and no High** findings. The three Medium findings were fixed in `439792b` and re-verified on the final tree (`docs/SECURITY_REVIEW.md` §8): malformed ObjectId path params now 404 via a central CastError/BSONError mapping + safe parsers; the forbidden-key walk is iterative so 4k–20k-deep JSON answers 400 instead of overflowing the stack; and deactivation now revokes device tokens/agents, refuses agent session reports, and skips the user's schedules (no dispatch, no MISSED spam). Server-side single-use attestation nonce caching is added as defense-in-depth (**C-26**). Remaining: KI-018 (enroll-poll state oracle, Low), KI-019 (stateless token TTL, accepted risk), KI-021 (gitleaks `*.md` allowlist, Low) — all documented, none Open High.
- **Measurable targets:** NFR-011 API latency measured at **p95 7.22 ms worst case** (300 ms target, loopback) and unit coverage **≥80 % lines in every package** (`shared` 100, `server` 89.44, `client` 80.70, `agent` 88.63) — both pass. NFR-006 viewport and NFR-008 accessibility now have automated proof (Playwright no-horizontal-scroll spec; axe-core 0 violations across 11 routes).
- **Test-only knob:** `POST /agent/register` keeps its **frozen 5/min/IP contract default** in production, but the limit is now read from a validated `RATE_LIMIT_AGENT_REGISTER_MAX` env knob so the E2E suite (which launches several real agents from 127.0.0.1 within one minute) does not trip its own production limiter. This is **not** a contract change: the default and the security property are unchanged; only the automated suite overrides it.
- **Consequences:** W7 is test-consolidation and quality only (coverage gaps in the win32 driver/duplicate-key branches, route-level code split for the ~1 MB client bundle, flake hardening, full-history secret scan); W8/W9 can then produce the human-verification handoff and deployment/release docs from a stable, hardened tree.


## DEC-026 — W7 quality gate: measured coverage, accessibility, bundle and supply chain
- **Date:** 2026-11-11 · **Status:** accepted
- **Coverage:** the W7 gate raised real coverage with behaviour tests only (no line-painting): unit/integration **1421** tests (server 450, client 251, agent 545, shared 175; +217) and lines/branch now `shared` 100/95.45, `server` **94.31/85.07**, `client` **87.45/79.09**, `agent` **93.13/81.70** — every package is above the TECHNICAL_DESIGN §14 80 %-lines target. The W7 test work also found and fixed **three real product bugs**: the Windows driver's restore identity check never resolved the executable for iconic windows (every restore was a silent no-op), `session-id` could propagate a throwing `crypto.randomUUID` instead of its documented fallback, and the preset dialog never rendered the array-level "App keys must be unique" error.
- **Accessibility:** a real-browser axe run (colour contrast enabled) over 14 routes found 0 violations after three source fixes: landing/download accessible names, the Insights chart's `aria-hidden` wrapper around focusable Recharts nodes (now `role="img"` + data-bearing label), and the account-menu accessible name (`aria-label` removed in favour of a content-derived name + sr-only suffix, because axe's visible text for the trigger is `KKabir` with no separator). jsdom axe tests remain the fast gate; the Playwright spec is the authoritative one.
- **Bundle:** route-level `React.lazy` + Vite/Rolldown vendor groups cut the entry chunk **−83.6 % raw / −83.3 % gzip** and the eager first load **−45.0 % / −41.6 %**, with no chunk over 500 kB (Recharts isolated to the `/insights` chunk). Total bytes across all chunks are ~flat (+0.9 %) — the win is that no page downloads everything.
- **Supply chain:** KI-021 closed by removing the blanket Markdown exemption from `.gitleaks.toml`; the CI secret scan now runs on every push and PR over the **full reachable history** (`fetch-depth: 0`, `gitleaks git`), proven on a real push: 140 commits reachable / 104 scanned / 3.75 MB / no leaks.
- **Packaging:** installer-level smoke is now real: release dry-run `42977816541` booted the packaged app on macOS arm64/x64, Linux (`squashfs-root`) and Windows (`win-unpacked` payload) after the NSIS silent-install path proved unusable in a non-interactive runner; 4/4 builds, fuses/asar gates and 4/4 source smoke green, **0 releases** (tag-only guard intact).
- **Consequences:** the product and its evidence are complete for the exam handoff; remaining work is human-gated (Windows/Linux runtime verification, native tray/notifications, signing/notarisation, first `v*` tag, live deployment) plus the W10 P2 decision and the C-26 contract fold-in.

## DEC-027 — W10 P2 bonus scope: ship T-133 (badges/goals), descope T-130/T-131/T-132
- **Date:** 2026-11-11 · **Status:** accepted · **Owner:** A0 (with A4/A5)
- **Shipped — T-133 GAMIFY-1 (partial):** `/insights` gains achievement badges and a **device-local** weekly goal, both derived from the real `GET /insights` payload plus a `localStorage` preference (no new API, no fabricated progress, clearly labelled "stored on this device"). Leaderboard/opt-in comparison between users is **not implemented**: it would require new profile fields, a public ranking endpoint and consent copy — a new privacy surface this late in the exam cycle, so it is explicitly out of scope rather than half-built.
- **Descoped — T-130 (MV3 extension + block-list UI):** a second distributable (Manifest V3 extension) with its own permission model, messaging and release artifact; it is not required by any P0/P1 requirement, would need a new CI/release lane and a security review of extension permissions, and would not be verifiable on the remaining human-gated OS matrix. Descoped by risk budget, not silently dropped.
- **Descoped — T-131 (pomodoro cycles/ambient sounds):** bundles third-party audio assets (licensing/provenance risk) and changes the focus session lifecycle (breaks/restores) that the frozen scheduler/session contract and journal model were built around; the P1 focus flow is verified and stable, so this stays out rather than destabilising it.
- **Descoped — T-132 (remote multi-device start):** starting focus on another machine would require **cloud→agent control messages**, which INV-2 forbids by design (cloud→agent is exactly `[scheduleDue, revoked]`). FR-017's intent (manage multiple devices, per-device sessions) is already met by the Devices page and per-device session records; a remote-start picker is therefore a design change, not a bonus.
- **Consequences:** the P2 table in `docs/REQUIREMENT_TRACEABILITY.md` shows T-133 as partially delivered (badges/goals, no leaderboard) and T-130/T-131/T-132 as descoped with this ADR. No objective-critical deliverable depends on them; README/RELEASE_NOTES must not claim the descoped items.


## DEC-028 — W8/W9/W10 close-out: final evidence, remaining human gates, and the §1.9 documentation gap
- **Date:** 2026-11-11 · **Status:** accepted · **Owner:** A0
- **Final verified state (main `970e22c`):** unit/integration **1442** (shared 175 / server 450 / client 272 / agent 545) · Playwright **50/50** (7.5 m, retries 0) · real macOS FOCUS-1/2 `PASS darwin/arm64` (real hide → separate-process verify → restore → journal cleared) · `PASS AGENT_SMOKE` on the built Electron agent · release dry-run `42977816541` = 4/4 builds + fuses/asar gates + 4/4 source **and** 4/4 packaged-artifact smoke with **0 GitHub Releases** · CI `42984810565` green on ubuntu-24.04/macOS/Windows **and** full-history gitleaks · route-split bundle (entry −83.6 % raw) · axe 0 violations on 14 routes · 159 commits, 69 feature/fix branches merged, every commit by the human author email with **no AI/tool trailers**.
- **Contract close-out:** C-26 (server-side attestation-nonce replay cache, 409 CONFLICT) folded by A2 with a W7 review sign-off and 36/36 consistency checks. A2's review also found that §1.9 documents only 4 rate-limit families while W6 shipped 8+ (insights/notifications/users/sessions/admin/public/api + the register knob). This is a **documentation-only gap with no wire change**, so it is recorded here rather than expanded unilaterally in the frozen table; the shipped values are in `server/src/config/env.ts`, `server/src/middlewares/rateLimit.ts`, `docs/DEPLOYMENT.md` and QA_REPORT. A future contract pass can fold it as C-27 if required.
- **W8/W9/W10 result:** all submission artefacts exist and are evidence-anchored (README, PROMPTS, VIVA_NOTES, QA_REPORT, RELEASE_NOTES, DEMO_SCRIPT, QA_CHECKLISTS, PLATFORMS, SECURITY_REVIEW, RELEASE_HANDOFF); deployment configs are placed (`render.yaml`, `vercel.json`) with a live-deploy runbook; unsigned installers for Windows/macOS/Linux were really built and verified. W10's only shipped bonus is T-133 partial (badges + device-local weekly goal); T-130/T-131/T-132 are descoped per DEC-027.
- **Remaining human-gated (not defects, explicitly NEEDS-HUMAN):** real Windows 10/11 and Linux X11 runtime window control (T-100/T-102), native tray/consent/notification visuals (KI-011/KI-013), headless agent window (KI-009), signing/notarisation (T-114 runbook ready, certs human), first `v*` tag + draft-release publish (T-128), admin agent-link publication to release assets (T-122), live Vercel/Render/Atlas deployment with human accounts (T-120/T-121), and the demo recording (T-126).
- **Consequences:** the agent-verifiable objective is complete. Nothing in the repo claims a released tag, a live deployment, signed binaries, or verified Windows/Linux runtime behaviour; those are tracked exactly where a human can execute them.
