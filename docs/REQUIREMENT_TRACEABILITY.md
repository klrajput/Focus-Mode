# REQUIREMENT_TRACEABILITY.md — validated PDF-ID → requirement → task coverage

> **Owner:** A1 (Requirements Analyst) · **Task:** T-003 (W0 gate) · **Status:** mapping validated 2026-11-10; **implementation status refreshed at the W7 gate, 2026-11-11 IST** (see §18).
> **Source of truth:** `PS3_Focus_Mode_Lockdown_Dashboard.pdf` (W3Grads PS03) — **not supplied to this workspace** (blocker **BL-01**). Until it is supplied, the **blueprint is authoritative** per **DEC-003**; this document therefore validates **blueprint-internal consistency only**. Every row tagged `[PDF §n]` is a claim the blueprint makes about the PDF and is **unverifiable against the source** while BL-01 is open (see §16, D-10).
> **Reference copy:** `project-blueprint/docs/REQUIREMENT_TRACEABILITY.md` is **read-only** input for this analysis. This file is the writable, validated replacement: it mirrors that document's sections, fills the gaps found in it, and proves every claim with the commands in **§17 Validation run**.
> **Tags** (blueprint convention): `[PDF §n]` = stated in the PDF · `[REC]` = architect recommendation the PDF's design needs but does not state · `[DEC]` = decision where the PDF is ambiguous · `A-nn` = assumption from `DEVELOPMENT_HANDOVER.md` §5 · `BL-nn` = blocker in `docs/AGENT_STATUS.md` §4 · `G-n` = PDF gap resolved in the design.
>
> **How to read this document**
> 1. **§1** gives the one-line coverage summary (counts + where each is proven).
> 2. **§2** is the PDF-ID level table: every PDF feature ID → blueprint requirement IDs → implementation tasks → how it is verified. This is the row the viva and the wave gates care about.
> 3. **§3–§5** resolve at the requirement level: every `FR-001…FR-030`, `NFR-001…NFR-017`, `REC-001…REC-008` is listed exactly once with **≥1 existing task** (requirement text is not changed; the column says "short" where it is abbreviated).
> 4. **§6–§14** map business rules, edge cases, pages, API endpoints, local-channel messages, Mongo collections, cross-cutting concerns, submission format and rubric to tasks — each cross-checked against `TECHNICAL_DESIGN.md` §4–§6 where that document defines the artefact.
> 5. **§15–§16** record PDF gaps/assumptions and the **deltas found in the blueprint reference document** (reported, not silently fixed in the spec).
> 6. **§17** contains the exact commands and their real output. A row is "validated" only because it appears in a table parsed by that checker.
> 7. **§18** is the W1–W7 implementation status refresh: every requirement's **implemented / tested / verified-by** state on the merged product, with NEEDS-HUMAN items and descoped P2 items named explicitly.
>
> Task IDs are the stable IDs of `IMPLEMENTATION_PLAN.md` (91 tasks). Ranges/shorthand in the blueprint reference are expanded to explicit IDs here so a machine can check every member; the checker also expands `T-100–T-102` style ranges when it finds them.
>
> **Mirror map to the reference document** (`project-blueprint/docs/REQUIREMENT_TRACEABILITY.md`): reference §1 → this §2 · §2 → §6 · §3 → §7 · §4 → §8 · §5 → §9 · §6 → §10 · §7 → §11 · §8 → §12 · §9 → §13 · §10 → §14 · §11 → §15 · §12 → §4–§5. Every section of the read-only reference is therefore carried over, and every task ID it cites was re-checked against `IMPLEMENTATION_PLAN.md`.

## 1. Coverage summary

| Item | Count | Source of the count | Validated in |
|---|---|---|---|
| PDF feature IDs | 18 | `PROJECT.md` §7 | §2, check (a) |
| Functional requirements | 30 | `REQUIREMENTS.md` §2 (`FR-001…FR-030`) | §3, check (b) |
| Non-functional requirements | 17 | `REQUIREMENTS.md` §3 (`NFR-001…NFR-017`) | §4, check (b) |
| Recommendations | 8 | `REQUIREMENTS.md` §2 (`REC-001…REC-008`) | §5, check (b) |
| Implementation tasks | 91 | `IMPLEMENTATION_PLAN.md` (rows `T-nnn`) | checks (a)–(c) |
| API endpoint table rows | 23 | `TECHNICAL_DESIGN.md` §5.2 | §9, check (e) |
| Local-channel messages | 16 | `TECHNICAL_DESIGN.md` §6.2 (11 rows → 16 message names) | §10, check (e) |
| Mongo collections | 9 | `TECHNICAL_DESIGN.md` §4 (6 PDF + 3 `[REC]`) | §11, check (e) |
| Pages / routes | 13 | `PROJECT.md` §10 + `FR-021` (11 routes + 404 + 403) | §8, check (e) |
| Business rules | 8 | blueprint reference §2 `[PDF §13]` | §6 |
| Edge cases | 7 | blueprint reference §3 `[PDF §13]` | §7 |
| Implementation status per requirement | 55 | this §18 (W1–W7 refresh) | §18, check (f) |

Two source-level caveats that no amount of internal checking removes: **(1)** the PDF itself is absent (BL-01), so "PDF fidelity" is unverified; **(2)** `NFR-015` (every human member appears in git history) and submission item 1 (repo with all members in history) are **human actions** — no AI task can satisfy them (see §16, D-09/D-10).

## 2. PDF ID → requirement → tasks → verification `[PDF §8]`

All 18 PDF feature IDs from `PROJECT.md` §7; priority is the PDF scale taken from the blueprint.

| PDF ID | Pri | Requirement IDs | Tasks | Verification (from blueprint) | Status |
|---|---|---|---|---|---|
| AUTH-1 | P0 | FR-001, FR-030 | T-012, T-013, T-020, T-021 | I (auth API) + E2E login | validated |
| AGENT-1 | P0 | FR-002, FR-022 | T-030, T-059, T-110 | Playwright-Electron + M (Phase 8) | validated |
| PAIR-1 | P0 | FR-003, FR-026, REC-002 | T-040, T-042, T-046, T-047 | I (pairing) + E2E | validated |
| LINK-1 | P0 | FR-004, NFR-010, REC-003 | T-031, T-044, T-045 | link integration (T-092) + E2E | validated |
| FOCUS-1 | P0 | FR-005 | T-050, T-051, T-052, T-053, T-054, T-056 | contract + M (Phase 8, T-100/T-101) | validated |
| FOCUS-2 | P0 | FR-006 | T-050, T-057, T-059 | contract + M | validated |
| FOCUS-3 | P0 | FR-007 | T-050, T-057 | fake-timer unit + E2E | validated |
| SAFE-1 | P0 | FR-008, FR-020 | T-033, T-061, T-066 | unit property test + I | validated |
| SAFE-2 | P0 | FR-009 | T-051, T-056, T-058 | E2E + M | validated |
| SESS-1 | P0 | FR-010, FR-024, REC-006 | T-060, T-069 | I (sessions API) | validated |
| X-PLAT-1 | P1 | FR-011 | T-052, T-053, T-054, T-094, T-095 | FocusDriver contract suite + M | validated |
| SCHED-1 | P1 | FR-012, FR-025 | T-062, T-063, T-064, T-067 | I (scheduler) + E2E | validated |
| ANALYTICS-1 | P1 | FR-013, FR-028 | T-068, T-070, T-071 | hand-computed fixtures | validated |
| RECONN-1 | P1 | FR-014 | T-080 | integration (kill/restore link) | validated |
| BLOCK-1 | P2 | FR-015 (A-12) | T-130 | E2E (MV3 extension) | validated |
| POMO-1 | P2 | FR-016 | T-131 | E2E | validated |
| MULTI-1 | P2 | FR-017 | T-132 | I + E2E | validated |
| GAMIFY-1 | P2 | FR-018 | T-133 | I | validated |

Notes:
- The blueprint reference's slash shorthand (`T-052/053/054`) and ranges are expanded above; every expanded member exists in `IMPLEMENTATION_PLAN.md` (check (c)).
- Rows without a `[PDF §8]` feature ID (FR-019, FR-021, FR-029) derive from `[PDF §6/§10/§11]`, which is why the reference's §1 table did not carry them. They are mapped in §3 and were **missing from the reference** (D-01/D-02/D-03).

## 3. Functional requirements — every `FR-001…FR-030` has ≥1 task

Requirement text is abbreviated ("short") from `REQUIREMENTS.md` §2; the ID, Src and Pri are authoritative there.

| ID | Pri | Src | Requirement (short) | Task(s) | Verification |
|---|---|---|---|---|---|
| FR-001 | P0 | PDF §8 [AUTH-1] | Signup/login/logout, bcrypt, JWT, protected routes, seeded admin | T-012, T-013, T-021 | I auth + E2E login |
| FR-002 | P0 | PDF §8 [AGENT-1] | Runnable agent with tray/menu-bar presence and Quit | T-030, T-059, T-110 | Playwright-Electron + M |
| FR-003 | P0 | PDF §8 [PAIR-1] | Code pairing; device linked; connected/disconnected shown | T-040, T-042, T-046, T-047 | I + E2E pair |
| FR-004 | P0 | PDF §8 [LINK-1] | Live localhost channel, status both ways | T-031, T-044, T-045 | link integration (T-092) + E2E |
| FR-005 | P0 | PDF §8 [FOCUS-1] | Start focus; other apps step aside, browser stays | T-050, T-051, T-056 | contract + M (T-100/T-101) |
| FR-006 | P0 | PDF §8 [FOCUS-2] | Manual end fully restores normal use | T-050, T-057, T-059 | contract + M |
| FR-007 | P0 | PDF §8 [FOCUS-3] | Timed 25/50/60/custom 1–480 min, countdown, auto-end (A-01) | T-050, T-057 | fake-timer unit + E2E |
| FR-008 | P0 | PDF §8 [SAFE-1], §13 | Protected allow-list preserved/never removable; user may add apps | T-033, T-061, T-066 | unit property test + I |
| FR-009 | P0 | PDF §8 [SAFE-2], §14 | Explicit pre-session confirmation; focus visible and cancellable | T-051, T-056, T-058 | E2E + M |
| FR-010 | P0 | PDF §8 [SESS-1] | Session history: times, planned/actual, completed vs cancelled | T-060, T-069 | I (sessions API) |
| FR-011 | P1 | PDF §8 [X-PLAT-1] | Windows + macOS behind one agent interface; other documented | T-052, T-053, T-054, T-094, T-095 | FocusDriver contract suite + M |
| FR-012 | P1 | PDF §8 [SCHED-1] | Recurring schedules auto-start when agent running | T-062, T-063, T-064, T-067 | I + E2E |
| FR-013 | P1 | PDF §8 [ANALYTICS-1], §10 | Analytics: totals, daily/weekly chart, streaks, completion, best hours | T-070, T-071 | hand-computed fixtures |
| FR-014 | P1 | PDF §8 [RECONN-1], §13 | Disconnect/reconnect/sleep handled; state consistent | T-080 | integration (kill/restore link) |
| FR-015 | P2 | PDF §8 [BLOCK-1] | Optional website block-list enforced in browser (A-12) | T-130 | E2E (MV3 extension) |
| FR-016 | P2 | PDF §8 [POMO-1] | Pomodoro cycles + ambient sounds | T-131 | E2E |
| FR-017 | P2 | PDF §8 [MULTI-1] | Multiple paired devices; choose which to focus | T-132 | I + E2E |
| FR-018 | P2 | PDF §8 [GAMIFY-1] | Badges/leaderboards/goals | T-133 | I |
| FR-019 | P0 | PDF §6, §10, §11 | Admin: users list/search/deactivate, preset CRUD, agent links, aggregate stats | T-073, T-074 | I admin API + E2E role gate |
| FR-020 | P0 | PDF §10, §11, §12 | Allow-list GET/PUT; protected + user apps; admin presets selectable | T-061, T-066 | I allow-list API |
| FR-021 | P0 | PDF §10 | All dashboard pages + profile/password, notifications, badge, focus indicator | T-020, T-046, T-057, T-065, T-066, T-067, T-071, T-072, T-074, T-075, T-076, T-077 | E2E route render + role gate |
| FR-022 | P0 | PDF §10, §13 | Agent UI: tray, pairing code, state, allow-list view, end/quit | T-059 | Playwright-Electron + M |
| FR-023 | P0 | PDF §13 | Fail-safe: crash/kill during focus restores on next start | T-032, T-050 | U journal + M (kill -9) |
| FR-024 | P0 | PDF §13 | One active session per device; second rejected | T-050, T-060 | I (409 / focusRejected) |
| FR-025 | P1 | PDF §13 | Missed scheduled runs recorded and user notified | T-063, T-075 | I notifications |
| FR-026 | P0 | PDF §13, §12 | Pairing codes short-lived, single-use, hash only | T-040 | U + I (TTL/reuse/attempts) |
| FR-027 | P0 | PDF §13 | Dashboard closed mid-session → continues, endable from agent | T-069 | I + M (browser closed) |
| FR-028 | P1 | PDF §13 | Analytics count only real sessions (heartbeat-bounded) | T-068, T-070 | U reaper fixtures |
| FR-029 | P0 | PDF §10 | Profile, change password, notifications, unpair all, download agent | T-072 | I users/me + E2E settings |
| FR-030 | P0 | PDF §1.4, §19 | Idempotent seed with demo data; test credentials in README | T-013 | I seed ×2 same counts |

## 4. Non-functional requirements — every `NFR-001…NFR-017` has ≥1 task

| ID | Src | Requirement (short) | Task(s) | Verification |
|---|---|---|---|---|
| NFR-001 | PDF §1.4 | Same zod schemas validate client forms and API bodies | T-004, T-014, T-021 | I 400 `VALIDATION_ERROR` + E2E inline errors |
| NFR-002 | PDF §11, §1.4 | Central error middleware, consistent shapes, no stack traces | T-010 | I forced-500: no `stack` in JSON |
| NFR-003 | PDF §1.4 | CORS allow-list, helmet, auth rate limits, sanitisation, authorisation | T-012, T-014, T-082 | I negative tests (429, `$ne`, cross-user 404) |
| NFR-004 | PDF §1.4, §19 | Secrets only in `.env`; commented `.env.example`; no hard-coded URLs | T-006, T-115 | CI gitleaks + config-only URL grep |
| NFR-005 | PDF §1.4 | ESLint + Prettier consistent; no dead-code dumps | T-001, T-111 | CI lint + `format:check` zero errors |
| NFR-006 | PDF §1.4 | Responsive 360 px/tablet/desktop, no horizontal scroll | T-085 | Playwright viewports 360/768/1440 |
| NFR-007 | PDF §1.4 | Loading/empty/error/success on every data-driven screen | T-023, T-093 | E2E with stubbed slow/empty/failing network |
| NFR-008 | PDF §14 | Accessibility: contrast ≥4.5:1, keyboard operable, status icon+text | T-007, T-084 | axe-core 0 serious/critical per route |
| NFR-009 | PDF §11 | API conventions: `/api/v1`, Bearer, status codes, list shape/params | T-010, T-014 | contract tests per route (T-091) |
| NFR-010 | PDF §5, REC | Local channel binds 127.0.0.1; Origin+Host checks; unauth message limits | T-031 | link integration: foreign Origin 403, LAN unreachable |
| NFR-011 | REC | Performance targets (focus ≤3 s, status ≤1 s, p95 ≤300 ms, agent CPU/RAM) | T-090, T-127 | QA report measurements |
| NFR-012 | master brief | Installers: Windows NSIS+portable, macOS dmg+zip, Linux AppImage+deb | T-110, T-112, T-113 | CI artefacts + per-OS smoke launch |
| NFR-013 | PDF §2, §6 | No window titles/URLs/keystrokes leave the machine; least-data payloads | T-014, T-081 | payload schema review + rejects-unknown-fields test |
| NFR-014 | PDF §1.4 | Viva explainability: strict TS, small modules, header comments, VIVA_NOTES | T-125 | `docs/VIVA_NOTES.md` + per-module header review |
| NFR-015 | PDF §1.3 | Conventional commits, branch per feature, every member in history | T-124 (+ human commits per AGENTS §6 / DEC-007) | `git shortlog -sn` after human-authored commits |
| NFR-016 | REC | Structured logs (pino/electron-log), request ids, no PII/secrets | T-010, T-042, T-081 | log redaction test |
| NFR-017 | PDF §15, §19 | Deployable dashboard/API/DB; fresh-machine setup per README | T-120, T-121 | fresh-clone setup test |

## 5. Recommendations — every `REC-001…REC-008` has ≥1 task

| ID | Src | Requirement (short) | Task(s) | Verification |
|---|---|---|---|---|
| REC-001 | REC (A-04) | Agent keeps an outbound authenticated cloud WS: heartbeat, reports, `scheduleDue`, `revoked` | T-041, T-042, T-063 | I: offline >45 s → DISCONNECTED; cloud sends only `scheduleDue`/`revoked` |
| REC-002 | REC (PDF §5.1 gap G-1) | Agent pre-registers code hash; pairing via `POST /devices/pair`; token delivered by poll | T-040, T-042 | I pairing protocol §5.1 |
| REC-003 | REC (G-3) | Local control authenticated by short-lived cloud-signed attestation bound to user+device+nonce | T-043, T-044 | U+I: unauth `enterFocus` → `focusRejected{UNAUTHENTICATED}` |
| REC-004 | REC (G-6, A-07) | First-ever focus also needs a native agent confirmation dialog | T-051 | M: dialog cannot be answered by the web page |
| REC-005 | REC (A-11) | Optional "keep distractions aside" enforcement loop (1–2 s re-aside) | T-055 | U+M: never protected; stops on exit; disabled → zero extra calls |
| REC-006 | REC | Idempotent session reporting via `clientSessionId` unique per user | T-060, T-069 | I: duplicate report → same session, no double count |
| REC-007 | REC | `listApps` local message for "pick a running app" (no window titles) | T-066 | U: returns key+label+running only |
| REC-008 | PDF §2 "no persistence the user did not choose" | Agent never auto-launches at login unless the user turns it on | T-030, T-110, T-100, T-101 | M: default off; tray toggle has explanatory text |

## 6. Business rules `[PDF §13]`

| # | Business rule | Requirement(s) | Task(s) |
|---|---|---|---|
| 1 | Focus only when paired AND the logged-in user started it | REC-003, FR-005 | T-043, T-044, T-051 |
| 2 | Protected entries are never removable | FR-008 | T-033, T-061 |
| 3 | Every session is reversible; a crash leaves nothing stuck | FR-006, FR-023 | T-032, T-050 |
| 4 | Escape hatch from the agent with the dashboard closed | FR-022, FR-027 | T-059, T-069 |
| 5 | Visible indicator while focus is on | FR-009 | T-058, T-059 |
| 6 | Pairing codes short-lived, single-use, hash only | FR-026 | T-040 |
| 7 | Scheduled sessions only when the agent is running; else missed run | FR-012, FR-025 | T-063, T-064 |
| 8 | Analytics count only real sessions | FR-028 | T-068, T-070 |

## 7. Edge cases `[PDF §13]`

| # | Edge case | Expected behaviour | Requirement(s) | Task(s) |
|---|---|---|---|---|
| 1 | Agent not running on Start | "No device connected — start your agent"; no action | FR-004, FR-005 | T-045, T-046, T-056 |
| 2 | Sleep mid-session | Reconcile; UI shows agent truth (A-10) | FR-014 | T-050, T-080 |
| 3 | Dashboard closed mid-session | Continues; endable from the agent | FR-027 | T-069 |
| 4 | Agent crash while focusing | Restore on restart (journal-first) | FR-023 | T-032, T-050 |
| 5 | Schedule fires, agent offline | Schedule run MISSED + notification; force nothing | FR-025 | T-063, T-075 |
| 6 | Two sessions at once | Reject the second | FR-024 | T-050, T-060 |
| 7 | Remove browser from allow-list | Blocked (`PROTECTED_ENTRY`) | FR-008 | T-061, T-066 |

## 8. Pages `[PDF §10]` — 11 routes + 404 + 403

| # | Route | Page | Task(s) | Notes |
|---|---|---|---|---|
| 1 | `/` | Landing: what/how, privacy promise, downloads, CTA | T-076 | public |
| 2 | `/login` | Login | T-021 | public |
| 3 | `/signup` | Signup | T-021 | public |
| 4 | `/dashboard` | Connection status, Start Focus, today's time, next schedule, recent sessions | T-065 | auth |
| 5 | `/focus` | Countdown ring from `endsAt`, protected/allow-listed apps, End Focus | T-057 | auth |
| 6 | `/devices` | Device list, Pair dialog, unpair, "start your agent" | T-046 | auth |
| 7 | `/allowlist` | Locked protected rows, user apps, `listApps` picker, presets | T-066 | auth |
| 8 | `/schedules` | Create/edit/enable/disable with timezone display | T-067 | auth |
| 9 | `/insights` | Totals, daily/weekly chart, streaks, completion, best hours | T-071 | auth |
| 10 | `/settings` | Profile, password change, default duration, unpair all, downloads | T-072 | auth |
| 11 | `/admin` | Users, presets, agent links, aggregate stats | T-074 | ADMIN only |
| 12 | `404` | Not-found page | T-077 | `*` route |
| 13 | `403` | Forbidden page (USER hitting `/admin`) | T-077 | role guard also T-020 |

Not numbered above but required by `FR-021`: shared layout + role-aware sidebar (`T-020`), persistent status badge (`T-045`), always-visible focus indicator (`T-058`), notifications bell (`T-075`), profile/change-password API (`T-072`), and the Focus Agent window/tray UI (`T-059`, `[PDF §10] "Agent UI counts too"`). The count in check (e) is the 13 route rows only.

## 9. API endpoints `[PDF §11]` — cross-checked against `TECHNICAL_DESIGN.md` §5.2 (23 rows)

| # | Method | Path | Access | Task(s) | Blueprint-ref gap |
|---|---|---|---|---|---|
| 1 | POST | /auth/register, /auth/login, /auth/logout | public / auth | T-012 | ref used comma shorthand |
| 2 | GET | /auth/me | auth | T-012 | — |
| 3 | PATCH, POST | /users/me, /users/me/password | auth | T-072 | password path absent (D-07) |
| 4 | POST | /devices/pair | USER | T-040 | — |
| 5 | GET | /devices | USER | T-040, T-046 | — |
| 6 | DELETE | /devices/:id | USER | T-040, T-072 | — |
| 7 | POST | /devices/:id/attest | USER | T-043 | — |
| 8 | POST | /sessions | USER | T-060 | — |
| 9 | PATCH | /sessions/:id | USER | T-060 | — |
| 10 | GET | /sessions | USER | T-060 | — |
| 11 | GET, PUT | /allowlist | USER | T-061 | — |
| 12 | GET, POST, PATCH, DELETE | /schedules(/:id) | USER | T-062 | — |
| 13 | GET | /insights?range=7d\|30d\|90d | USER | T-070 | — |
| 14 | GET, PATCH | /notifications, /notifications/:id/read | USER | T-075 | read path absent (D-07) |
| 15 | GET | /presets | USER | T-061 | — |
| 16 | GET | /agent-links | public | T-073, T-122 | — |
| 17 | GET, PATCH | /admin/users | ADMIN | T-073 | — |
| 18 | GET, POST, PATCH, DELETE | /admin/presets, /admin/agent-links | ADMIN | T-073 | agent-links absent (D-07) |
| 19 | GET | /admin/stats | ADMIN | T-073 | absent (D-07) |
| 20 | POST | /agent/register, /agent/enroll/poll | public + enroll secret | T-040 | — |
| 21 | GET | /agent/allowlist, /agent/attest-key | device token / public | T-043, T-061, T-064 | allowlist path absent (D-07) |
| 22 | WS | /agent-link | device token | T-041 | — |
| 23 | GET | /health | public | T-010 | absent (D-07) |

Conventions (base path, Bearer, success/error shape, status codes, list params) → `NFR-009`; tasks `T-010`, `T-014`. `/health/db` is mentioned in `TECHNICAL_DESIGN.md` §11 but has no §5.2 row, so it is not counted here (endpoint count is defined as §5.2's 23 rows).

## 10. Local-channel messages `[PDF §11]` — cross-checked against `TECHNICAL_DESIGN.md` §6.1–6.2 (16 messages)

| # | Message | Direction | Task(s) | Notes |
|---|---|---|---|---|
| 1 | hello | Agent→Dashboard | T-031 | PDF's `hello / pairingCode`; code **omitted** by design (A-03/DEC) |
| 2 | challenge | Agent→Dashboard | T-044 | only if paired (REC-003) |
| 3 | auth | Dashboard→Agent | T-044 | carries attestation |
| 4 | authOk | Agent→Dashboard | T-044 | — |
| 5 | authError | Agent→Dashboard | T-044 | stable error codes |
| 6 | paired | Dashboard→Agent | T-042, T-045 | nudge only; forged nudge → harmless poll |
| 7 | getState | Dashboard→Agent | T-031, T-045 | allowed unauthenticated |
| 8 | state | Agent→Dashboard | T-031, T-045 | includes session/allowList/protected |
| 9 | listApps | Dashboard→Agent | T-066 | REC-007 |
| 10 | apps | Agent→Dashboard | T-066 | `{key,label,running}` only — no titles |
| 11 | enterFocus | Dashboard→Agent | T-051 | requires `auth` + consent |
| 12 | focusStarted | Agent→Dashboard | T-050, T-051 | carries `endsAt`/`sessionId` |
| 13 | focusRejected | Agent→Dashboard | T-051 | REC |
| 14 | exitFocus | Dashboard→Agent | T-051 | any trigger path |
| 15 | focusEnded | Agent→Dashboard | T-050, T-051 | reason enum incl. CRASH_RECOVERY |
| 16 | scheduleHeadsUp | Agent→Dashboard | T-064 | REC; ≥10 s cancellable |

## 11. MongoDB collections `[PDF §12]` — cross-checked against `TECHNICAL_DESIGN.md` §4 (9 collections)

| # | Collection | Kind | Task(s) | Notes |
|---|---|---|---|---|
| 1 | users | PDF §12 | T-011 | `timezone`, `lastLoginAt` are `[REC]` additions (A-05) |
| 2 | devices | PDF §12 | T-011, T-040 | pair/enroll/token hashes are `[REC]` additions (REC-002) |
| 3 | sessions | PDF §12 | T-011, T-060 | `clientSessionId`, `endReason`, `lastHeartbeatAt` `[REC]` (REC-006/A-05) |
| 4 | allowlists | PDF §12 | T-011, T-061 | `protectedApps` locked (INV-3) |
| 5 | schedules | PDF §12 | T-011, T-062 | `days`, `startTime` in user `timezone` (A-17) |
| 6 | presets | PDF §12 | T-011, T-061, T-073 | admin-published app presets |
| 7 | scheduleRuns | `[REC]` (G-5) | T-011, T-063 | STARTED / MISSED / CANCELLED_BY_USER |
| 8 | notifications | `[REC]` (G-5) | T-011, T-075 | missed-run alerts + bell |
| 9 | agentLinks | `[REC]` (G-5) | T-011, T-073, T-122 | admin-published installer links (A-14) |

## 12. Cross-cutting `[PDF §1.4, §14, §15]`

| # | Concern | Src | Requirement IDs | Task(s) |
|---|---|---|---|---|
| 1 | Auth, JWT, roles, protected routes | PDF §1.4 | FR-001, FR-019, NFR-003 | T-010, T-012, T-073 |
| 2 | Shared zod validation client + server | PDF §1.4 | NFR-001, FR-021 | T-004, T-014, T-021 |
| 3 | Error envelope + central middleware | PDF §11 | NFR-002, NFR-009 | T-010, T-014 |
| 4 | UI states: loading/empty/error/success | PDF §1.4 | NFR-007, FR-021 | T-023, T-093 |
| 5 | Responsive 360 px → desktop | PDF §1.4 | NFR-006 | T-085 |
| 6 | Design tokens + accessibility (contrast, keyboard) | PDF §14 | NFR-008 | T-007, T-084 |
| 7 | Config/env/secrets hygiene | PDF §1.4, §19 | NFR-004 | T-006, T-115 |
| 8 | Code quality: lint, format, strict TS | PDF §1.4 | NFR-005, NFR-014 | T-001, T-111, T-125 |
| 9 | Security basics (CORS, helmet, rate limits, sanitisation) | PDF §1.4 | NFR-003, NFR-013 | T-014, T-081, T-082, T-083 |
| 10 | Seed data + test credentials | PDF §1.4, §19 | FR-030 | T-013, T-123 |
| 11 | Stack choice (`TECHNICAL_DESIGN` §1) | PDF §15 | NFR-012 | T-001, T-110 |
| 12 | Folder structure (`TECHNICAL_DESIGN` §13) | PDF §16 | FR-021 | T-001 |
| 13 | Team/milestones → waves W0–W10 | PDF §17 | NFR-015 | T-124 |
| 14 | Playbook: stub-first, one feature per task, commit per step | PDF §18 | FR-005, FR-022 | T-030, T-050 |
| 15 | Observability: structured logs, request ids, redaction | REC | NFR-016 | T-010, T-042, T-081 |
| 16 | Deployability: Vercel/Netlify + Render/Railway + Atlas | PDF §15, §19 | NFR-017 | T-120, T-121 |

## 13. Submission format `[PDF §19]`

| # | Deliverable | Task(s) | Notes |
|---|---|---|---|
| 1 | GitHub repo with every member in history | — (human action; AGENTS §6, DEC-007) | no AI task can author a human's commits (D-10) |
| 2 | README per template | T-123 | architecture + honest known-limitations note |
| 3 | `.env.example` with comments | T-006 | all three packages |
| 4 | Live deployment or flawless local setup | T-120, T-121 | Render/Railway + Vercel/Netlify |
| 5 | Demo video 3–5 min | T-126 (H) | human records |
| 6 | Test credentials | T-013, T-123 | seed prints them; README documents |
| 7 | PROMPTS.md (10–20 prompts + outcomes) | T-124 | Lead-curated |
| 8 | Agent build + which OS fully tested | T-110, T-111, T-112, T-113, T-100, T-101, T-102 | macOS P0 (DEC-008), Windows checklist |
| 9 | Architecture note | T-123 | linked from README |
| 10 | Demo shows pairing → start → visible focus → end restoring | T-126 | script covers `[PDF §19]` |

## 14. Rubric coverage `[PDF §20]` (100 marks + 10 bonus)

| # | Rubric row | Marks | Task(s) |
|---|---|---|---|
| 1 | Architecture & agent | 20 | T-004, T-030, T-031, T-032, T-033 |
| 2 | Pairing & live link | 15 | T-040, T-041, T-042, T-043, T-044, T-045, T-046, T-047, T-080 |
| 3 | Focus core | 18 | T-050, T-051, T-052, T-053, T-054, T-055 |
| 4 | Safety & consent | 12 | T-032, T-051, T-056, T-057, T-058, T-059 |
| 5 | Sessions/schedules/analytics | 12 | T-060, T-061, T-062, T-063, T-064, T-065, T-066, T-067, T-068, T-069, T-070, T-071 |
| 6 | Dashboard UX | 10 | T-007, T-020, T-021, T-022, T-023, T-065, T-066, T-067, T-068, T-069, T-070, T-071, T-072, T-073, T-074, T-075, T-076, T-077, T-084, T-085 |
| 7 | Cross-platform | 6 | T-052, T-053, T-054, T-094, T-095, T-100, T-101, T-102 |
| 8 | Code quality & deploy | 4 | T-001, T-111, T-120, T-121, T-123 |
| 9 | Viva & PROMPTS.md | 3 | T-124, T-125 |
| 10 | Bonus | +10 | T-130, T-131, T-132, T-133 |

Bonus-row status per **DEC-027**: **T-133 partially delivered** (badges + device-local weekly goal on `/insights`, no leaderboard); **T-130/T-131/T-132 descoped** with recorded reasons (§18, FR-015…FR-018). The mapping above is unchanged — only the delivery status is honest.

## 15. PDF gaps resolved in the design (G-1…G-10) and assumptions

These are the blueprint's recorded gaps (reference §11); all have a design answer, and the task/requirement that carries each answer.

| Gap | PDF problem | Resolution | Carried by |
|---|---|---|---|
| G-1 | Pairing cannot work as written — the cloud never sees the code | REC-002 pre-registered code hash + enroll poll | T-040, T-042 |
| G-2 | Schedules need a cloud→agent path with no dashboard open | REC-001 outbound agent WS + `scheduleDue` | T-041, T-063 |
| G-3 | Who authenticates the localhost caller? | REC-003 cloud-signed attestation | T-043, T-044 |
| G-4 | `hello / pairingCode` would leak the code to any page | code shown only in agent UI (A-03) | T-031, T-045 |
| G-5 | Missed runs, notifications, agent links have no collection | additive collections (A-05) | T-011, T-063, T-073, T-075 |
| G-6 | "agent validates & confirms" is undefined | REC-004 native first-run consent dialog | T-051 |
| G-7 | Streak/completion definitions missing | REQUIREMENTS §6 definitions | T-070 |
| G-8 | BLOCK-1 "via the web app" cannot block other tabs | MV3 extension (A-12) | T-130 |
| G-9 | "browser" cannot be identified from a sandboxed page | protect all known browsers + OS default (DEC-006) | T-033, T-053 |
| G-10 | Timezone for schedules missing | `users.timezone`, IANA (A-17) | T-011, T-062, T-063 |

Assumptions referenced by this document: **A-03** (code only in agent UI), **A-04** (outbound cloud WS), **A-05** (additive collections/fields), **A-07** (consent every start + native first-run), **A-10** (sleep accounting), **A-11** (enforcement loop default on), **A-12** (MV3 extension), **A-14** (installers via GitHub Releases), **A-17** (schedule timezone) — all provisionally accepted in `docs/DECISIONS.md` (proposed under BL-01). If the human overrides any, `REQUIREMENTS.md` + DECISIONS must change before W2; this trace table must then be re-validated.

## 16. Deltas found while validating the blueprint (for A0 to log — DECISIONS.md is A0-owned)

Validation was performed against the **blueprint reference document** `project-blueprint/docs/REQUIREMENT_TRACEABILITY.md` (read-only). The reference's §1 PDF-ID table, message table, page list and collection list are complete; the gaps below are the genuine inconsistencies found. **No requirement text was changed** — this document adds the missing mappings and records the gap.

| ID | Delta (what was inconsistent in the blueprint) | Resolution in this document | Suggested action for A0 |
|---|---|---|---|
| D-01 | `FR-019` (admin, P0) is **not mentioned at all** in the reference traceability doc (it derives from `[PDF §6/§10/§11]`, not a `[PDF §8]` ID) | mapped to T-073, T-074 in §3 | log as traceability gap in DECISIONS.md; consider adding a "non-§8 PDF requirements" row to the reference |
| D-02 | `FR-021` (all pages + profile/notifications/badge, P0) appears only in a section heading ("Pages → FR-021"), never on a line with a task | mapped to 12 page/route tasks in §3 and §8 | same as D-01 |
| D-03 | `FR-029` (profile/password/unpair-all/download, P0) is **not mentioned** in the reference doc | mapped to T-072 in §3 | same as D-01 |
| D-04 | `REC-001` (outbound agent WS — G-2) has no requirement→task line (only indirect coverage via `/agent-link`) | mapped to T-041, T-042, T-063 in §5 | log; reference §1 PAIR-1/LINK-1 rows could cite REC-001 |
| D-05 | `REC-004` (native first-run consent dialog) has no requirement→task line | mapped to T-051 in §5 | log |
| D-06 | `REC-005` (enforcement loop) is **not mentioned** in the reference doc despite T-055 implementing it | mapped to T-055 in §5 | log |
| D-07 | Six endpoint paths in `TECHNICAL_DESIGN.md` §5.2 are absent from the reference's §5 endpoint table: `/users/me/password`, `/notifications/:id/read`, `/admin/agent-links`, `/admin/stats`, `/agent/allowlist`, `/health` (the `/auth/*` comma shorthand is only a formatting difference, not a gap) | all 23 §5.2 rows listed in §9 with tasks | log; reference §5 endpoint table should be regenerated from §5.2 |
| D-08 | `NFR-003` and `NFR-006` (and `NFR-001`, `NFR-008`, `NFR-009`, `NFR-017`) were only covered by the reference's cross-cutting prose/range ("NFR-001…NFR-009"), never as their own row | each NFR now has its own row with task(s) in §4 | log; keep the §4 table as the per-ID source of truth |
| D-09 | `NFR-015` ("every member appears in git history") and submission item 1 cannot be satisfied by any implementation task — they are **human actions** (PDF §1.3, AGENTS §6, DEC-007) | marked explicitly in §4 and §13; only PROMPTS task T-124 is machine-owned | escalate to human at W0; `git shortlog -sn` is the evidence at the release gate |
| D-10 | `BL-01` — the exam PDF is absent, so every `[PDF §n]` claim in this document is **unverifiable against the source**; all validation here is blueprint-internal (DEC-003) | stated in the header, §1 and here; `[PDF]` fidelity remains an open risk | keep BL-01 open; if the PDF arrives, diff each `[PDF]` row before W2 per DEC-003 |

Zero dangling task IDs were found in the reference doc (80 distinct task IDs cited, all present in `IMPLEMENTATION_PLAN.md`) — that check passed, so no delta is recorded for it. Zero duplicate PDF-ID rows, zero missing PDF IDs, zero missing messages/pages/collections.

## 17. Validation run

Method: the markdown was parsed programmatically (`node` v26.11.1) — IDs regex-extracted from `PROJECT.md`, `REQUIREMENTS.md`, `IMPLEMENTATION_PLAN.md`, `TECHNICAL_DESIGN.md` and this file — and the five required assertions plus the implementation-status assertion (f) were executed as real checks. The checker scripts live in `/tmp/a1-trace/` (`lib.mjs`, `audit-blueprint.mjs`, `check.mjs`) so the repository does not gain an unowned script; A0 may decide later whether to keep them under `scripts/`. Both commands below were re-run for this **W7 status refresh (2026-11-11)** and the output is pasted verbatim.

**Command 1 — audit of the read-only blueprint reference** (produces the delta list in §16):

```console
$ node /tmp/a1-trace/audit-blueprint.mjs
OK   PDF IDs defined in PROJECT.md §7                        18
OK   PDF ID rows in reference §1                             18
OK   PDF IDs missing from reference §1                       none
OK   duplicate PDF rows in reference §1                      none
OK   FR defined in REQUIREMENTS.md                           30
GAP  FR with no line mapping to a task                       FR-019,FR-021,FR-029
OK   NFR defined in REQUIREMENTS.md                          17
OK   NFR with no line mapping to a task                      none
OK   REC defined in REQUIREMENTS.md                          8
GAP  REC with no line mapping to a task                      REC-001,REC-004,REC-005
OK   task IDs cited in reference doc                         80
OK   dangling task IDs (not in IMPLEMENTATION_PLAN)          none
OK   TD §5.2 endpoint rows                                   23
GAP  TD §5.2 paths absent from reference §5                  /users/me/password,/notifications/:id/read,/admin/agent-links,/admin/stats,/agent/allowlist,/health
OK   PROJECT §10 routes + 404/403                            11 + 2
OK   routes absent from reference §4                         none
OK   TD §6.2 distinct local-channel messages                 16
OK   messages absent from reference §6                       none
OK   TD §4 Mongo collections                                 9
OK   collections absent from reference §7                    none
---
AUDIT RESULT: 3 gap class(es) in the reference doc — each is fixed in docs/REQUIREMENT_TRACEABILITY.md
```

**Command 2 — validation of this document** (assertions (a)–(e) from the original W0 task, plus (f) the W1–W7 status-table refresh):

```console
$ node /tmp/a1-trace/check.mjs
PASS (a) PDF-ID table present — 18 rows
PASS (a) zero PDF IDs missing (PROJECT.md §7 = 18) — 18/18
PASS (a) zero duplicate PDF-ID rows — none
PASS (a) every PDF-ID row has >=1 implementation task — ok
PASS (a) all tasks in PDF-ID table exist in IMPLEMENTATION_PLAN — ok
PASS (b) FR rows = 30 defined — rows: 30
PASS (b) FR zero missing IDs — none
PASS (b) FR zero unexpected IDs — none
PASS (b) FR zero duplicate rows — none
PASS (b) FR every row has >=1 task — all 30 mapped
PASS (b) NFR rows = 17 defined — rows: 17
PASS (b) NFR zero missing IDs — none
PASS (b) NFR zero unexpected IDs — none
PASS (b) NFR zero duplicate rows — none
PASS (b) NFR every row has >=1 task — all 17 mapped
PASS (b) REC rows = 8 defined — rows: 8
PASS (b) REC zero missing IDs — none
PASS (b) REC zero unexpected IDs — none
PASS (b) REC zero duplicate rows — none
PASS (b) REC every row has >=1 task — all 8 mapped
PASS (c) zero task IDs cited that do not exist in IMPLEMENTATION_PLAN — 86 distinct task IDs cited, all valid
PASS (c) zero unknown requirement IDs cited — 55 known IDs cited
PASS (c) zero unknown IDs of an undeclared family
PASS (d) zero byte-identical duplicate requirement/task rows — none
PASS (d) zero rows with an empty cell (no orphan mapping) — none
PASS (e) pages table rows = 13 (PROJECT.md §10: 11 routes + 404 + 403) — 13 rows
PASS (e) every PROJECT.md §10 route appears in pages table — ok
PASS (e) endpoint rows = 23 (TECHNICAL_DESIGN §5.2) — 23 rows
PASS (e) every TD §5.2 path token appears in endpoint table — ok
PASS (e) every endpoint row has >=1 task — ok
PASS (e) local-channel message rows = 16 (TECHNICAL_DESIGN §6.2) — 16 rows
PASS (e) every TD §6.2 message name appears in message table — ok
PASS (e) Mongo collection rows = 9 (TECHNICAL_DESIGN §4) — 9 rows
PASS (e) every TD §4 collection appears in collection table — ok
PASS (f) implementation-status table present — 55 rows
PASS (f) status table covers all 55 requirements exactly once — 55/55
PASS (f) every status cell uses the documented legend — ok
---
VALIDATION RESULT: ALL 37 CHECKS PASS
```

What each assertion proves, in the task's terms:

| Required proof | Where it is demonstrated |
|---|---|
| (a) zero PDF IDs missing | Command 2, first five `PASS` lines: 18/18 from `PROJECT.md` §7, no duplicates, all rows carry an existing task |
| (b) zero FR/NFR/REC IDs without a task | Command 2: 30/30, 17/17, 8/8 rows, zero missing/unexpected/duplicate, every row has ≥1 valid task |
| (c) zero task IDs cited that do not exist | Command 2: 86 distinct task IDs cited, all found in `IMPLEMENTATION_PLAN.md` (plus the reference audit's `dangling ... none`) |
| (d) zero duplicate/orphan rows introduced | Command 2: no byte-identical duplicate rows; no row with an empty task/verification cell |
| (e) endpoint/page/message/collection counts match the design | Command 2: 23 endpoint rows (§5.2), 13 page rows (§10 + 404/403), 16 message rows (§6.2), 9 collection rows (§4) |
| (f) W1–W7 implementation status is complete and honest | Command 2: §18 status table present with exactly 55 requirement rows (30 FR + 17 NFR + 8 REC), each using the documented ✅/🟡/🔄/📋 legend; the rows name their evidence, their NEEDS-HUMAN parts, and (for P2) the DEC-027 descope |

Scope of these proofs, stated honestly: they check **blueprint-internal consistency** and the **mapping completeness** above. They do **not** prove PDF fidelity (BL-01) and they do not prove that a task is *done* — task status lives in `docs/AGENT_STATUS.md`.

## 18. Implementation status (W1–W7 refresh, 2026-11-11)

This section is the *implementation* mirror of the validated mapping above: the task links in §2–§5 do not change, but every requirement records **how far it is actually delivered and verified** on the merged product. Status was refreshed after the **W7 gate (PASS)**; W7 was **quality-only** (coverage gaps, client bundle split, real-browser accessibility, flake hardening, full-history secret scanning, packaged-artifact smoke — no wire or product-behaviour change, contracts still frozen at `contracts-v1`). **W8/W9 are submission items and stay human-gated**, and W10 P2 follows DEC-027 (T-133 partial, T-130/T-131/T-132 descoped) — none of that is claimed here as product scope.

**Evidence baseline at this refresh** (authoritative numbers: `docs/QA_NOTES.md` §9, gate row `docs/AGENT_STATUS.md` W7, ADR `docs/DECISIONS.md` DEC-026):

- **Unit/integration: 1421/1421 green across 111 files** — shared 175 · server 450 · client 251 · agent 545 (+217 W7 tests: server error-mapping/races/JWT/env, agent win32 FFI + drivers, client pages/routes/auth). Lint/format/typecheck/build clean; CI green on ubuntu-24.04 / macOS / Windows. *(Post-gate W10 note: the T-133 gamification in FR-018 adds 21 client component tests on top of the 251 — they are not folded into this gate figure.)*
- **Playwright E2E: 50 passed / 50, twice back-to-back, retries 0** (7.6 m / 7.0 m, 15 files): pairing (no reload), focus flow, sessions, real-scheduler schedule + missed run, admin, insights, notifications, settings, reconnect after a **real SIGKILL**, viewport (NFR-006 ×3), **real-browser axe on 14 routes** (NFR-008), perf (NFR-011) and security specs — all against the real dashboard, real API with a seeded in-memory MongoDB, and the real Electron Focus Agent. Two-run evidence and the enforced **E2E stability policy** are in `docs/QA_NOTES.md` §7–§8.
- **Coverage** (TECHNICAL_DESIGN §14 target 80 % lines): `shared` **100.00 / 95.45** · `server` **94.31 / 85.07** · `client` **87.45 / 79.09** · `agent` **93.13 / 81.70** (lines / branch) — every package above target (`docs/QA_NOTES.md` §3/§9).
- **Bundle:** route-level split — entry chunk **1,013.13 → 165.90 KiB raw (−83.6 %)**, eager first load **557.38 KiB raw / ~172 KiB gzip (−45 % / −41.6 %)**, largest chunk 368.95 KiB (`charts`, `/insights` only), **no chunk >500 kB**. No NFR threshold exists for bundle size; this is a quality improvement, measured in `docs/QA_NOTES.md` §2/§9.
- **NFR-011:** worst API p95 **7.22 ms** vs the 300 ms target (loopback, 200 req/endpoint, asserted in `e2e/perf.spec.ts`). Agent idle **CPU/RAM (<2 %, <200 MB) remains a Phase-8 OS measurement** — see §18.2, hence 🟡 below.
- **Security:** independent adversarial review, 148 checks, **0 Critical / 0 High**; the 3 Mediums fixed and regression-tested; remaining Low/accepted items documented (`docs/SECURITY_REVIEW.md` §8, DEC-025). **Supply chain:** gitleaks now scans the **full reachable history** on every push+PR — real proof 140 commits reachable / 104 scanned / 3.75 MB / **no leaks** (KI-021 fixed by narrowing the allowlist). Electron **fuses/asar gates green on the real CI artifacts**.
- **Accessibility:** real-browser axe (colour contrast enabled), **0 serious/critical and 0 other violations across 14 routes**, after three real a11y defects were fixed in source (DEC-026). jsdom axe tests remain the fast gate; `e2e/a11y.spec.ts` is the authoritative one.
- **Real-OS (macOS, P0):** `npx tsx scripts/verify/macos-focus-smoke.ts` → `PASS darwin/arm64` (real hide → separate-process verify → journal cleared → idempotent exit → restore; DEC-020).
- **Packaging:** release dry-run **`42977816541`** = **4/4 builds, fuses/asar gates green, 4/4 source `AGENT_SMOKE`, 4/4 packaged-artifact smoke** (macOS `.app`, Linux `squashfs-root`, Windows `win-unpacked`), publish job skipped → **0 GitHub Releases** (tag-only guard). Artifact sizes/sha256: `docs/RELEASE_HANDOFF.md` §4 and `docs/QA_CHECKLISTS.md` §2.
- **CI:** GitHub Actions matrix (Ubuntu 24.04, Windows, macOS) green on lint, format, typecheck, build and tests.

**Status legend:** ✅ **verified** (acceptance criteria have automated or real-OS evidence recorded at a wave gate) · 🟡 **partial** (implemented + tested, but a named part is NEEDS-HUMAN, or a P2 item is a scoped-down deliverable) · 🔄 **in progress** (current wave; not claimed) · 📋 **descoped/planned** (not implemented; a descope carries its ADR).

| ID | Pri | Status | Evidence (W1–W7) |
|---|---|---|---|
| FR-001 | P0 | ✅ verified | W1 auth integration tests (401/403/429, bcrypt cost 12, no password hash); W6 adversarial JWT matrix — alg=none, tamper, wrong iss/aud, expired, DB-authoritative role (SECURITY_REVIEW A1-00…A1-27); real-API E2E login; CI green on 3 OSes |
| FR-002 | P0 | 🟡 partial | Electron agent launches/pairs/reports in the real E2E; `AGENT_SMOKE` green locally + on all 4 CI OS builds; W6 fuses/asar verified on artifacts. Native tray/menu-bar **visuals** are NEEDS-HUMAN (KI-013, QA_CHECKLISTS T-101) |
| FR-003 | P0 | ✅ verified | W2 real pairing E2E (real Electron agent → real code → `POST /devices/pair` → Connected badge via Ed25519 attestation); KI-010 reload gap fixed at W4 and re-verified |
| FR-004 | P0 | ✅ verified | Link integration tests + real E2E over `ws://127.0.0.1`; badge transitions assert no page reload (pair + unpair); W6 link-abuse tests (16 KB/3-conn/20 msg-per-s/Origin/Host/subprotocol) |
| FR-005 | P0 | ✅ verified | W3 FakeDriver focus E2E (consent → countdown → aside → end) + real macOS hide verified by `scripts/verify/macos-focus-smoke.ts`; Windows/Linux runtime needs T-100/T-102 |
| FR-006 | P0 | ✅ verified | W3 journal-first idempotent restore tests + focus E2E; real macOS restore verified from a separate process; W6 reconnect E2E proves restore after SIGKILL/relaunch |
| FR-007 | P0 | ✅ verified | Countdown derived from the agent's absolute `endsAt` in E2E; timer/auto-end/sleep accounting unit-tested; custom 1–480 validation tested |
| FR-008 | P0 | ✅ verified | W1 property tests (protected never a candidate) + allow-list API rejecting protected changes (`PROTECTED_ENTRY`, 4 attack shapes) + E2E + locked UI rows; W6 adversarial INV-3 checks (SECURITY_REVIEW E1-01…E1-05) |
| FR-009 | P0 | ✅ verified | `enterFocus` cannot be sent before Confirm (spy test), consent payload/contents tested, global focus indicator on every authenticated route; F-101 guard blocks Start while the allow-list is loading/failed (W5 take) |
| FR-010 | P0 | ✅ verified | Sessions API (filters, pagination, sort, capped actualMinutes) + `api-sessions` / `session-reporting` E2E; dashboard history cards live |
| FR-011 | P1 | 🟡 partial | macOS real verified (DEC-020). Windows/Linux drivers implemented behind the frozen `FocusDriver`, covered by mocked-native contract suites + real abuse tests + CI builds; runtime NEEDS-HUMAN (KI-005) — checklists T-100/T-102 |
| FR-012 | P1 | ✅ verified | Real-scheduler E2E (create → minute tick → `scheduleDue` → ≥10 s cancellable heads-up → source SCHEDULE session → run recorded); timezone/DST unit tests; DEC-021 run lifecycle |
| FR-013 | P1 | ✅ verified | W5: insights service + `/insights` page; hand-computed fixtures (Asia/Kolkata 7d, UTC override, Europe/London DST), E2E insights spec, empty state (W5 gate + W6 gate) |
| FR-014 | P1 | ✅ verified | W2 reconnect/backoff+heartbeat, W3 sleep/resume + crash reconcile; **W6 T-080**: reconnect E2E with real SIGKILL (lost-contact → relaunch → journal recovery → CRASH_RECOVERY), stale-control/`1008` hardening. Physical sleep/wake remains a Phase-8 item (NEEDS-HUMAN) |
| FR-015 | P2 | 📋 descoped | **T-130 descoped (DEC-027)** — an MV3 extension + block-list UI is a second distributable with its own permission model, messaging and release lane; not required by any P0/P1 requirement, would need a new CI/release lane and a permissions security review, and could not be verified on the remaining human-gated OS matrix. **Not claimed** (assumption A-12 stays an assumption) |
| FR-016 | P2 | 📋 descoped | **T-131 descoped (DEC-027)** — Pomodoro cycles + ambient sounds bundle third-party audio assets (licensing/provenance) and change the frozen focus-session lifecycle (breaks/restores) the scheduler, session contract and journal were built around. The P1 focus flow is verified and stable, so this stays out. **Not claimed** |
| FR-017 | P2 | 📋 descoped (intent met) | **T-132 descoped (DEC-027)** — remote multi-device start would need **cloud→agent control messages**, which INV-2 forbids (cloud→agent is exactly `[scheduleDue, revoked]`). FR-017's intent (manage multiple devices, per-device sessions) **is met** by the Devices page + per-device session records; a remote-start picker is a design change, not a bonus. **Not claimed** |
| FR-018 | P2 | 🟡 partial | **T-133 partial (DEC-027)** — `/insights` ships **achievement badges** (thresholds read from the real `GET /insights` payload: completed sessions, streak, focus minutes, session count, peak hour) and a **device-local weekly goal** (`localStorage`, per-user key, "stored on this device" copy, no API write, no fabricated progress; 30/90-day ranges reuse the chart's weekly buckets). **No leaderboard / opt-in comparison between users** — it would need new profile fields, a public ranking endpoint and consent copy, so it is explicitly out of scope rather than half-built. Implemented in `client/src/components/insights/{achievements,weekly-goal}.tsx`, wired into `/insights`, with **21 component tests** in `achievements.test.tsx` + `weekly-goal.test.tsx` (2 files green locally). This W10 work is **post-W7-gate**: it is not part of the 1421/251 gate counts above and not part of the 0.1.0 P0/P1 scope |
| FR-019 | P0 | ✅ verified | W5 admin APIs + `/admin` page (users search/paginate/deactivate, presets, agent links, **aggregate-only** stats) + E2E USER→403; W6 security fix: deactivation revokes devices, refuses agent reports, skips schedules (F-03, C-25) |
| FR-020 | P0 | ✅ verified | Allow-list GET/PUT + presets (merge/replace) tests, protected rows preserved, UI editor with `listApps` picker + rollback; C-16/DEC-019 |
| FR-021 | P0 | ✅ verified | All 13 routes real with role guards + loading/empty/error/success states (W1–W5); E2E covers every page incl. landing, notifications bell, settings, admin; **W7 axe: 0 violations across 14 routes** in real Chromium (colour contrast on), 3 real a11y defects fixed in source |
| FR-022 | P0 | 🟡 partial | Agent window states, countdown, locked allow-list rows, tray End focus/Quit, consent status/revoke (W3 + W6 tests). Native tray/notification **visuals** NEEDS-HUMAN (KI-013) |
| FR-023 | P0 | ✅ verified | Journal-first ordering test (driver call log), crash recovery on startup, kill-during-write safety; real macOS journal clear; W6 real-SIGKILL reconnect E2E asserts CRASH_RECOVERY finalisation |
| FR-024 | P0 | ✅ verified | `ALREADY_FOCUSING` / `focusRejected` tests + sessions API 409 (partial unique index) + E2E |
| FR-025 | P1 | ✅ verified | W4 MISSED path + notification unit tests; W5 notifications REST/UI; **W6 missed-run E2E un-gated and green** (offline at due minute → MISSED + notification, no focus) |
| FR-026 | P0 | ✅ verified | TTL 10 min, single-use, ≤5-attempt latch (5th→400, 6th→410), hash-only storage tests (DEC-014/DEC-017); W6 adversarial pairing checks (SECURITY_REVIEW §3.2) |
| FR-027 | P0 | ✅ verified | Dashboard-closed reporting E2E — agent reports the end, exactly one finalised session persisted (idempotent `clientSessionId`); W6 reconnect spec re-covers it |
| FR-028 | P1 | ✅ verified | Reaper tests for stale ACTIVE sessions (heartbeat-bounded actualMinutes) + analytics definitions unit-tested (ACTIVE never counted) |
| FR-029 | P0 | ✅ verified | W5 `/settings` + `/users/me` (C-21), password change, `POST /devices/unpair-all` (C-23) revoking every agent, download links; E2E settings spec |
| FR-030 | P0 | ✅ verified | Idempotent seed tests (run twice → identical counts), refuses production without `--force`; same seed powers E2E |
| NFR-001 | — | ✅ verified | Shared zod schemas used by client + server; `VALIDATION_ERROR` with `details[]` tests; inline field errors tested; W6 mass-assignment/prototype rejection |
| NFR-002 | — | ✅ verified | Central error middleware: forced 500 generic, no `stack` in JSON; W6 **F-01** malformed-id 404s and **F-02** deep-JSON 400s fixed + regression-tested |
| NFR-003 | — | ✅ verified | CORS allow-list, helmet (credentials off), env-driven rate limits (429/400/410 tested incl. XFF spoofing), `$ne`/operator stripping, cross-user → 404; W6 adversarial access-control matrix (SECURITY_REVIEW §3.5–3.6) |
| NFR-004 | — | ✅ verified | Zod-validated env modules per package + CI gitleaks scan (narrow allowlist, **full reachable history** since W7); no hard-coded URLs outside config modules |
| NFR-005 | — | ✅ verified | ESLint 10 + Prettier; lint/format:check green locally and in the 3-OS CI matrix |
| NFR-006 | — | ✅ verified | `e2e/viewport.spec.ts` — no horizontal scroll at 360×740, 768×1024, 1440×900 with a real browser layout (Playwright); re-run in both W7 gate passes (50/50 ×2) |
| NFR-007 | — | ✅ verified | Loading/empty/error/success states implemented and tested on every data-driven page (W1–W5 pages + E2E per page); retry/error boundaries in pages; W7 added the accessible Suspense fallback for the 8 lazy routes |
| NFR-008 | — | ✅ verified | **W7 (authoritative):** real-browser axe in Chromium at 1440×900 with colour contrast enabled — **0 serious/critical and 0 other violations across 14 routes** (`e2e/a11y.spec.ts`), after three real defects fixed in source (landing/download names, Insights chart `aria-hidden` wrapper, account-menu accessible name — DEC-026); contrast tokens 43/43 PASS (UX_SPEC) |
| NFR-009 | — | ✅ verified | `/api/v1` base, Bearer auth, status codes, list shape `{items,page,limit,total,totalPages}` — contract + integration tests per route; C-21…C-26 |
| NFR-010 | — | ✅ verified | Link server binds 127.0.0.1 only; foreign Origin/Host rejected at upgrade; unauthenticated message limits + abuse tests; LAN unreachable by binding |
| NFR-011 | — | 🟡 partial | **API latency verified:** `e2e/perf.spec.ts` — worst p95 **7.22 ms** vs 300 ms target (loopback, 200 req/endpoint, asserted in the spec), re-run in both W7 gate passes. **Caveat:** agent idle **CPU/RAM (<2 %, <200 MB)** is an OS-level Phase-8 measurement that no worker can take in this session — see §18.2, so the NFR is not claimed complete |
| NFR-012 | — | ✅ verified | Real unsigned installers for 4 targets from CI run **`42977816541`**: 4/4 builds + 4/4 `AGENT_SMOKE` + **4/4 packaged-artifact smoke** (macOS `.app`, Linux `squashfs-root`, Windows `win-unpacked`), fuses/asar gates PASS, 0 releases (tag-only guard). **Installer-level launch on each OS and signing remain NEEDS-HUMAN** (T-100/T-101/T-102) |
| NFR-013 | — | ✅ verified | Least-data payloads + strict schemas (unknown fields rejected); INV-6 source/tests (no title/URL APIs) + human log spot-check in QA_CHECKLISTS |
| NFR-014 | — | ✅ verified | Strict TS + per-module header comments across packages; **`docs/VIVA_NOTES.md` exists (W6)** with per-module viva notes and ADR citations |
| NFR-015 | — | 🟡 partial | Conventional commits / branch-per-feature; every **human** member appearing in history is a human action (D-09, AGENTS §6) |
| NFR-016 | — | ✅ verified | pino redaction test (authorization/password/tokens) + request ids; agent electron-log event-only, secret-free logs (W6 agent abuse tests) |
| NFR-017 | — | 🟡 partial | Deploy config sketch + local setup verified; live deployment (T-120/T-121) is W9 and needs hosting credentials (`docs/DEPLOYMENT.md`, BL-07) |
| REC-001 | P0 | ✅ verified | Cloud `/agent-link` hub: device-token auth, 15 s heartbeat, 45 s disconnect, INV-2 enforced by shared tests + hub tests; agent reporting idempotent |
| REC-002 | P0 | ✅ verified | Two-stage pairing digest per DEC-014; register/pair/poll + token-once tests, real pairing E2E; W6 F-04/F-06 follow-ups (enroll-poll oracle Low, limiter added) documented |
| REC-003 | P0 | ✅ verified | EdDSA attestation (node:crypto, DEC-016): wrong nonce/expiry/user rejected; unauth `enterFocus` → `focusRejected{UNAUTHENTICATED}`; W6 **C-26** server-side single-use nonce replay cache (defence-in-depth) |
| REC-004 | P0 | 🟡 partial | Native first-run consent gate tested (cannot be answered by the page; stored/versioned/revocable); dialog visuals NEEDS-HUMAN + E2E uses a test seam (KI-011) |
| REC-005 | P1 | ✅ verified | Enforcement loop tested with the FakeDriver call log: re-asides new windows, never protected, stops on exit, disabled → zero extra calls |
| REC-006 | P0 | ✅ verified | `clientSessionId` idempotency tests + E2E: duplicate reports merge, no double count; dashboard-closed and reconnect paths covered |
| REC-007 | P1 | ✅ verified | `listApps`/`apps` local messages implemented (key+label+running only) and consumed by the allow-list picker |
| REC-008 | P0 | 🟡 partial | Default-off behaviour unit-tested (tray menu + view-model); the literal tray toggle interaction is NEEDS-HUMAN (KI-013) |

### 18.1 Hardening + quality evidence — SEC-1…SEC-10, C-21…C-26, DEC-025, DEC-026

| Item | Evidence | Status |
|---|---|---|
| SEC-1 bcrypt ≥12 | stored `$2b$12$…`; `BCRYPT_COST = 12` (SECURITY_REVIEW S1-01) | ✅ PASS |
| SEC-2 HS256 / 30 min / ≥32-byte secret | real login token `alg=HS256 ttl=1800`; env enforces ≥32 chars; alg pinned (A1 matrix) | ✅ PASS |
| SEC-3 helmet + strict CORS | helmet headers + CORS reflects only `CLIENT_URL`, `credentials:false` (SECURITY_REVIEW F1/F2) | ✅ PASS |
| SEC-4 rate limits | auth 30→429, pairing 400×5→410→429, agent register 5/min→429, XFF spoof does not reset (F3-01…F3-04) | ✅ PASS |
| SEC-5 pairing digest/TTL/single-use | DEC-014 digest + DEC-017 per-user latch; B1-01…B1-03, S6-01 | ✅ PASS (residual per-user latch documented) |
| SEC-6 device token 256-bit, hashed at rest, revocable | only `deviceTokenHash` stored; revoke deletes credentials (S6-01, B2-03/04) | ✅ PASS |
| SEC-7 EdDSA 60 s nonce-bound | B3-01, B4-01…B4-06, B5-01…B5-06; **C-26** single-use server-side nonce cache added (DEC-025) | ✅ PASS |
| SEC-8 Electron hardening + fuses | `contextIsolation`/`sandbox`/CSP/hardening tests; **fuses/asar gates green on real CI artifacts** (`verify-fuses.mjs`, run `42977816541`); packaged-runtime *installer* launch is NEEDS-HUMAN | ✅ PASS (source + artifacts) |
| SEC-9 operator/prototype stripping | `email.$ne` rejected with path; prototype-pollution/mass-assignment checks (D1-01…D1-06) | ✅ PASS |
| SEC-10 least-data payloads | no `passwordHash`, aggregate-only stats, whitelist mappers (D2-10/D2-11) | ✅ PASS |
| C-21 `GET /users/me` | implemented + contract-tested (46-operation table) | ✅ folded |
| C-22 `GET /notifications` `unreadCount` + idempotent read | implemented + tests/E2E | ✅ folded |
| C-23 `POST /devices/unpair-all` | pushes `revoked` then deletes devices; E2E settings | ✅ folded |
| C-24 `GET /insights` optional `weekly` (30d/90d) | implemented + fixture tests | ✅ folded |
| C-25 admin filters / self-protection 409 / https agent-links / `/health/db` | implemented + tests; `GET /health/db` readiness 503 with `INTERNAL` | ✅ folded |
| C-26 attestation nonce replay cache | server-side, process-local and bounded (5 000 live keys) replay cache on `POST /devices/:id/attest`; replay of `(userId, deviceId, nonce)` inside the 60 s TTL → **409 CONFLICT** with no attestation (DEC-025, SECURITY_REVIEW §8) | ✅ **folded in W9** — A2 folded it into `docs/INTEGRATION_CONTRACTS.md` (§3.1 note, §11 row 11, §12, §13) and signed the W7 contract review |
| DEC-025 (security posture, measurable targets, test-only rate-limit knob) | security 0 Critical/High · NFR-011 p95 7.22 ms · coverage ≥80 % · NFR-006/008 automated · `RATE_LIMIT_AGENT_REGISTER_MAX` test-only (prod default 5/min unchanged) | ✅ accepted |
| DEC-026 (W7 quality gate) | coverage **1421** tests with every package ≥80 % lines · real-browser axe **0 violations / 14 routes** · bundle entry **−83.6 %** / eager −45 % / no chunk >500 kB · **gitleaks full history** 140 reachable / 104 scanned / no leaks · **packaged smoke 4/4** on `42977816541` · 3 real product bugs found+fixed by the test work | ✅ accepted |
| W7 test-consolidation evidence | +217 behaviour tests (server error-mapping/real `E11000`/races/EdDSA JWT/env, agent win32 FFI + driver matrix, client pages/routes/auth); weak files closed (`win32.ts` 56.77→96.61 %, `mongo-errors.ts` 62.5→100, `jwt-eddsa.ts` 29.72→100, `env.ts` 69.56→100, `session-id.ts` 20→100, `login.tsx` 58.33→100) | ✅ PASS (`docs/QA_NOTES.md` §9) |
| W7 E2E stability | 50/50 twice back-to-back, retries 0, 15 files; per-spec durations + policy in `docs/QA_NOTES.md` §7–§8.2; flake determinism fixed (base64url padding, lazy-route content waits, 3-minute schedule-lead guard) | ✅ PASS |

### 18.2 NEEDS-HUMAN register (what no worker can verify here)

| Item | Why | Checklist / evidence required |
|---|---|---|
| Windows 10/11 real window control (FR-005/FR-006/FR-011) | No Windows desktop in this session (KI-005) | `docs/QA_CHECKLISTS.md` §3 (T-100 W-01…W-18) |
| Linux X11 real window control (FR-005/FR-006/FR-011) | No Linux desktop in this session (KI-005) | `docs/QA_CHECKLISTS.md` §5 (T-102 L-01…L-14) |
| macOS Phase-8 extras (FR-002/FR-022/REC-004/REC-008) | Native tray menus/notifications cannot be driven by Playwright (KI-011/KI-013) | `docs/QA_CHECKLISTS.md` §4 (T-101 M-01…M-18) |
| Agent idle CPU / RAM (NFR-011 remainder) | OS-level measurement | Phase-8 observation on each OS; record in `docs/QA_REPORT.md` |
| Installer-level launch per OS (NFR-012) | CI now proves the **packaged payload boots** (4/4 packaged-artifact smoke on `42977816541`), not that the installed dmg/exe/AppImage launches from a desktop | QA_CHECKLISTS W-01/M-01/L-01, W-17/M-17/L-14 |
| Signing / notarisation + tag publishing | No certificates; tags are maintainer-pushed — runbook: `docs/RELEASE_HANDOFF.md` §2–§5, `docs/RELEASING.md` §5–§6 | maintainer only; AI workers never run git |
| Every human in git history (NFR-015) | Only humans author/merge their own commits (D-09) | `git shortlog -sn` at the release gate + hand-off lists |
| Live deployment (NFR-017) | Needs hosting credentials + a real public URL | `docs/DEPLOYMENT.md`; local fallback is permitted by `[PDF §19]` |

### 18.3 Remaining scope after W7 (honest)

- **W7 — done (quality only):** coverage gaps closed, route-level client bundle split, real-browser axe, flake hardening, full-history secret scan, packaged-artifact smoke. No product or wire-format change; §18 statuses moved only where the evidence changed (NFR-008 now cites 14 routes, NFR-011 is honestly 🟡 on the CPU/RAM caveat, NFR-012 cites the packaged-smoke run).
- **W8:** the Phase-8 human checklists (`docs/QA_CHECKLISTS.md`) must be executed on real desktops; only then can FR-011 / AGENT-1 / REC-004 / REC-008 move from 🟡 to ✅.
- **W9:** signing/tag/release (`docs/RELEASE_HANDOFF.md`, `docs/RELEASING.md`, `RELEASE_NOTES.md`), live deployment (T-120/T-121, `docs/DEPLOYMENT.md`), final `PROMPTS.md`/`VIVA_NOTES` pass, demo recording (`docs/DEMO_SCRIPT.md`); `docs/QA_REPORT.md` is compiled and C-26 is folded into the contracts.
- **W10:** P2 per **DEC-027** — T-133 shipped as a **partial** (FR-018 badges + device-local weekly goal, **no leaderboard**); **T-130/T-131/T-132 descoped** with recorded reasons. None of the descoped items are part of 0.1.0 or claimed anywhere.

### 18.4 Scope of this status table

- The status column reflects **evidence recorded at wave gates** (`docs/AGENT_STATUS.md`, `docs/QA_NOTES.md` §9, `docs/SECURITY_REVIEW.md`, `docs/DECISIONS.md`) — not intentions, and not the task checkboxes in `IMPLEMENTATION_PLAN.md`.
- ✅ means the requirement's acceptance criteria have automated or real-OS evidence in this repo/CI; it does **not** mean the PDF itself was available to diff against (BL-01/DEC-003, §16 D-10).
- This table is refreshed at each gate (last: **W7**, 2026-11-11). The same statuses feed the `README.md` feature table; W8/W9 will only flip the NEEDS-HUMAN rows (FR-011, AGENT-1, REC-004, REC-008, NFR-011 CPU/RAM, NFR-012 installer launch) once the human evidence exists, and P2 rows follow DEC-027.
