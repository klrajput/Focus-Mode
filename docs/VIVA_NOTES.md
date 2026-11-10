# VIVA_NOTES.md — per-module viva preparation (draft)

> **Owner:** A1 (draft) · **Task:** T-125 (`[PDF §19]` / `[PDF §1.4]` viva rule) · **Status:** **DRAFT for W9** — every human team member must read their own modules and be able to explain them in ~60 seconds without help. This file is a study aid, **not** a substitute for reading the code.
> **The 60-second formula** used below: **purpose** (what it is) → **key decision + ADR** (why this way) → **tricky bit** (the thing that can bite) → **how to demo** (one command or one screen).
> **Ground rules for the viva:** never claim what is not verified; say "NEEDS-HUMAN" when a real desktop is required; cite `docs/PLATFORMS.md` §7 for the Phase-8 status. Do not read secrets on screen.

**Module ownership for the hand-off** (AGENTS §2 — each person explains their own slice):

| Area | Owner | Files |
|---|---|---|
| Contracts / protocol / schemas / protected set | A2 | `shared/src/**` |
| Server: auth, pairing, attestation, sessions, allow-list, schedules, scheduler, reaper, insights, admin, hub | A5 (+A6 models) | `server/src/**` |
| Dashboard: routing, pages, AgentLink, focus UX | A4 (+A3 styles/UX) | `client/src/**` |
| Focus Agent: lifecycle, link, cloud client, controller, journal, consent, drivers, UI | A7 | `agent/src/**` |
| Integration / E2E / known issues | A8 | `e2e/**`, `docs/KNOWN_ISSUES.md` |
| QA / security | A9 | tests, `docs/QA_REPORT.md`, `docs/SECURITY_REVIEW.md` |
| Release / CI | A10 | `.github/**`, `agent/electron-builder.yml`, `docs/RELEASING.md` |
| Requirements / docs | A1 | `README.md`, `docs/REQUIREMENT_TRACEABILITY.md`, `docs/PLATFORMS.md` |

---

## 1. `shared/` — the frozen contract

### 1.1 `protocol.ts` — two channels, one schema
- **Purpose:** the only definition of every message on both channels: dashboard↔agent local WS (16 messages) and agent↔cloud WSS (6 messages after DEC-021: 4 up/2 down). Every message carries a `{v:1, id}` envelope + `type` discriminator; strict objects reject unknown fields.
- **Key decision:** **the 6-digit pairing code never appears in any local-channel message** — any page that can reach `127.0.0.1` must not be able to read it (DEC-003, assumption A-03). The agent shows the code only in its own window; the protocol test scans the schema keys to enforce this.
- **Tricky bit:** INV-2 is structural — the cloud→agent union contains only `scheduleDue` and `revoked`; type guards make a "cloud says enterFocus" message impossible to express.
- **Demo:** `npm test -w @focus-mode/shared` → 175 tests incl. the "code never in local protocol" assertion.
- **Likely questions**
  1. *Is the pairing code sent to the server?* No plaintext ever. The agent sends `SHA-256("focus-mode-pair-v1|" + code)` as `codeHmac` (64-char hex); the server stores `HMAC-SHA256(PAIR_PEPPER, codeHmac)`. The user's typed code goes to `POST /devices/pair`, where the server recomputes the same chain (DEC-014).
  2. *Why not share one message type list for both channels?* Different trust domains: the local channel is browser↔agent (attestation-gated), the cloud channel is agent↔server (device-token-gated). Keeping them separate is how INV-2 stays provable instead of aspirational.
  3. *What happens if a new field is added without touching the schema?* The message is rejected (strict zod objects) — NFR-013 least-data by construction.

### 1.2 `schemas/` — single source of validation
- **Purpose:** every REST request body is validated on the **server** and the same schema powers client form validation; strict objects reject extra fields.
- **Key decision:** one zod schema per payload shared by both sides (NFR-001); no hand-rolled duplicate validation (DEC-013 conventions).
- **Tricky bit:** query params (pagination/sort/filters) are separate schemas — they must stay in sync with the server's list contract (NFR-009).
- **Demo:** break a request with an extra field or wrong type → `400 VALIDATION_ERROR` with `details[]`.
- **Likely questions**
  1. *Where is the "no operator injection" defence?* Server middleware strips `$`/`.` keys and schemas are strict zod (SEC-9); `{"email":{"$ne":null}}` is a 400, covered by tests.
  2. *Do the client and server really share the code?* Yes — `@focus-mode/shared` is a workspace package; both import the same schema module, so validation can't drift.

### 1.3 `protected.ts` — the set that can never move
- **Purpose:** hard-coded protected-app set per OS: 9 browsers, the Focus Agent itself, and OS-critical processes (Task Manager/Activity Monitor, Finder/Dock, Explorer/dwm, GNOME/KDE shells…). The server seeds it into `allowlists.protectedApps`; the agent merges runtime additions (OS default browser, DEC-006).
- **Key decision:** INV-3 — protected entries are never removable and never get a minimise/hide call, because focus must stay reversible (you must always be able to kill a stuck agent / use your browser).
- **Tricky bit:** matching is per-OS identifiers (`exe`, bundle id, WM_CLASS), never by window title; the default browser may be none of the hard-coded nine, so the agent resolves it at start (DEC-006, spike S-3).
- **Demo:** `/allowlist` shows locked rows; `PUT /allowlist` that removes one → `400 PROTECTED_ENTRY`.
- **Likely questions**
  1. *Could a user re-add a browser under a different key?* No — shadowing is rejected by key **or** by executable/bundle identifier.
  2. *What if the user's browser isn't in the list?* The OS default browser is resolved at agent start and added to the runtime protected set (DEC-006); failure to resolve is non-fatal because all known browsers are already protected.
  3. *Why protect Task Manager?* So a stuck agent can always be killed — INV-5's escape hatch.

---

## 2. `server/` — the cloud API

### 2.1 `services/auth.service.ts` — accounts
- **Purpose:** register/login; bcrypt cost 12, HS256 access token (30 min), `isActive` → 403 `ACCOUNT_DISABLED`, no user enumeration (same 401 for unknown email and wrong password).
- **Key decision:** role is never accepted from a request — registration always creates `USER`; the request schema has no role field (FR-001/FR-019). Password hashes are `select:false` and no response contains them.
- **Tricky bit:** rate limits (`RATE_LIMIT_AUTH_MAX`, default 10 failed auths/15 min/IP) are middleware, not business logic — the 11th attempt must be a 429, not a 401.
- **Demo:** `curl` login → token; 11 wrong attempts → 429; USER token on `/admin/*` → 403.
- **Likely questions**
  1. *Where is the JWT stored client-side?* In memory with `sessionStorage` re-hydration (DEC-013/A-06); no httpOnly-cookie complexity because the dashboard uses a same-origin `/api/*` rewrite (see DEPLOYMENT.md).
  2. *How do you know bcrypt cost 12 is used?* Pinned in code and asserted by an auth test; `package.json` pins bcryptjs 3.0.3 (SEC-1).

### 2.2 `services/pairing.service.ts` — the REC-002 three-step flow
- **Purpose:** agent pre-registers a digest → user types the 6-digit code → agent polls once for its device token. Only hashed values are stored.
- **Key decision:** **DEC-014 two-stage digest** — agent computes `SHA-256("focus-mode-pair-v1|"+code)`; server stores `HMAC-SHA256(PAIR_PEPPER, codeHmac)`; then user's code goes through the same chain to find the pending device. The cloud verifies a code it never sees, and the agent never holds the pepper.
- **Tricky bit:** attempt limiting can't be per-code (the server can't map a wrong digest to a device) → **DEC-017 per-user latch**: attempts 1–5 → 400, 6th+ → 410 for the rest of the TTL. TTL = 10 min, single use; the device token is minted only at the agent's enroll poll, never delivered to the browser.
- **Demo:** wrong code → inline error; re-use → 410; the DB stores only hashes (`pairTokenHash`, deviceTokenHash, enrollSecretHash).
- **Likely questions**
  1. *Could an attacker brute-force the 6 digits?* Online: rate limits + 10-min TTL + the attempt latch bound guesses (≈5/code/user plus account-creation limits); at rest: a DB leak without `PAIR_PEPPER` cannot verify guesses. Residual risk is documented in DEC-014 (compromised TLS endpoint → offline 10⁶ search, but codes are short-lived and worthless after single use).
  2. *Why not let the server generate the code and send it to the agent?* Simpler, but contradicts the frozen blueprint flow/REC-002 and would put the code on the wire; DEC-014 documents the rejected alternatives.

### 2.3 `services/attestation.service.ts` — proving the caller is the owner
- **Purpose:** issues a 60-second, nonce-bound JWT proving "this dashboard page acts for the device's owner" so the local agent can accept `enterFocus`/`exitFocus`.
- **Key decision:** **EdDSA (Ed25519) via `node:crypto`** — RFC 8037 JWT, `sub`=userId, `aud`=deviceId, `nonce`, `exp`=iat+60 (SEC-7, REC-003). **DEC-016:** implemented with `node:crypto` because `jsonwebtoken@9.0.3` actually rejects EdDSA (verified in the installed package); no extra dependency.
- **Tricky bit:** the agent verifies signature **and** claims (aud, sub == paired owner, nonce match, exp ≤60 s) and the challenge nonce is single-use; a hostile page can reach the port but cannot get a valid attestation.
- **Demo:** `POST /api/v1/devices/:id/attest {nonce}` → JWT; the agent's link integration tests reject wrong nonce/expired/other-user.
- **Likely questions**
  1. *Why not just check the Origin header?* Origin/Host checks stop hostile pages from opening the socket at all (NFR-010), but a local process can spoof headers; the attestation binds control to the signed-in user + paired device (defence in depth).
  2. *Where do the keys live?* Private key only on the server (env, single-line PEM); public key served at `GET /api/v1/agent/attest-key`; test mode generates ephemeral keys per process so CI needs no committed keys.

### 2.4 `realtime/agentHub.ts` — the cloud channel
- **Purpose:** authenticates a device token on the `/agent-link` upgrade, tracks presence (`Device.status`/`lastSeenAt` from 15 s heartbeats → DISCONNECTED after 45 s), and routes agent session reports into the **same services** the dashboard uses.
- **Key decision:** **INV-2** — the hub can only send `scheduleDue` and `revoked`; it contains no focus command. **DEC-021** adds the schedule-run lifecycle: STARTED → `session.started` confirms, cancel → `scheduleRunCancelled`, no confirmation after 2 min → MISSED by the sweeper.
- **Tricky bit:** reports are idempotent through `clientSessionId`; per-device writes are serialised so a race can't double-count.
- **Demo:** quit the agent → device flips to DISCONNECTED within ~45 s; reconnect → CONNECTED; E2E covers it.
- **Likely questions**
  1. *If the cloud is compromised, can it start focus on my machine?* No — INV-2: it can only announce a due run; the agent shows a ≥10 s cancellable heads-up, requires local consent, and a scheduled start needs the user's pre-created schedule.
  2. *What happens to a session if the dashboard closes?* The agent reports `session.started`/`session.ended` itself (FR-027); the hub upserts idempotently, so the session is persisted exactly once.

### 2.5 `services/session.service.ts` — one active session, counted once
- **Purpose:** creates/finalises sessions; the analytics source of truth.
- **Key decision:** idempotency key `{userId, clientSessionId}` (REC-006) + partial unique index `{deviceId}` where `status:'ACTIVE'` enforcing one active session per device (FR-024). Duplicate create → same session; duplicate finalise → 200, no double count.
- **Tricky bit:** the dashboard and the agent may both report the same session; `actualMinutes` is capped by elapsed real time, and only terminal sessions feed analytics (FR-028).
- **Demo:** `POST /sessions` twice with the same `clientSessionId` → one session; second device ACTIVE → 409.
- **Likely questions**
  1. *How do you prevent double counting if both dashboard and agent report?* Same idempotency key; the service returns the existing document instead of inserting (tested at unit and E2E level).
  2. *What about a session that never ends (crash + dashboard closed)?* The reaper finalises stale ACTIVE sessions using the last heartbeat bound; analytics never count ACTIVE.

### 2.6 `cron/scheduler.ts` — local-time plans, honest misses
- **Purpose:** once-a-minute tick; computes "due now" in the user's IANA timezone (`Intl.DateTimeFormat`, DST-correct), claims the local minute idempotently via `Schedule.lastRunAt`, dispatches `scheduleDue` only to a connected, not-already-focusing device, records a STARTED `scheduleRun`.
- **Key decision:** **DEC-021** — the cloud **announces**, the agent starts after a ≥10 s cancellable heads-up. If no eligible device: `ScheduleRun(MISSED)` + notification — never queue a command for later, never force focus (INV-2).
- **Tricky bit:** DST fall-back must not run a schedule twice in the same wall-clock minute; the CAS on `lastRunAt` gives "one run per (schedule, local minute)".
- **Demo:** create a schedule due in ~2 minutes → E2E (`e2e/schedule.spec.ts`) shows the full round-trip on the real scheduler; offline path is unit-tested.
- **Likely questions**
  1. *Why not use cron's timezone option / a fixed UTC offset?* Offsets break on DST; computing local day+`HH:mm` with `Intl` is correct by construction and unit-tested across timezones/DST.
  2. *Free-tier hosting sleeps — what happens to a due minute?* Nothing runs, so the minute is silently skipped (not even a MISSED row); mitigation is an always-on tier or keep-alive pings — `docs/DEPLOYMENT.md` §4.2 states this honestly.

### 2.7 `services/insights.service.ts` — the analytics definitions
- **Purpose:** `GET /insights?range=7d|30d|90d` — totals, daily/weekly series, streaks, completion rate, best focus hours; strictly defined in REQUIREMENTS §6.
- **Key decision:** **ACTIVE sessions never count** (FR-028); everything is bucketed by the session's **local** start day/hour via `Intl`, in the user's timezone (A-17), DST-correct.
- **Tricky bit:** streak = consecutive local days with **≥10 COMPLETED minutes**, anchored to today or yesterday (A-02); completion rate = COMPLETED ÷ (COMPLETED+CANCELLED), and 0 when nothing terminal is in range.
- **Demo:** W5 fixtures: Asia/Kolkata 7d totals `{119 min, 8 sessions, 87.5% rate, streak 4}`; UTC override; Europe/London DST test.
- **Likely questions**
  1. *Where do "focus minutes" come from?* Σ `actualMinutes` of **COMPLETED** sessions whose local start day is in the range — a cancelled session counts in the session list/completion rate but contributes no focus minutes.
  2. *How is best-focus-hours computed?* Top-3 local hours by completed focus minutes in the range.

### 2.8 `services/admin.service.ts` — aggregate-only administration
- **Purpose:** admin user management (search/paginate/deactivate), preset + agent-link publishing, aggregate platform stats.
- **Key decision:** **[PDF §6] "non-invasive"** — stats return counts and focus minutes only, **never per-user session rows**; presets can never contain protected apps (`PROTECTED_ENTRY`); admin links are https-only on allow-listed hosts; an admin cannot deactivate/demote themselves (409) or lock the platform out.
- **Tricky bit:** every user response goes through `toSafeUser` (`passwordHash` has `select:false`); deactivation takes effect on the very next authenticated request (the auth middleware reloads `isActive` → 403 `ACCOUNT_DISABLED`) — it is a flag update, not an automatic device revocation (that is the separate unpair/unpair-all flow in `device-revocation.service.ts`).
- **Demo:** `/admin` as ADMIN vs `/admin` as USER → 403 page; `GET /admin/stats` has no session detail fields.
- **Likely questions**
  1. *What exactly can an admin see about me?* Aggregate counts only — users list metadata (name/email/role/active), no session rows, no window data (none exists anywhere — INV-6).
  2. *Can an admin edit the protected set?* No — presets are filtered/rejected if they contain protected apps; INV-3 applies to admins too.

### 2.9 `services/allowlist.service.ts` — one row, protected invariants
- **Purpose:** owns the single per-user allow-list (`protectedApps` + `userApps` + `version`); lazily creates it with the canonical protected set at first use/pairing.
- **Key decision:** every write re-checks INV-3: protected entries byte-for-byte unchanged, no user app may **shadow** a protected app by key **or** by OS identifier; a change bumps `version` so the agent knows its cached list is stale.
- **Tricky bit:** preset application merges into `userApps` and filters protected entries; default is merge, `?mode=replace` is explicit (DEC-019).
- **Demo:** four attack shapes in tests (remove protected, change identifier, shadow by key, shadow by exe) → all `PROTECTED_ENTRY`.
- **Likely questions**
  1. *How does the agent know the allow-list changed mid-session?* `version` is fetched with the allow-list; the `/agent/allowlist` device-token endpoint returns the current version for scheduled starts (DEC-021).
  2. *Who creates the protected list — client or server?* Server copies it from `shared/src/protected.ts` on creation; the client can never send it.

---

## 3. `client/` — the dashboard

### 3.1 `agent/agent-link.ts` + `agent-link-provider.tsx` — the dashboard half of the local link
- **Purpose:** connects the browser to the Focus Agent on `ws://127.0.0.1:4545/link` (port scan 4545–4549), speaks the frozen `focus.v1` protocol, does the attested handshake (`hello` → `challenge` → `POST /devices/:id/attest` → `auth` → `authOk`), keeps a typed status (`DISCONNECTED|IDLE|PAIRED|FOCUSING`) and reconnects with backoff.
- **Key decision:** the provider waits until the user is **authenticated** before connecting, so landing/login pages never trigger a local-network prompt; a missing agent is normal, not an error — fail soft (REC-003/NFR-010).
- **Tricky bit:** KI-010 history — a pairing-state change must re-handshake **without a reload**; fixed at the W4 gate (agent re-sends `hello`/`challenge`; client retries attestation with bounded backoff and drops auth on `revoked`).
- **Demo:** pair the agent → badge flips to **Connected**, unpair → "Not paired", no page refresh.
- **Likely questions**
  1. *How does the dashboard avoid moving windows itself?* It cannot — it only sends messages to the agent after attestation (INV-1); all OS work is agent-side.
  2. *What does the user see if no agent is installed?* "No device connected — start your Focus Agent"; Start is disabled with the reason (DEC-012 Q4).

### 3.2 `focus/` + `components/focus/` — start, countdown, end
- **Purpose:** the start flow (`StartFocusCard` → `ConsentModal` → `enterFocus` → `focusStarted` → `POST /sessions`), the `/focus` countdown ring, the global `FocusIndicator`, and end/auto-end synchronisation.
- **Key decision:** **no `enterFocus` is ever sent before Confirm** (FR-009, E2E-asserted); the countdown is derived from the agent's absolute `endsAt`, never a local timer, so the dashboard cannot drift from the agent's truth (A-10). The W5 gate hardened this: Start is blocked while the allow-list is loading/failed (F-101) so focus can never start with `userApps: []` when the truth is "unknown".
- **Tricky bit:** sessions are written **after** the agent confirms; if the tab closes mid-session the agent's own cloud report still persists it (FR-027).
- **Demo:** `/focus` countdown + End Focus; close the tab mid-session and end from the agent.
- **Likely questions**
  1. *What if the dashboard and agent disagree about remaining time?* The agent is the source of truth; the ring displays from `endsAt` and auto-ends when the agent emits `focusEnded`.
  2. *Why show a modal every time, not just first run?* UX_SPEC §5 + A-07: consent is shown before **every** start (safer, still PDF-compliant); the agent additionally keeps a local first-run decision (REC-004).

### 3.3 `api/http.ts` — transport and auth semantics
- **Purpose:** the single typed `fetch` transport: full base URL incl. `/api/v1` (DEC-013), Bearer token, `{success,data}` unwrapping, `{success:false,error}` → `ApiError{code,status,message,details}`, 401 → logout.
- **Key decision:** **DEC-015** — typed `fetch` instead of axios (one dependency fewer, identical contract semantics; the blueprint suggested axios but the pinned dependency set intentionally omitted it).
- **Tricky bit:** a 401 on an *anonymous* login attempt must not clear an existing session/redirect the same way as a protected request — handled by the "session expiry only for authenticated requests" rule.
- **Demo:** wrong password shows the real 401 copy and stays on `/login`; an expired token logs out cleanly.
- **Likely questions**
  1. *Why does the client call `/api/v1` on its own origin in production?* The `/api/*` rewrite proxies to the API host (same-origin), so Bearer tokens + `sessionStorage` work without third-party cookies (DEPLOYMENT.md §5).
  2. *Where are the type definitions?* Request bodies use `@focus-mode/shared` zod schemas; response types are hand-typed in `client/src/api/types.ts` (contract-frozen shapes).

---

## 4. `agent/` — the Focus Agent (the only OS-touching component)

### 4.1 `main.ts` — lifecycle and wiring
- **Purpose:** Electron main process: single-instance lock, tray + window lifecycle, wiring of link server ↔ controller ↔ cloud client, `powerMonitor` suspend/resume, restore-before-exit on **every** quit path, `AGENT_SMOKE=1` headless boot for CI.
- **Key decision:** closing the window only hides it; quitting (`before-quit`/SIGTERM) runs `exitFocus()` before exit; a packaged build never loads `.env` (DEC-013) — production config comes from process env.
- **Tricky bit:** the W3 gate bug — lifecycle frames were broadcast through a `link.server` handle that was never assigned, so focus entered FOCUSING with no dashboard event. Fixed plus a static wiring tripwire test; the lesson is why gates run E2E against the merged app (DEC-020).
- **Demo:** `node scripts/smoke/launch.mjs` → `PASS`; `kill` the agent mid-focus → relaunch restores.
- **Likely questions**
  1. *What if the user force-quits or the machine crashes mid-focus?* The journal is written before any window is moved; on next start the controller restores and reports `CRASH_RECOVERY` (INV-4).
  2. *Does the agent auto-start at login?* No — tray toggle is off by default and explains itself (REC-008); there is no hidden persistence.

### 4.2 `link/server.ts` + `link/handlers.ts` — the loopback channel
- **Purpose:** a WebSocket server bound to **127.0.0.1 only**; upgrade checks `Origin` allow-list + `Host` (DNS-rebinding defence) + `Sec-WebSocket-Protocol: focus.v1`; limits (16 KB frames, max 3 connections, 20 msg/s); frozen protocol; control messages only on an attested socket.
- **Key decision:** REC-003 — a paired agent issues a single-use `challenge`; `enterFocus`/`exitFocus` without a valid attestation are refused with `focusRejected{UNAUTHENTICATED}` (not silently ignored). The link server holds **no focus logic**; handlers map protocol → controller.
- **Tricky bit:** unauthenticated sockets may only send `hello`-class messages (`getState`, `paired`, `auth`), so a hostile page can at most learn the state — not control it.
- **Demo:** `npm test -w @focus-mode/agent` — foreign Origin rejected at upgrade, oversized frame closed, attestation gating.
- **Likely questions**
  1. *Why is binding 127.0.0.1 not enough?* Any local page can also reach 127.0.0.1; so Origin/Host checks + attestation + agent-side consent are layered (threat model in blueprint §10).
  2. *What stops DNS rebinding?* The `Host` header must be `127.0.0.1:<port>`/`localhost:<port>`; a rebinding domain sends its own Host and is rejected.

### 4.3 `cloud/client.ts` + `cloud/reporting.ts` — agent↔cloud
- **Purpose:** unpaired → generate 6-digit code (agent UI only) → register the DEC-014 digest → poll for the device token once (stored with Electron `safeStorage`) → PAIRED → open `/agent-link`, heartbeat 15 s, reconnect 1→30 s. Paired → report `session.started`/`session.ended` for MANUAL and SCHEDULE sessions (idempotent `clientSessionId`), with an offline queue.
- **Key decision:** **INV-2 structural** — `scheduleDue` is only announced to a callback; `revoked` restores first, then returns to IDLE. Only the agent turns an announcement into focus (after a cancellable heads-up).
- **Tricky bit:** the device token is delivered exactly once, to the agent by poll — never through the browser; the dashboard's local `paired` message is only a nudge.
- **Demo:** pair/unpair + dashboard-closed session reporting (E2E `session-reporting.spec.ts`).
- **Likely questions**
  1. *Can the cloud read my window titles through the agent?* No — INV-6; the agent only sends state, counts and session lifecycle. Titles/URLs never exist in the protocol or the driver interfaces.
  2. *What happens on a cloud disconnect mid-session?* Focus continues locally (absolute timer); reports queue and flush on reconnect — the session is never lost (FR-027).

### 4.4 `focus/controller.ts` — the one interface
- **Purpose:** `enterFocus(allowList)` / `exitFocus()` / `getState()`. Journal-first → `driver.asideWindows()` → absolute `endsAt` timer → `focusStarted`; exit is idempotent and restores only what the journal says this agent changed (INV-4/INV-5). Re-entry → `ALREADY_FOCUSING` (FR-024).
- **Key decision:** the controller knows **no OS details** — everything platform-specific is behind `FocusDriver`; the timer uses absolute `endsAt` and chunked timeouts (setTimeout 24.8-day limit), sleep/resume accounting per A-10.
- **Tricky bit:** restore only journaled *changed* handles that still exist and are still in the changed state — never blanket "restore everything" (that would un-minimise windows the user had already minimised).
- **Demo:** real macOS: `npx tsx scripts/verify/macos-focus-smoke.ts` → hide → separate-process verify → journal clear → idempotent exit → restore (`PASS darwin/arm64`).
- **Likely questions**
  1. *Why journal before moving windows?* A crash between "move window" and "record it" would strand the window; journal-first means restore can always happen (INV-4).
  2. *What if a driver call fails mid-enter?* The controller restores what it changed and replies `focusRejected{INTERNAL}` — focus never half-applies silently.
  3. *How is sleep handled?* `suspend` records `suspendAt`; on resume past `endsAt` the session ends with reason SLEEP and `actualMinutes = suspendAt − startedAt` (A-10); otherwise it re-applies and continues.

### 4.5 `focus/journal.ts` — the crash-safety record
- **Purpose:** records what focus changed, in `app.getPath('userData')`: atomic write (temp file + fsync + rename), schema-validated read; corrupt/missing file is quarantined and treated as "nothing to restore" so the agent always boots.
- **Key decision:** INV-4/INV-5 — a Focus Agent that refuses to boot would leave the user unable to undo anything, so corruption can never block startup.
- **Tricky bit:** the journal holds identifiers/handles and intent, never titles; kill-during-write tests prove a valid file remains.
- **Demo:** `agent` unit tests: kill-during-write, corruption quarantine, no journal after a clean restore.
- **Likely questions**
  1. *Why not just query the OS for "what is minimised" on exit?* You can't distinguish windows the agent minimised from windows the user had already minimised — the journal is the only truthful record.
  2. *Is the journal readable/editable by the user?* It's in the user's own app-data directory (their machine, their data); the schema-validated read means a hand-edited file can't crash the agent.

### 4.6 `focus/consent.ts` — the agent-side consent gate
- **Purpose:** first-ever focus on a device requires a native dialog inside the agent ("Let Focus Mode move other apps aside?" → **Allow and continue**), stored locally, versioned, revocable in the tray; a denial is never stored as consent.
- **Key decision:** REC-004 — the dashboard modal can be answered by a web page, so it is not sufficient as the *only* gate; the agent-side decision cannot be answered by the page (`CONSENT_REQUIRED` if missing).
- **Tricky bit:** the E2E proves the gate blocks the start but stubs the native dialog in-process (KI-011: a web page must never be able to answer it); the dialog's visuals are unit-tested.
- **Demo:** show the agent window/tray consent status; decline → focus rejected with `CONSENT_REQUIRED`.
- **Likely questions**
  1. *Is consent stored forever?* It is versioned and revocable from the tray; revoking forces the dialog again.
  2. *Why show the dashboard modal too?* It satisfies FR-009 pre-session transparency every time; the agent dialog is the local trust anchor (A-07; ratified DEC-023 R1).

### 4.7 `focus/enforce.ts` — "keep distractions aside"
- **Purpose:** while FOCUSING, poll every 1–2 s and re-aside newly foregrounded non-allow-listed, non-protected windows; journals newly handled windows; stops immediately on exit/quit; per-session disable via consent payload.
- **Key decision:** REC-005 (default ON, A-11) — a one-shot aside is not a lockdown; but it must reuse the exact same protected/allow-list rules (INV-3) and must never run after exit.
- **Tricky bit:** it re-checks protected **first**, every poll; a disabled loop performs zero extra driver calls (tested).
- **Demo:** FakeDriver call-log tests: re-aside happens, protected never touched, disabled → no calls.
- **Likely questions**
  1. *Could the loop fight the user forever?* It only re-asides apps that are not allow-listed and not protected, and it stops on exit; the user can also turn it off per session.
  2. *Does it need its own consent?* No separate one — it is disclosed in the consent modal ("Keep new apps aside", default ON).

### 4.8 `focus/drivers/*` — per-OS window control
- **Purpose:** `FocusDriver` implementations: `darwin.ts` (JXA one-shot osascript per operation, verify from a separate invocation per DEC-005, default browser protected per DEC-006), `win32.ts` (koffi FFI: EnumWindows/IsWindowVisible/… aside `ShowWindow(SW_SHOWMINNOACTIVE)`, restore `SW_RESTORE`, never Win+D, UIPI-elevated windows skipped+reported), `linux-x11.ts` (X11 only: wmctrl/xdotool via execFile arg arrays, title-free parsing, Wayland → unsupported), `fake.ts` (in-memory, dev/test **only**, rejected in packaged builds).
- **Key decision:** one interface so neither dashboard nor API contains platform code (TECHNICAL_DESIGN §7.5); honest capability reporting (`focus:"full"|"partial"|"unsupported"` + reasons) instead of pretending.
- **Tricky bit:** macOS BOOL return is unreliable and same-process state stale → one-shot calls + separate verification with bounded retries (DEC-005); Windows elevated windows cannot be moved by a non-elevated process (UIPI) — skip and report.
- **Demo:** macOS real smoke script; Windows/Linux are NEEDS-HUMAN (`docs/PLATFORMS.md` §7).
- **Likely questions**
  1. *Why Electron + JXA/koffi instead of a kernel-level blocker?* The PDF's product moves foreground windows aside, and the requirement is reversibility; the blueprint records "not a kernel-level blocker" as an explicit constraint ([PDF §2]/PROJECT §10).
  2. *Why was Tauri rejected?* OS code would need Rust and hurt viva explainability (blueprint `TECHNICAL_DESIGN.md` §1); Electron keeps one language across the stack.

### 4.9 `allowlist.ts` + `state.ts` — matching and the state machine
- **Purpose:** `allowlist.ts` resolves the protected set + runtime additions and computes focus candidates (visible, top-level, not protected, not allow-listed), matching only by identifier; `state.ts` is the IDLE→PAIRED→FOCUSING machine.
- **Key decision:** INV-6 — this module only ever sees `WindowRef` identifiers; no title/URL exists in the data model. Illegal state transitions throw instead of pretending (a stuck FOCUSING is a Critical defect).
- **Tricky bit:** the agent must protect *its own* process, so users can always kill it; the OS default browser is added at start (DEC-006).
- **Demo:** property tests: protected entries never become candidates even if added to the allow-list.
- **Likely questions**
  1. *How do you identify "the browser" without titles?* All known browsers are protected by executable/bundle id, plus the OS default browser resolved at start; you don't need to know *which* window/title to protect it.
  2. *What if a user adds the Focus Agent to their allow-list?* Protected wins — no user app can shadow a protected identifier.

---

## 5. `e2e/`, CI and release

### 5.1 `e2e/helpers/*` + specs — the real-stack harness
- **Purpose:** Playwright starts the **real API** (Express + in-memory MongoDB + the DEC-013 seed) and the **real dashboard**, and launches the **real Electron agent** via `_electron`; 27 tests at the W5 gate, 0 skipped.
- **Key decision:** no mocked backend/DB/agent (exam forbids fakes); stateful pairing runs with `workers: 1`; specs that depend on a not-yet-merged feature **self-gate** (`fixme` with the exact missing piece) rather than fake a pass (KI-012).
- **Tricky bit:** KI-009 (headless agent has no renderer window, so the pairing E2E launches the visible window; Linux CI needs `xvfb-run`), KI-008 (sandbox-related Electron env adjustments confined to the harness), KI-011/KI-013 (native dialog/menus/notifications not drivable — test seams or manual checklist).
- **Demo:** `PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test` → 27/27.
- **Likely questions**
  1. *How do you know the app really works end-to-end?* The E2E drives the production stack (real pairing with a real 6-digit code and real EdDSA attestation, real scheduler, real Electron agent) and asserts API truth afterwards.
  2. *What is NOT covered by E2E?* Real window management on real desktops (KI-005), native tray/notification visuals (KI-013), consent-dialog visuals (KI-011) — named in `docs/PLATFORMS.md`.

### 5.2 CI + release (`.github/workflows/*`)
- **Purpose:** 3-OS matrix CI (lint → format → typecheck → build → test, gitleaks, audit report-only, SHA-pinned actions); release workflow builds Windows NSIS+portable, macOS arm64/x64 dmg+zip, Linux AppImage+deb, runs a per-OS `AGENT_SMOKE` job, and creates a **draft** GitHub Release on maintainer-pushed `v*` tags only.
- **Key decision:** every third-party action pinned to a full commit SHA with the tag in a comment; signing is optional and the workflow must pass unsigned; release creation is tag-only (never auto-publish).
- **Tricky bit:** the smoke job proves packaged code + Electron boot headless, **not** that the installed dmg/exe launches — that is NEEDS-HUMAN (`docs/PLATFORMS.md` §6).
- **Demo:** show CI matrix results and release run `42858934575` (4/4 builds, 4/4 smoke, 0 releases).
- **Likely questions**
  1. *Why did gitleaks fail at first?* Intentionally public example values (demo passwords, example JWT/keys) — fixed with a **reviewed allowlist** in `.gitleaks.toml`, not by disabling the scan.
  2. *Why are actions pinned by SHA?* Supply-chain hardening (a moving tag can be hijacked) — each SHA was resolved from the tag with `gh api` and recorded in a comment.

---

## 6. Cross-cutting rapid-fire (the panel loves these)

| Question | Correct answer |
|---|---|
| Why can't a website just minimise windows? | Browser JS is sandboxed away from the OS; only a locally installed app can enumerate/minimise windows — hence the Focus Agent and the loopback bridge (PROJECT §3). |
| How do you stop a malicious website from controlling my agent? | Loopback bind + Origin/Host checks at upgrade + single-use challenge + 60 s cloud-signed EdDSA attestation bound to user+device+nonce; plus agent-side native consent (REC-003/REC-004). |
| Can the cloud start focus on my machine? | No — INV-2: cloud→agent only `scheduleDue`/`revoked`; a scheduled start needs the user's pre-created schedule, a ≥10 s cancellable heads-up and local consent. |
| What happens if the dashboard is closed mid-session? | The agent keeps the absolute timer and reports the session end itself (idempotent `clientSessionId`); the session persists exactly once (FR-027). |
| What happens if the agent crashes mid-focus? | Journal-first design: on next start it restores and reports `CRASH_RECOVERY`; windows aren't stranded (INV-4). |
| How do you know you never read window titles/URLs? | The driver interfaces only expose identifiers (`WindowRef`); title-free parsing (Linux reads id/PID only); protocol/schema scans and tests enforce it (INV-6/NFR-013). |
| How is the pairing code protected? | Shown only in the agent UI; the agent sends a SHA-256 digest, server stores a peppered HMAC; 10-min TTL, single use, attempt latch; token delivered once to the agent only (DEC-014/DEC-017). |
| Why not store passwords in localStorage? | Passwords are bcrypt-hashed server-side only; the client stores a short-lived HS256 access token in memory/sessionStorage (DEC-013/A-06). |
| How is "one active session per device" enforced? | Partial unique index `{deviceId}` where `status:'ACTIVE'` + service checks (409) — DB-level, not just UI (FR-024). |
| How are analytics kept honest? | Definitions fixed in REQUIREMENTS §6; ACTIVE sessions never count; reaper finalises stale sessions from heartbeat bounds; local timezone via `Intl` (FR-028). |
| Can an admin see my sessions? | No — aggregate counts only (`[PDF §6]` non-invasive); admin stats have no per-user session rows. |
| What is not implemented/verified? | Windows/Linux **runtime** window control (NEEDS-HUMAN, KI-005), native tray/notification visuals (KI-013), installer-level launch + signing (NEEDS-HUMAN), hosting deployment (BL-07), P2 bonus features (W10). Say this plainly. |
| Why MongoDB and not SQL? | `[PDF §12/§15]` mandates MongoDB; Mongoose models + unique/partial indexes give us the invariants we need. |
| Why TypeScript everywhere? | One language across dashboard/API/agent, shared zod schemas = one contract, easier viva (blueprint §1, NFR-014). |
| How do you prove requirement coverage? | `docs/REQUIREMENT_TRACEABILITY.md`: 18 PDF IDs → FR/NFR/REC → tasks, validated by a script (37/37 checks) with a W1–W5 status table (§18). |

## 7. Honesty lines to have ready (say them before they are asked)

- "The original exam PDF was never supplied in this environment, so the blueprint is the authority (BL-01/DEC-003); our traceability validates blueprint-internal consistency, not PDF fidelity."
- "Real window control is verified on macOS arm64 (`scripts/verify/macos-focus-smoke.ts`, `PASS darwin/arm64`); Windows and Linux are implemented and CI-contracted but **NEEDS-HUMAN** on a real desktop."
- "Native tray menus and OS notifications cannot be automated by Playwright (KI-013) — they are on the Phase-8 manual checklist."
- "No live deployment exists yet; `docs/DEPLOYMENT.md` is the runbook and the W9 plan, and the local fallback is documented."
- "Both the dashboard modal and the agent-side native dialog are needed: the page can be answered by any page, the native dialog cannot (REC-004/A-07)."
