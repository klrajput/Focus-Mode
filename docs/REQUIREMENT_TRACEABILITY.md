# REQUIREMENT_TRACEABILITY.md — validated PDF-ID → requirement → task coverage

> **Owner:** A1 (Requirements Analyst) · **Task:** T-003 (W0 gate) · **Status:** validated, 2026-11-10 IST.
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

Method: the markdown was parsed programmatically (`node` v26.11.1) — IDs regex-extracted from `PROJECT.md`, `REQUIREMENTS.md`, `IMPLEMENTATION_PLAN.md`, `TECHNICAL_DESIGN.md` and this file — and the five required assertions were executed as real checks. The checker scripts live in `/tmp/a1-trace/` (`lib.mjs`, `audit-blueprint.mjs`, `check.mjs`) so the repository does not gain an unowned script; A0 may decide later whether to keep them under `scripts/`.

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

**Command 2 — validation of this document** (the five required assertions):

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
---
VALIDATION RESULT: ALL 34 CHECKS PASS
```

What each assertion proves, in the task's terms:

| Required proof | Where it is demonstrated |
|---|---|
| (a) zero PDF IDs missing | Command 2, first five `PASS` lines: 18/18 from `PROJECT.md` §7, no duplicates, all rows carry an existing task |
| (b) zero FR/NFR/REC IDs without a task | Command 2: 30/30, 17/17, 8/8 rows, zero missing/unexpected/duplicate, every row has ≥1 valid task |
| (c) zero task IDs cited that do not exist | Command 2: 86 distinct task IDs cited, all found in `IMPLEMENTATION_PLAN.md` (plus the reference audit's `dangling ... none`) |
| (d) zero duplicate/orphan rows introduced | Command 2: no byte-identical duplicate rows; no row with an empty task/verification cell |
| (e) endpoint/page/message/collection counts match the design | Command 2: 23 endpoint rows (§5.2), 13 page rows (§10 + 404/403), 16 message rows (§6.2), 9 collection rows (§4) |

Scope of these proofs, stated honestly: they check **blueprint-internal consistency** and the **mapping completeness** above. They do **not** prove PDF fidelity (BL-01) and they do not prove that a task is *done* — task status lives in `docs/AGENT_STATUS.md`.
