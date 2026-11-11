# Security Review — Focus Mode (independent adversarial review)

> **Task:** `task-42` (W6-Security-Review) · **Reviewer:** A9 (QA & Security Engineer, independent of W6 implementers)
> **Date:** 2026-11-10 · **Verdict: no Critical, no High findings.** 7 findings (3 Medium, 4 Low) — see §4.
> **Scope snapshot:** `main` @ `05e6187` (`build(release): wire electron fuses and verify packaged artifacts`) plus the W6 working-tree edits by A5/A7/A10 that were live during the review. 148 adversarial checks: **132 pass, 16 fail**; the 16 failing checks map to F-01…F-06, and F-07 is a configuration observation with no failing check.
> **Rules followed:** no product source was edited; only this file and rows appended to `docs/KNOWN_ISSUES.md`; all attack scripts live in `/tmp`; only loopback / the throwaway in-memory DB were attacked.

---

## 1. Scope, method, environment

### 1.1 In scope

| Area | What was attacked |
|---|---|
| REST auth / tokens | alg=none, tampered payload/signature, expiry, iss/aud, HS512 confusion, foreign secret, DB-role vs token-role, deactivated user, malformed `sub`, Authorization header variants, 401/403 role matrix, password change + old token, logout + old token |
| Pairing (REC-002 / DEC-014 / DEC-017) | 6-digit brute force + per-user latch, single-use replay, enroll-poll token leakage, enrollment-secret guessing, device-token guessing, revocation/rotation |
| Attestation (REC-003 / SEC-7 / DEC-016) | issue-time claims, captured-attestation replay, forged Ed25519 key, alg=none, wrong `aud`, wrong `sub`, expired, over-long TTL, `nbf`, malformed JWTs, unauthenticated control frames |
| Local channel (loopback WS) | foreign Origin, absent Origin, DNS-rebinding Host, missing subprotocol, wrong path, oversized frame, binary frame, >20 msg/s flood, 4th connection, unauth control, wrong-direction frames, pairing-code capture |
| Input / injection | `$ne`/`$gt` in body & query, `__proto__`/`constructor.prototype`, regex injection in three searches, oversized JSON, malformed JSON, malformed ObjectIds, deep-nesting, stored XSS (API + real Chromium) |
| Access control / IDOR | cross-user devices / attest / sessions / schedules / notifications / allow-lists, USER→admin endpoints, admin stats leakage, self-demotion / self-deactivation |
| Rate limits / CORS / headers / secrets | auth 10/15 min/IP, pair 10/min/user, register 5/min/IP, attest 30/min/user, foreign-origin preflight, helmet set, framework/stack leakage, repo secret scan, `.env` tracking |
| Privacy invariants | INV-6 window-title/URL greps (all drivers), telemetry greps, INV-3 protected-set attempts, packaged-build FakeDriver guard, Electron hardening + CSP, log hygiene |

### 1.2 Out of scope / NEEDS-HUMAN

Native/OS-level behaviour that this environment cannot honestly prove (see §7): real Windows/Linux window control, the native tray and native consent/heads-up dialogs, notarized installers with fuses flipped, and OS-level packet/trace proof that no title/URL ever leaves the machine. Where only source-level proof is possible, this review says so explicitly instead of claiming a runtime pass.

### 1.3 Harness — what “real” means here

* **Real API**: `server/src/server.ts` (`startServer`) with a real `mongodb-memory-server` Mongo, the DEC-013 demo seed, real `node-cron` scheduler, real agent-link hub. Port `5399` (the E2E harness port was occupied by another worker; nothing external was touched).
* **Real Focus Agent security modules**: `agent/src/link/server.ts` (the Electron-free `LinkServer`) instantiated with the real `AttestationGate` from `agent/src/link/attestation.ts`, pointed at the real `GET /agent/attest-key`, exactly as `main.ts` wires it.
* **Real cloud channel**: `ws` clients on `/api/v1/agent-link` with real device tokens, so device presence is set by the hub itself (not a DB fixture).
* **Real dashboard**: Vite dev server (`client`, `VITE_API_BASE_URL=http://127.0.0.1:5399/api/v1`) + Playwright Chromium (`PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers`) for the stored-XSS render check.
* **Fixtures**: users inserted directly into the throwaway DB where a test needed a second/third account (setup only — every credential/authorisation path under test is the real one). Tokens are minted with the same HS256 secret/iss/aud the server uses, which is the same thing an attacker with a leaked secret could do; all *rejections* are server-side.
* Harness scripts: `/tmp/a9-lib.ts`, `a9-boot.ts`, `a9-link.ts` and one script per attack group (manifest in Appendix B).

### 1.4 Snapshot caveat (KI-012 — concurrent W6 work)

W1–W5 are merged, but W6 hardening was being written **in the same checkout** while this review ran (A5 server, A7 agent, A10 packaging, A4 client). At one point `server/src/services/*.service.ts` were replaced by an in-flight variant that answered `404` for malformed ids and were then restored to the `HEAD` version (observed mtime 23:33, `git status` clean for those files). To keep the evidence honest, **every suite was re-run in one clean pass after the tree settled**; the results below are from that pass, pinned to:

```
snapshot taken: 2026-11-10T18:06:57Z (UTC)
05e6187ed697be99df6bae6e4f8164288ab1a0fb
 M agent/build/flip-fuses.mjs
 M agent/src/hardening.test.ts
 M agent/src/link/{auth,control.integration,server}.test.ts
 M agent/src/link/server.ts
 M agent/src/main.ts
 M e2e/helpers/{agent,auth,features,start-api}.ts
 M server/.env.example
 M docs/AGENT_STATUS.md
?? agent/src/log-secrets.test.ts  ?? e2e/{perf,reconnect,security,viewport}.spec.ts
?? e2e/helpers/spawn-api.ts        ?? scripts/verify/smoke-packaged.mjs
```

The findings must be re-confirmed on the final W6 merge; the fixes are cheap and local (see §4).

### 1.5 Reproducing (on this machine)

```bash
# 1. throwaway stack: memory Mongo + real API (writes /tmp/a9-stack.json)
cd /Users/geetakumari/Desktop/FocusMode && npx tsx /tmp/a9-boot.ts
# 2. one suite at a time (each suite expects a freshly restarted API for limiter stores)
/tmp/a9-restart.sh && cd /tmp && npx tsx a9-auth.ts        # etc: a9-pairing, a9-attest,
#   a9-local, a9-app, a9-http, a9-browser, a9-final, a9-params, a9-deact, a9-facts, a9-depth
# 3. browser check needs the dashboard dev server:
cd client && VITE_API_BASE_URL=http://127.0.0.1:5399/api/v1 npx vite --port 5173 --strictPort
```

Environment: macOS arm64, Node 26.11.1, `MONGOMS_DOWNLOAD_DIR=$PWD/node_modules/.cache/mongodb-memory-server`.

---

## 2. Executive summary

**No Critical and no High vulnerabilities were found.** The security core is genuinely solid: algorithm pinning on both token types, DB-authoritative roles, constant-time digest comparisons, hashed device tokens, single-use nonce-bound EdDSA attestations, Origin+Host+subprotocol gating on the loopback socket, strict zod schemas plus a pre-validation operator/prototype filter, per-route rate limits at the documented thresholds, helmet/CORS, no telemetry, no window-title/URL APIs, and React escaping with zero XSS sinks.

Seven defects are reported below (six confirmed by a failing attack check, one by configuration inspection). None of them grants cross-user or cross-tenant access; the three Medium findings are an offboarding gap and two input-robustness (500-instead-of-4xx) bugs.

| ID | Severity | Finding | Owner |
|---|---|---|---|
| F-01 | **Medium** | Malformed ObjectId path params return **500 INTERNAL** on `DELETE /devices/:id`, `POST /devices/:id/attest`, `PATCH /sessions/:id` and `POST /allowlist/preset/:id` (NFR-002 violation; stack traces in logs) | A5 |
| F-02 | **Medium** | A ~4 KiB deeply-nested JSON body from an **unauthenticated** caller returns 500 (recursive `findForbiddenKeys` stack overflow) on any path | A5 |
| F-03 | **Medium** | Deactivating an account does **not** revoke its device token; its agent keeps reporting, keeps a valid `/agent/allowlist`, and the scheduler still dispatches `scheduleDue` to it | A5 |
| F-04 | Low | `POST /agent/enroll/poll` distinguishes “paired and consumed” (410) from “unknown” (404) for a known device id — a small state oracle, no token leak | A5 |
| F-05 | Low | Access tokens are not invalidated by password change or logout (stateless JWT, 30-min TTL). Documented behaviour, accepted risk | A5 (documented) |
| F-06 | Low | `POST /agent/enroll/poll` has **no rate limiter** (not required by SEC-4, but it is the one unauthenticated DB-touching endpoint without one) | A5 |
| F-07 | Low | `.gitleaks.toml` allowlists **every** `*.md` file, so a real secret pasted into documentation would not fail CI | A10/A0 |

### Requirement scorecard

| Req | Result | Evidence |
|---|---|---|
| SEC-1 bcrypt ≥ 12 | **PASS** | stored `$2b$12$…` (S1-01); `BCRYPT_COST = 12` in `auth.service.ts`/`user.service.ts` |
| SEC-2 HS256, 30 min, secret ≥ 32 B | **PASS** | real login token `alg=HS256 ttl=1800 iss=focus-mode-api aud=focus-mode-dashboard` (S2-01); `env.ts` enforces ≥32 chars |
| SEC-3 helmet + strict CORS | **PASS** | F1-01…03, F2-01…02 |
| SEC-4 rate limits | **PASS** | F3-01 (30→429), F3-02 (400×5, 410×5, 429), F3-03 (5/min then 429), F3-04 (10 then 429; XFF spoofing does not reset) |
| SEC-5 pairing digest/TTL/single use | **PASS** (residual DEC-017) | B1-01…03, S6-01; latch per user as ratified |
| SEC-6 device token 256-bit, hash at rest, revocable | **PASS** | S6-01 (only `deviceTokenHash`), B2-03/04, B7-01 |
| SEC-7 EdDSA, 60 s, nonce-bound | **PASS** | B3-01, B4-01…06, B5-01…06 |
| SEC-8 Electron hardening | **PASS (source + suites)** | `contextIsolation:true, sandbox:true, nodeIntegration:false, webSecurity:true`, CSP `default-src 'none'`, fuses (RunAsNode/NodeCliInspect disabled), `hardening.test.ts` 18 pass, `ui-security.test.ts` 13 pass; packaged-runtime check → NEEDS-HUMAN |
| SEC-9 operator/prototype stripping | **PASS** | D1-01 (`email.$ne` rejected with path), D1-02…06 |
| SEC-10 least-data payloads | **PASS** | D2-10 (no `passwordHash`), D2-11 (aggregate-only stats), whitelist mappers |
| INV-2 cloud→agent = `scheduleDue`,`revoked` only | **PASS** | `shared/src/protocol.test.ts` 71 pass |
| INV-3 protected set | **PASS** | E1-01…05 |
| INV-6 no titles/URLs | **PASS (source)** | greps in §3.7 + `source-guard.test.ts` 13 pass |

---

## 3. Results matrix

Verdict meaning: **PASS** = behaves as the threat model/requirements require. **FAIL** = observable defect (mapped to a finding in §4). Evidence IDs are reproduced verbatim in Appendix A.

### 3.1 Auth & tokens (SEC-2, FR-001)

| ID | Attack | Expected | ACTUAL | Verdict |
|---|---|---|---|---|
| A1-00 | valid HS256 token | 200, no hash | `200 role=USER hashLeak=false` | PASS |
| A1-01 | `alg=none` claiming ADMIN | 401 | `401 UNAUTHENTICATED` | PASS |
| A1-02 | payload tampered to `role:ADMIN`, original signature | 401 | `401 UNAUTHENTICATED` | PASS |
| A1-03 | flipped signature bytes | 401 | `401 UNAUTHENTICATED` | PASS |
| A1-04 | expired token | 401 | `401 UNAUTHENTICATED` | PASS |
| A1-05/06 | wrong `iss` / wrong `aud` | 401 | `401 UNAUTHENTICATED` (both) | PASS |
| A1-07 | HS512 signed with the real secret | 401 (alg pinned) | `401 UNAUTHENTICATED` | PASS |
| A1-08 | token signed with attacker secret | 401 | `401 UNAUTHENTICATED` | PASS |
| A1-09 | USER token with `role:ADMIN` claim | 403 (DB authoritative) | `403 FORBIDDEN` | PASS |
| A1-10 | `sub` not an ObjectId | 401, never 500 | `401 UNAUTHENTICATED` | PASS |
| A1-11 | token of a user deactivated after issue | 403 | API `403 ACCOUNT_DISABLED`, login `403 ACCOUNT_DISABLED` | PASS |
| A1-12…17 | absent / no-scheme / lowercase `bearer` / Basic / empty / garbage | 401 each | `401 UNAUTHENTICATED` ×6 | PASS |
| A1-18…21 | anonymous devices/sessions/schedules/admin | 401 | `401` ×4 | PASS |
| A1-22 | USER → `/admin/stats` | 403 | `403 FORBIDDEN` | PASS |
| A1-23…25 | ADMIN → devices/sessions/allowlist | 403 | `403 FORBIDDEN` ×3 | PASS |
| A1-26/27 | ADMIN → `/admin/stats`, `/users/me` | 200 | `200` | PASS |
| A1-28 | password change, then reuse old token | ideally 401 | old token **still 200**; old password 401, new password 200 | **FAIL → F-05** |
| A1-29 | logout, then reuse token | ideally 401 | logout 200, **token still 200** | **FAIL → F-05** |
| G1-01 | registration with `role:"ADMIN"` | 400 | `400 VALIDATION_ERROR` details `role` | PASS |
| G1-02 | ordinary registration | 201 USER | `201 user.role=USER token.role=USER` | PASS |

### 3.2 Pairing & attestation (SEC-5, SEC-6, SEC-7, DEC-014/016/017)

| ID | Attack | Expected | ACTUAL | Verdict |
|---|---|---|---|---|
| B1-01 | 5 wrong codes, then the correct code (same user) | 400×5 → 410 latch | `400×5 → 410 PAIRING_EXPIRED` | PASS |
| B1-02 | a *different* user pairs the same pending code | 200 (per-user latch) | `200` | PASS |
| B1-03 | replay a paired code | 400 | `400 INVALID_PAIRING_CODE` | PASS |
| B2-01 | poll an unpaired enrollment | 404, no token | `404 NOT_FOUND tokenInBody=false` | PASS |
| B2-02 | guessed enroll secret | 404 | `404 NOT_FOUND` | PASS |
| B2-03 | random 256-bit device token → REST | 401 | `401 UNAUTHENTICATED` | PASS |
| B2-04 | random device token → cloud upgrade | close 4401 | `close code 4401` | PASS |
| B8-01 | `/agent/attest-key` | public key only | `200 alg=EdDSA hasPrivate=false` | PASS |
| B3-01 | issue attestation (owned, CONNECTED device) | EdDSA, aud, 60 s | `200 alg=EdDSA audMatch=true ttl=60` | PASS |
| B3-02 | attestation for another user's device | 404 | `404 NOT_FOUND` | PASS |
| B3-03 | attestation for a disconnected device | 409 | `409 NO_DEVICE_CONNECTED` | PASS |
| B4-01 | real handshake then `enterFocus` | authOk + control runs | `deviceIdMatch=true userIdMatch=true controlCalls=["enterFocus"] focusRejected=false` | PASS |
| B4-02 | replay captured attestation on a new socket | nonce mismatch | `UNAUTHENTICATED: The attestation does not match this challenge.` | PASS |
| B4-03 | second `auth` on an authenticated socket | rejected | `UNAUTHENTICATED: This dashboard link is already authenticated.` | PASS |
| B4-04 | forged attestation with attacker Ed25519 key | bad signature | `UNAUTHENTICATED: The attestation signature is invalid.` | PASS |
| B4-05 | `alg=none` attestation | algorithm pinned | `UNAUTHENTICATED: Only EdDSA (Ed25519) attestations are accepted.` | PASS |
| B4-06 | real attestation for device B on device A's link | aud mismatch | `UNAUTHENTICATED: The attestation is not bound to this device.` | PASS |
| B4-07 | `enterFocus` on an unattested socket | focusRejected, controller untouched | `UNAUTHENTICATED`, handler calls before/after `1/1` | PASS |
| B4-08…11 | malformed JWT shapes (2 segments, 4 KiB blob, HS256 header) | authError, agent alive | `VALIDATION_ERROR`/`UNAUTHENTICATED`, server stays up | PASS |
| B5-01 | wrong `sub` (real signature) | FORBIDDEN SUBJECT_MISMATCH | `{"ok":false,"code":"FORBIDDEN","reason":"SUBJECT_MISMATCH",…}` | PASS |
| B5-02 | expired | EXPIRED | `reason":"EXPIRED"` | PASS |
| B5-03 | TTL 600 s | TTL_TOO_LONG | `reason":"TTL_TOO_LONG"` | PASS |
| B5-04 | future `nbf` | NOT_YET_VALID | `reason":"NOT_YET_VALID"` | PASS |
| B5-05 | HS256-signed attestation | UNSUPPORTED_ALGORITHM | `reason":"UNSUPPORTED_ALGORITHM"` | PASS |
| B5-06 | positive control | ok:true | `{"ok":true,…}` | PASS |
| B6-01 | capture every agent→dashboard frame across unpaired→paired | no code/token/enroll secret | `frames=hello,hello,challenge codeOnWire=false sixDigitRun=(none) tokenOnWire=false enrollOnWire=false` | PASS |
| B7-01 | device token after unpair | REST 401 + WS 4401 | `delete 200, rest 401 UNAUTHENTICATED, ws 4401` | PASS |
| G1-05 | enroll poll after consumption with a wrong secret | 404 (no oracle) | good poll 200, then **410 PAIRING_EXPIRED** | **FAIL → F-04** |

### 3.3 Local channel (NFR-010, §4.2, DEC-003)

| ID | Attack | Expected | ACTUAL | Verdict |
|---|---|---|---|---|
| C1-01 | `Origin: https://evil.example` | refused | `Unexpected server response: 403` | PASS |
| C1-02 | no `Origin` header at all | refused | `HTTP/1.1 403 Forbidden` | PASS |
| C1-03 | DNS rebinding (`Host: evil.example`, allowed Origin) | refused | `HTTP/1.1 403 Forbidden` | PASS |
| C1-04 | no `focus.v1` subprotocol | refused | `HTTP/1.1 400 Bad Request` | PASS |
| C1-05 | path `/evil` | refused | `HTTP/1.1 404 Not Found` | PASS |
| C1-06 | control: loopback Host + allowed Origin + `focus.v1` | 101 | `HTTP/1.1 101 Switching Protocols` | PASS |
| C2-01 | 17 KiB frame (cap 16 KiB) | closed | `close 1009` | PASS |
| C2-02 | binary frame | authError + close | `close 1008`, `Binary frames are not allowed` | PASS |
| C2-03 | 40 messages in one burst | close 1008, ≤20 served | `close 1008, replies=20` | PASS |
| C2-04 | unauth `getState` then `listApps` | state allowed, control refused | `types=hello,challenge,state,focusRejected`, code `UNAUTHENTICATED`, close 1008 | PASS |
| C2-05 | dashboard sends `hello` (wrong direction) | rejected | `close 1008, VALIDATION_ERROR "Unsupported message"` | PASS |
| C2-06 | 4th concurrent connection | refused | `Unexpected server response: 503` | PASS |
| C2-07 | `enterFocus` with invalid schema | rejected before handler | `close 1008, VALIDATION_ERROR` | PASS |

### 3.4 Input & injection (SEC-9, NFR-002, XSS)

| ID | Attack | Expected | ACTUAL | Verdict |
|---|---|---|---|---|
| D1-01 | `email: {"$ne": null}` login | 400, path `email.$ne` | `400 VALIDATION_ERROR details=[{"path":"email.$ne"}]` | PASS |
| D1-02 | `?search[$ne]=x` | 400, no injection | `400 VALIDATION_ERROR details=[{"path":"search[$ne]"}]` | PASS |
| D1-03 | `?status[$gt]=A` | 400 | `400 VALIDATION_ERROR` | PASS |
| D1-04 | `__proto__` in register JSON | 400 | `400 VALIDATION_ERROR` | PASS |
| D1-05 | `constructor.prototype` in PATCH | 400 | `400 VALIDATION_ERROR` | PASS |
| D1-06 | `Object.prototype` after attempts | clean | `({}).role=undefined / isAdmin=undefined` | PASS |
| D1-07…09 | `search=.*`, `search=(` on devices/sessions/admin | literal match, never 500 | `200 total=0`; `200` ×3 | PASS |
| D1-10 | 150 KiB body | 400 | `400 VALIDATION_ERROR` | PASS |
| D1-11 | malformed JSON | 400 | `400 VALIDATION_ERROR` | PASS |
| D1-18 + P1-01…04 | malformed ObjectIds in path params (6 routes) | 404 each, never 500 | devices delete/attest, sessions patch and **allowlist preset apply** → 500; notifications + admin presets → 404 | **FAIL → F-01** |
| D1-19 | XSS payload stored in user/schedule/preset names | stored verbatim, JSON response | `user 200, schedule 201, preset 201, contentType=application/json` | PASS |
| X1-01…04 | render those names in real Chromium | inert text, no execution | `dialogs=[]`, `fired=false img=0` on dashboard/schedules/allowlist/settings, `eventHandlerAttributes:0` | PASS |
| D3-01 / DEPTH | 4 000–20 000-deep JSON (unauthenticated) | 400 | **500 INTERNAL** from 4 000 deep; API survives | **FAIL → F-02** |
| F2-04 | 500 response body | generic envelope, no stack | `{"code":"INTERNAL","message":"An unexpected error occurred."}` | PASS |

### 3.5 Access control / IDOR (FR-001, NFR-003, FR-019)

| ID | Attack | Expected | ACTUAL | Verdict |
|---|---|---|---|---|
| D2-01 | attest another user's device | 404 | `404 NOT_FOUND` | PASS |
| D2-02 | unpair another user's device | 404 | `404 NOT_FOUND` | PASS |
| D2-03 | finalise another user's session | 404 | `404 NOT_FOUND` | PASS |
| D2-04 | create a session on another user's device | 404 | `404 NOT_FOUND` | PASS |
| D2-05 | update another user's schedule | 404 | `404 NOT_FOUND` | PASS |
| D2-06 | mark another user's notification read | 404 | `404 NOT_FOUND` | PASS |
| D2-07 | list own notifications | other user's row absent | `containsBeta=false` | PASS |
| D2-08 | device-token allow-list fetch | owner-scoped | `beta hasBetaApp=true / alpha leaksBetaApp=false` | PASS |
| D2-09 | USER → all four admin endpoints | 403 | `403 ×4` | PASS |
| D2-10 | admin user list | no `passwordHash` | `hashLeak=false` | PASS |
| D2-11 | admin stats leak check | aggregates only | `containsEmail=false` | PASS |
| D2-12 | self-demotion / self-deactivation | 409, account intact | `409, 409, admin still 200` | PASS |
| D2-13 | PATCH with empty body | 400 | `400 VALIDATION_ERROR` | PASS |
| E1-01 | `PUT /allowlist` with `protectedApps: []` | PROTECTED_ENTRY | `400 PROTECTED_ENTRY` | PASS |
| E1-02 | protected app re-added under a new key via identifier | PROTECTED_ENTRY | `400 PROTECTED_ENTRY` | PASS |
| E1-03 | user app with a protected key | PROTECTED_ENTRY | `400 PROTECTED_ENTRY` | PASS |
| E1-04 | legitimate change | 200, protected unchanged, version bump | `version=2 protectedCount=36 (before 36)` | PASS |
| E1-05 | agent allow-list fetch | protected set intact | `200 protectedCount=36` | PASS |
| H1-02 | deactivated user's **device token** | 401/403 | **200** — still valid | **FAIL → F-03** |
| H1-03 | deactivated user's agent reports `session.started` | not persisted | **session persisted, ACTIVE** | **FAIL → F-03** |
| H1-04 | scheduler tick for a deactivated user | no dispatch | **`scheduleDue` received**: `{"type":"scheduleDue","durationMin":25,…}` | **FAIL → F-03** |

### 3.6 Rate limits, CORS, headers, secrets (SEC-3, SEC-4, NFR-016)

| ID | Attack | Expected | ACTUAL | Verdict |
|---|---|---|---|---|
| F1-01 | preflight from `https://evil.example` (and `Origin: null`) | no ACAO | evil `401 acao=null`, null `401 acao=null`; allowed preflight `204` with `ACAO: http://localhost:5173`, `Allow-Credentials: true`, methods/headers as configured, `Vary: Origin` | PASS |
| F1-02 | simple GET with foreign / `null` Origin | no ACAO | `evil=null null=null` | PASS |
| F1-03 | allow-listed origin | ACAO reflected | `acao=http://localhost:5173` | PASS |
| F2-01 | helmet set | CSP/nosniff/frame/HSTS/COOP/referrer/noopen | all present | PASS |
| F2-02 | framework banner | none | `x-powered-by=null` | PASS |
| F2-03 | unknown route | 404 envelope | `404 NOT_FOUND` | PASS |
| F3-01 | 31 attestations/min | 30 → 200, 31 → 429 | `tail=200,200,200,429 count200=30` | PASS |
| F3-02 | 11 pair attempts/min | 400×5, 410×5, 429 | `400,400,400,400,400,410,410,410,410,410,429` | PASS |
| F3-03 | 6 register/min (5 allowed, 1 used by fixture) | 201×4 then 429 | `201,201,201,201,429,429` | PASS |
| F3-04 | 10 bad logins then 11th, plus spoofed XFF/X-Real-IP | 429 and no bucket reset | `11th=429 RATE_LIMITED spoofed=429` | PASS |
| F3-05/06 | 429 envelope, `/health` while limited | RATE_LIMITED envelope; health 200 | `RATE_LIMITED / Too many authentication attempts…`; `200` | PASS |
| F4-01 | unknown email while limited | same 429 | `429 RATE_LIMITED` | PASS |
| S4-01 | 50 consecutive `POST /agent/enroll/poll` | a limit should exist | `uniqueStatuses=404 count429=0` | **FAIL → F-06** |
| — | repo secret scan | no secrets tracked | local gitleaks absent; grep for `BEGIN * PRIVATE KEY`, `ghp_`, `sk-`, `AKIA`, `mongodb+srv://` in tracked files → no matches; `.env` not tracked (only three `.env.example` with `CHANGE_ME_*`); CI runs checksum-pinned gitleaks (`ci.yml`), but the config allowlists **all `*.md`** → F-07 | PASS w/ note |
| — | API log hygiene | no tokens/passwords logged | `grep -cE "eyJ…|A9Attack123|Kabir@123|Admin@123" /tmp/a9-boot.log` → **0**; A7 `log-secrets.test.ts` 5 pass | PASS |

### 3.7 Privacy invariants (INV-6, INV-2, INV-3, INV-1)

| Check | Command / evidence | Result |
|---|---|---|
| No window title / URL APIs in the agent | `grep -rnE "AXTitle\|kCGWindowName\|CGWindowList\|GetWindowText\|MainWindowTitle\|_NET_WM_NAME\|WM_NAME\|desktopCapturer\|capturePage\|getURL\|tabs.query" agent/src` → no matches; the only `document.title` hits are the dashboard's own page title | PASS |
| macOS driver scope | JXA uses `NSWorkspace.runningApplications` `bundleIdentifier`+`hidden` only; default-browser lookup is `URLForApplicationToOpenURL("https://example.com/")` (a constant) | PASS |
| Linux driver scope | `parseWmctrlListing` reads **only** `id` and `pid`; the title columns “are never sliced, stored, logged or returned” (comment + code) | PASS |
| Windows driver scope | no `GetWindowText`/`MainWindowTitle` anywhere in `win32.ts` | PASS |
| No telemetry | `grep -rniE "sentry\|posthog\|mixpanel\|segment\.io\|google-analytics\|gtag\|telemetry\|amplitude\|datadog\|newrelic\|bugsnag\|logrocket"` (excluding node_modules/dist) → **no matches**; agent outbound hosts are loopback/`AGENT_API_BASE_URL` only | PASS |
| INV-2 message directions | `npx vitest run --root shared src/protocol.test.ts` → **71 tests pass** | PASS |
| INV-3 protected set | E1-01…05 | PASS |
| INV-1 API has no OS code | `grep -rn "child_process\|execFile\|spawn(" server/src client/src` → no matches | PASS |
| FakeDriver never packaged | `createFocusDriver` throws `FakeDriverNotAllowedError` when `isPackaged`; `main.ts` passes `app.isPackaged`; `selection.test.ts` (23 tests) covers all branches | PASS |
| Agent renderer hardening | `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, `webSecurity:true`, `loadFile` only, CSP `default-src 'none'; script-src 'self'; connect-src 'none'`; `hardening.test.ts` 18 pass, `ui-security.test.ts` 13 pass | PASS |

---

## 4. Findings

### F-01 — Medium — Malformed ObjectId path parameters return 500 INTERNAL

**Where:** `DELETE /api/v1/devices/:id` (`device-revocation.service.ts` → `new Types.ObjectId(id)`), `POST /api/v1/devices/:id/attest` (`device.service.getOwnedDevice` → `new Types.ObjectId(id)`), `PATCH /api/v1/sessions/:id` (`session.service.finaliseSession` → `toObjectId`), and `POST /api/v1/allowlist/preset/:id` (`allowlist.service.applyPresetToAllowlist` → `Preset.findById(id)`). `PATCH /notifications/:id/read` and `DELETE /admin/presets/:id` correctly answer 404 — so the fix pattern already exists in the codebase (`admin.service.toObjectIdOrNotFound`).

**Why it matters:** NFR-002/§8 define client-input failures as 4xx with a stable code; this returns 500 INTERNAL, writes a stack trace to the log (log-noise DoS surface), and leaks nothing but signals unhandled input. It is reachable by any authenticated USER and by no unauthenticated caller (all four routes require auth).

**Repro & evidence (run against the snapshot in §1.4):**

```bash
# TOKEN = a valid USER access token
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE  http://127.0.0.1:5399/api/v1/devices/not-an-objectid      -H "Authorization: Bearer $TOKEN"   # 500
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE  "http://127.0.0.1:5399/api/v1/devices/%7B%22%24ne%22%3Atrue%7D" -H "Authorization: Bearer $TOKEN"  # 500
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH   "http://127.0.0.1:5399/api/v1/sessions/%7B%22%24ne%22%3Atrue%7D"  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"status":"COMPLETED","endedAt":"2026-11-10T00:00:00.000Z","actualMinutes":0,"endReason":"COMPLETED"}'  # 500
curl -s -o /dev/null -w '%{http_code}\n' -X POST    http://127.0.0.1:5399/api/v1/allowlist/preset/not-an-objectid -H "Authorization: Bearer $TOKEN"  # 500
```

```
[FAIL] P1-01 | DELETE /devices/%7B%22%24ne%22%3Atrue%7D | expected: 404 NOT_FOUND, never 500 | actual: 500 INTERNAL {"success":false,"error":{"code":"INTERNAL",…}}
[FAIL] P1-02 | POST /devices/%7B%22%24ne%22%3Atrue%7D/attest | … | actual: 500 INTERNAL
[FAIL] P1-03 | PATCH /sessions/%7B%22%24ne%22%3Atrue%7D | … | actual: 500 INTERNAL
[FAIL] P1-04 | DELETE /devices/zzzzzzzzzzzzzzz | … | actual: 500 INTERNAL
[PASS] P1-05 | PATCH /notifications/%7B%22%24gt%22%3A1%7D/read | … | actual: 404 NOT_FOUND
[FAIL] D1-18 | malformed ObjectIds across six parametric routes | every one 404 NOT_FOUND, never 500 | D1-12 DELETE /devices/not-an-objectid → 500 INTERNAL | D1-13 POST …/attest → 500 INTERNAL | D1-14 PATCH /sessions/… → 500 INTERNAL | D1-15 PATCH /notifications/…/read → 404 | D1-16 DELETE /admin/presets/… → 404 | D1-17 POST /allowlist/preset/… → 500 INTERNAL
```

Server log confirms `BSONError: input must be a 24 character hex string…` at `error` level.

**Fix:** validate with `OBJECT_ID_PATTERN`/`isValidObjectId` in the service entry points (as `admin.service.toObjectIdOrNotFound` already does) → 404 `NOT_FOUND`. Four call sites: `revokeOwnedDevice`, `getOwnedDevice`, `finaliseSession`, `applyPresetToAllowlist`.

---

### F-02 — Medium — Deeply nested JSON returns 500 from the unauthenticated path

**Where:** `server/src/utils/operators.ts` `findForbiddenKeys` walks arrays/objects recursively; `sanitizeRequest` runs **before routing and before any auth** (`app.ts` order: helmet → cors → json → sanitize → routes). A ~4 000-deep JSON array (≈8 KiB) exhausts the call stack; the `RangeError` reaches the error handler and becomes 500 INTERNAL with a stack trace. The API does not crash (health stays 200), but the request is unauthenticated, needs no credentials, and can be replayed on any path (including 404 routes), producing unbounded 500s and stack-trace log lines.

**Repro & evidence:**

```bash
python3 -c 'print("["*4000 + "0" + "]"*4000, end="")' > /tmp/deep.json
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:5399/api/v1/auth/login \
  -H 'Content-Type: application/json' --data-binary @/tmp/deep.json      # 500
```

```
[PASS] DEPTH-1000  | 1000-deep JSON  | actual: 400
[FAIL] DEPTH-4000  | 4000-deep JSON  | expected: 4xx | actual: 500
[FAIL] DEPTH-8000  | 8000-deep JSON  | expected: 4xx | actual: 500
[FAIL] DEPTH-12000 | 12000-deep JSON | expected: 4xx | actual: 500
[FAIL] D3-01 | 20000-deep JSON nesting (sanitiser recursion) | expected: 400 VALIDATION_ERROR and the API survives | actual: status 500 INTERNAL, health after=200
```

Log: `{"level":50,…,"err":{"type":"RangeError","message":"Maximum call stack size exceeded","stack":"RangeError: Maximum call stack size exceeded\n at walk (/…/server/src/utils/operators.ts:32:20)…"}}`.

**Fix:** iterative walk (explicit stack) or a depth cap in `collectOperatorIssues` (e.g. `depth > 32` → 400 `VALIDATION_ERROR`). Either removes the 500 and the log amplification.

---

### F-03 — Medium — Deactivating an account does not revoke its device credentials or scheduled dispatch

**Where:** `server/src/middlewares/deviceAuth.ts` (no `isActive` re-check), `server/src/cron/scheduler.ts` (`User.find({ _id: { $in: userIds } })` selects only `timezone`, no `isActive` filter), `server/src/services/admin.service.ts` `updateAdminUser` (sets `isActive` only), `server/src/services/session.service.ts` reporting path (no active check).

**Impact:** an admin disabling an account (the documented FR-019 offboarding action) stops dashboard logins (403 `ACCOUNT_DISABLED`, verified) but leaves the paired Focus Agent fully live: its device token still authenticates (`/agent/allowlist` 200), it still writes sessions for the disabled account, and the scheduler still dispatches `scheduleDue` to it (the agent then shows its local heads-up and may start a focus session). There is **no cross-user impact** — the machine is the disabled user's own — which is why this is Medium rather than High/Critical; but “disable account” is incomplete and should not depend on the user unpairing first.

**Repro & evidence** (`/tmp/a9-deact.ts`, real cloud agent-link socket + real cron tick):

```
[PASS] H1-00 | control: user with a connected agent and a schedule due next minute | actual: 201 startTime=18:08 day=2
[PASS] H1-01 | dashboard request after deactivation | expected: 403 ACCOUNT_DISABLED | actual: 403 ACCOUNT_DISABLED
[FAIL] H1-02 | the deactivated user's device token on GET /agent/allowlist | expected: 401/403 | actual: 200
[H1] device status during wait: CONNECTED
[FAIL] H1-04 | scheduler tick after deactivation | expected: no scheduleDue | actual: scheduleDue={"v":1,"id":"e241e6e0-…","type":"scheduleDue","runId":"6af35d80…","scheduleId":"6af35d70…","durationMin":25,"allowListVersion":1}
[FAIL] H1-03 | agent session.started after deactivation | expected: rejected/not persisted | actual: session persisted=true status=ACTIVE
```

**Fix (recommended):** on `isActive:false`, call `revokeAllDevicesForUser(userId)` (already implemented, pushes `revoked` and deletes token hashes); additionally have `requireDeviceToken` join the owner and reject inactive users, and filter `isActive: true` in the scheduler's user query. A regression test should assert all three.

---

### F-04 — Low — Enrollment-poll state oracle: 410 vs 404 after consumption

**Where:** `server/src/services/pairing.service.ts` `pollEnrollment`: when the device id exists, is owner-bound and `enrollSecretHash === null`, it answers 410 `PAIRING_EXPIRED` (“This enrollment was already completed”) for **any** presented secret, while an unknown device is 404. A caller who knows a device id (only exposed to its owner and the agent) can therefore learn whether that device is paired/consumed. No token can be obtained (the correct secret is required before the hash is cleared).

**Evidence:**

```
[PASS] G1-03 | wrong secret, unpaired pending row vs unknown id | both 404
[PASS] G1-04 | wrong secret for a paired device before consumption | 404
[FAIL] G1-05 | after consumption, wrong secret | expected 404 | actual: good poll 200; later wrong-secret poll 410 PAIRING_EXPIRED
```

**Fix:** keep answering 404 for a mismatched secret even after consumption (only answer 410 when the correct secret is presented, or drop the distinction entirely).

---

### F-05 — Low — Access tokens survive password change and logout (accepted design)

`verifyAccessToken` only checks signature/expiry/iss/aud; there is no `tokenVersion`/denylist, and `POST /auth/users/me/password` / `/auth/logout` do not invalidate issued tokens. A stolen token therefore remains valid for the remainder of its 30-minute TTL, even after the user changes their password or logs out.

```
[FAIL] A1-28 | password change, then old token | before 200, change 200, old-token-after 200, old-password-login 401, new-password-login 200
[FAIL] A1-29 | logout then reuse token | logout 200, token-after-logout 200
```

This is **documented** in the contract (“logout is client-side token drop + optional token version bump”) and is bounded by the 30-minute TTL + `sessionStorage` (not `localStorage`) storage, so it is recorded as an accepted risk rather than a release blocker. If a stricter reading is wanted, a `tokenVersion` claim + bump on password change is a small change. **Owner: A5/contracts.**

---

### F-06 — Low — `POST /agent/enroll/poll` has no rate limiter

`agent.routes.ts` mounts `validate(enrollPollSchema)` on `/enroll/poll` but no limiter (SEC-4 only names auth/register/pair/attest, so this is not a requirement breach). The endpoint is unauthenticated and performs a DB lookup per call:

```
[FAIL] S4-01 | 50 consecutive /agent/enroll/poll requests | expected: 429 after a limit | actual: uniqueStatuses=404 count429=0
```

**Fix:** add a modest per-IP limiter (e.g. 60/min) for symmetry with `/agent/register`.

---

### F-07 — Low — Secret-scanning config allowlists every Markdown file

`.gitleaks.toml` allowlists `(^|/)\.md$` (as well as `CHANGE_ME_*`, the demo credentials and example JWTs). CI does run the checksum-pinned gitleaks CLI (`ci.yml`, v8.30.1), and the local grep found no committed secrets, but a real credential pasted into any `.md` would not be detected. Narrow the path allowlist to the specific docs that intentionally quote examples. **Owner: A10/A0.** (Local `gitleaks` is not installed in this sandbox, so this review used pattern greps + `git ls-files` — stated as a limitation.)

---

## 5. Verified PASS register (grouped)

* **Token verification**: 20 checks (A1-00…A1-17, G1-01/02) — alg pinning, expiry, iss/aud, DB-authoritative role, no hash leakage.
* **Authorisation matrix**: 11 checks (A1-18…A1-27, D2-09) — 401 vs 403 exactly per role/route.
* **Pairing**: 8 checks (B1-01…B1-03, B2-01…04, B8-01) + the at-rest digest check (S6-01).
* **Attestation**: 20 checks (B3-01…B5-06) plus the code-leak capture (B6-01) and revocation rotation (B7-01) — forged/replayed/expired/over-long/wrong-aud/wrong-sub/alg-none all rejected.
* **Local channel**: 13 checks (C1-01…C2-07).
* **Input handling**: 13 checks (D1-01…D1-19), 5 path-param checks (P1-01…05), 5 JSON-depth checks (D3-01 + DEPTH-*) and the 4 browser-XSS checks (X1-01…04).
* **Access control**: 18 checks (D2-01…D2-13, E1-01…E1-05); D2-09 is also counted in the authorisation matrix row above.
* **Rate limits / CORS / headers**: 15 checks (F1-01…F3-06, F4-01) + log hygiene + secret greps.
* **Facts**: S1-01 (`$2b$12`), S2-01 (HS256/1800 s), S6-01 (only hashes at rest).
* **Source/test evidence**: `shared/src/protocol.test.ts` 71 pass (INV-2); `agent/src/focus/drivers/source-guard.test.ts` 13 pass + `selection.test.ts` 23 pass + `hardening.test.ts` 18 pass + `ui-security.test.ts` 13 pass + `log-secrets.test.ts` 5 pass (INV-6, SEC-8, packaging, log hygiene).

---

## 6. Accepted risks (with citations)

| Risk | Why accepted | Reference |
|---|---|---|
| An attacker who registers many accounts can try 5 codes per account per 10-min window | Bounded by account-creation rate limits (10/15 min/IP), 10/min/user pair limit, 10-min TTL, single-use codes; 10⁶ space. Re-verified: the latch blocks the 6th attempt for the *same* user while other users' correct codes still work (B1-01/B1-02) | **DEC-017**, INTEGRATION_CONTRACTS C-14 |
| If the TLS endpoint is compromised, the agent's `codeHmac` allows offline brute force of the 10⁶ code space | Codes are short-lived and worthless after single use; the DB alone (without `PAIR_PEPPER`) cannot be brute-forced | **DEC-014** (residual risk explicitly re-verified here) |
| Pairing attempt latch + rate-limit stores are in-memory (single API instance) | Documented single-instance deployment (TECHNICAL_DESIGN §8); a restart clears the latch, but the TTL + per-IP/user limits remain the bound | **DEC-017**, `rateLimit.ts` header |
| Access tokens are stateless; password change/logout do not revoke them | 30-minute TTL (SEC-2), `sessionStorage` only, no refresh tokens; documented logout semantics | contract §3.1 #5, **F-05** |
| Device tokens live until the user unpairs (no scheduled rotation) | SEC-6 requires revocability, which exists (DELETE device → REST 401 + WS 4401, B7-01); rotation = re-pair | SEC-6, B7-01 |
| Safari cannot open `ws://127.0.0.1` from an HTTPS dashboard | Documented unsupported browser; help card shipped | **KI-004** |
| Rate limits are per IP with no `trust proxy` set | X-Forwarded-For spoofing does **not** reset the bucket (F3-04), so no bypass; W8 deployment must set `trust proxy 1` so clients are not collapsed onto one IP | `rateLimit.ts` deployment note, BL-07 |

---

## 7. NEEDS-HUMAN items

1. **Native OS window control on Windows and Linux X11** — mocked contract suites and CI cover the code, but real hide/restore cannot be proven here (no such desktops). **KI-005**, T-100/T-102.
2. **Native tray menu, first-run consent dialog, scheduled ≥10 s heads-up + notification** — native `NSMenu`/notification surfaces are not automatable; the machine-readable frames are asserted. **KI-011/KI-013**, T-101.
3. **Packaged/notarized installers with fuses flipped** — fuses and asar-integrity are configured and unit-checked (`hardening.test.ts`, `flip-fuses.mjs`), and A10 has a packaged smoke script, but this review did not launch a signed installer; verify `RunAsNode`, `EnableNodeCliInspectArguments`, `OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation` **on the built artifact** per platform.
4. **OS-level proof for INV-6** — source greps prove no title/URL APIs exist (all three drivers), but only an OS trace on a signed build can prove nothing is read out-of-band (e.g. by a native library). Recommend a manual check in the Phase-8 checklist.
5. **Electron sandbox on Windows/Linux** — `sandbox:true` and the KI-008 launch workarounds are test-only; confirm normal sandboxing on a real desktop, not just the CI/DSH harness.

---

## Appendix A — raw evidence excerpts (verbatim)

```
[PASS] A1-00 | baseline valid HS256 token | expected: 200 public user, no passwordHash | actual: 200 role=USER hashLeak=false
[PASS] A1-01 | alg=none unsigned JWT claiming ADMIN | expected: 401 UNAUTHENTICATED | actual: 401 UNAUTHENTICATED
[PASS] A1-09 | USER token with role=ADMIN claim (signed with the real secret) | expected: 403 FORBIDDEN | actual: 403 FORBIDDEN
[PASS] A1-11 | token of a deactivated user | expected: 403 ACCOUNT_DISABLED on API; login also 403 | actual: api 403 ACCOUNT_DISABLED / login 403 ACCOUNT_DISABLED
[FAIL] A1-28 | password change, then reuse the OLD access token | … | actual: before 200, change 200, old-token-after 200 (still accepted), old-password-login 401, new-password-login 200
[FAIL] A1-29 | logout then reuse the same token | … | actual: logout 200, token-after-logout 200
[PASS] B1-01 | 5 wrong pairing guesses then the correct 6-digit code | expected: 400×5 INVALID_PAIRING_CODE, then 410 PAIRING_EXPIRED | actual: 400:INVALID_PAIRING_CODE ×5 → correct-code-6th 410 PAIRING_EXPIRED
[PASS] B1-02 | different user pairs the same pending code after the first user latched | actual: 200
[PASS] B4-01 | valid attested handshake then enterFocus | actual: deviceIdMatch=true, userIdMatch=true, controlCalls=["enterFocus"], focusRejected=false
[PASS] B4-02 | captured attestation replayed on a new socket | actual: UNAUTHENTICATED: The attestation does not match this challenge.
[PASS] B4-04 | forged attestation signed with an attacker-controlled Ed25519 key | actual: UNAUTHENTICATED: The attestation signature is invalid.
[PASS] B5-01 | wrong subject (aud correct, sub = another account) | actual: {"ok":false,"code":"FORBIDDEN","reason":"SUBJECT_MISMATCH","message":"The attestation belongs to another account."}
[PASS] B6-01 | capture every agent→dashboard frame across an unpaired→paired transition | actual: pairedBefore=false frames=hello,hello,challenge codeOnWire=false sixDigitRun=(none) tokenOnWire=false enrollOnWire=false
[PASS] B7-01 | use a device token after the user unpaired the device | actual: delete 200, rest 401 UNAUTHENTICATED, ws 4401
[PASS] C1-03 | DNS rebinding: Host: evil.example with an allow-listed Origin | actual: HTTP/1.1 403 Forbidden
[PASS] C2-03 | 40 getState messages in one burst (>20/s) | actual: close 1008, replies=20
[PASS] C2-06 | a 4th concurrent dashboard connection (max 3) | actual: Unexpected server response: 503
[PASS] D1-01 | NoSQL operator injection in login body: email {$ne: null} | actual: 400 VALIDATION_ERROR details=[{"path":"email.$ne",…}]
[PASS] D1-19 | store XSS payloads in user name, schedule name and preset name | actual: user 200, schedule 201, preset 201, me returns payload=true, contentType=application/json; charset=utf-8
[PASS] X1-02 | render the stored payloads in Chromium | actual: dialogs=[]; dashboard: fired=false img=0 text=true | schedules: fired=false img=0 text=true | allowlist: fired=false img=0 text=true | settings: fired=false img=0 text=true
[PASS] D2-08 | device-token allow-list fetch is owner-scoped | actual: beta hasBetaApp=true / alpha leaksBetaApp=false
[PASS] D2-11 | admin stats leak check | actual: 200 containsEmail=false body={"success":true,"data":{"users":4,…
[PASS] D2-12 | admin self-demotion and self-deactivation | actual: demote 409 CONFLICT, deactivate 409 CONFLICT, admin still 200
[PASS] E1-02 | re-add a protected app under a new key via its identifier (com.google.Chrome) | actual: 400 PROTECTED_ENTRY
[PASS] F3-02 | 11 pairing attempts in one minute | actual: 400,400,400,400,400,410,410,410,410,410,429
[PASS] F3-04 | 11th login attempt, then spoofed X-Forwarded-For / X-Real-IP | actual: first10=401×10 11th=429 RATE_LIMITED spoofed=429 RATE_LIMITED
[FAIL] D1-18 | malformed ObjectIds across six parametric routes | actual: D1-12 → 500 INTERNAL | D1-13 → 500 INTERNAL | D1-14 → 500 INTERNAL | D1-15 → 404 NOT_FOUND | D1-16 → 404 NOT_FOUND | D1-17 → 500 INTERNAL
[FAIL] D3-01 | 20000-deep JSON nesting (sanitiser recursion) | actual: status 500 INTERNAL, health after=200
[FAIL] G1-05 | enroll-poll for a paired device AFTER consumption, with a wrong secret | actual: good poll 200; later wrong-secret poll 410 PAIRING_EXPIRED
[FAIL] H1-02 | the deactivated user's device token on GET /agent/allowlist | actual: 200
[FAIL] H1-03 | agent session.started after the account was deactivated | actual: session persisted=true status=ACTIVE
[FAIL] H1-04 | scheduler tick after deactivation (schedule due this minute) | actual: scheduleDue={"v":1,…,"type":"scheduleDue",…}
[PASS] S1-01 | bcrypt cost on a seeded account hash | actual: $2b$12
[PASS] S2-01 | access-token header/claims | actual: alg=HS256 ttl=1800 iss=focus-mode-api aud=focus-mode-dashboard
[PASS] S6-01 | device document fields at rest | actual: _id,ownerId,name,os,pairedAt,lastSeenAt,status,pairTokenHash,pairExpiresAt,pairAttempts,deviceTokenHash,enrollSecretHash,capabilities,agentVersion,__v
[FAIL] S4-01 | 50 consecutive /agent/enroll/poll requests | actual: uniqueStatuses=404 count429=0
```

Totals: `grep -c '^\[PASS\]'` = **132**, `grep -c '^\[FAIL\]'` = **16** (148 checks).

## Appendix B — harness manifest (all in `/tmp`, nothing added to the product tree)

| File | Purpose |
|---|---|
| `a9-boot.ts` | memory Mongo + real API + DEC-013 seed, writes `/tmp/a9-stack.json` |
| `a9-restart.sh` | fresh API instance (fresh in-memory limiter stores + DB) |
| `a9-lib.ts` | HTTP helper, real HS256 minting, DEC-014 digest, pairing/enroll helpers, PASS/FAIL recorder |
| `a9-auth.ts` | attack group 1 (30 checks) |
| `a9-pairing.ts` | attack group 2a (8 checks) |
| `a9-attest.ts` | attack group 2b — real `LinkServer` + `AttestationGate` (22 checks) |
| `a9-link.ts` | real agent LinkServer harness (fake-free: real attestation verifier) |
| `a9-local.ts` | attack group 3 (13 checks) |
| `a9-app.ts` | attack groups 4+5 + INV-3 (32 checks) |
| `a9-params.ts` | operator-in-path-param probe (5 checks) |
| `a9-http.ts` | attack group 6 (15 checks) |
| `a9-browser.ts` | stored-XSS render check in Chromium (4 checks) |
| `a9-deact.ts` | account-deactivation lifecycle probe incl. a real cron tick (5 checks) |
| `a9-facts.ts` | SEC-1/2/6 facts + enroll-poll limiter probe (4 checks) |
| `a9-depth.ts` | JSON-depth threshold probe (4 checks) |
| `a9-final.ts` | registration role injection, enrollment oracle, inline-script audit (6 checks) |
| `a9-authoritative.sh` | the clean re-run driver used for this report |

## 8. W6 re-verification on the final merged tree (2026-11-11)

> **Attribution:** this section is a **Lead (A0) spot-check on the final merged tree**, not a full
> independent re-run by A9. A9's findings were fixed by A5 in `439792b` and re-verified here through
> A5's regression tests (`server/src/test/w6-followup-hardening.test.ts`, 12 tests) plus targeted
> probes/observations on `main`. The original A9 report (§§1–7) stands as the independent attack
> log; this section records only what was re-run after the fixes.

Commits verified: `439792b` (A5 W6 follow-ups) on top of `8dceac1`/`05e6187`.

| Finding | Severity | Re-verification evidence | Verdict |
|---|---|---|---|
| **F-01** malformed ObjectId → 500 | Medium | `w6-followup-hardening.test.ts` asserts `DELETE /devices/not-an-objectid`, `POST /devices/:id/attest`, `PATCH /sessions/:id`, `POST /allowlist/preset/:id` → **404 NOT_FOUND** with the standard envelope and no stack trace (`CastError`/`BSONError` mapped centrally in `utils/mongo-errors.ts`). Test run: **22 files / 345 tests pass**. | **FIXED** |
| **F-02** deep-JSON stack overflow | Medium | `findForbiddenKeys` is now an explicit-stack iterative walk. Tests assert 4 000/12 000/20 000-deep arrays and 4 000/8 000-deep objects → **400 VALIDATION_ERROR** (never 500, no RangeError), an operator hidden at ~4 000 depth is still rejected as forbidden keys, and a legitimate 50-deep payload validates normally. | **FIXED** |
| **F-03** deactivation does not revoke/stop | Medium | Tests assert: device token on `/agent/allowlist` after `isActive:false` → **403 ACCOUNT_DISABLED**; agent-reported `session.started` for a deactivated owner is refused with **0 sessions persisted**; a due schedule of an inactive user produces **no `scheduleDue`, no `ScheduleRun`, no notification** and leaves `lastRunAt` untouched; admin deactivation calls `revokeAllDevicesForUser` (2 `revokeDevice` pushes + device rows deleted in the test). | **FIXED** |
| **F-04** enroll-poll state oracle | Low | Not changed in W6 (out of the hardening scope agreed for this wave). Behaviour remains as reported (410 vs 404 after consumption, no token leak). Tracked as KI-018. | **OPEN (accepted for W6)** |
| **F-05** tokens survive password change/logout | Low | Unchanged by design (stateless 30-min access token, `sessionStorage`). Documented accepted risk (KI-019). | **ACCEPTED RISK** |
| **F-06** no limiter on `/agent/enroll/poll` | Low | Route now sits behind `createPublicRateLimiter('agent-poll')`; the follow-up test asserts rate-limit headers on that route. | **FIXED** |
| **F-07** `.gitleaks.toml` allowlists `*.md` | Low | Not changed in W6 (config hygiene, W7/W9 candidate). Local grep + CI scan found no committed secrets. Tracked as KI-021. | **OPEN** |

**Refreshed totals for the final tree:** A9's original 148 checks → **132 PASS / 16 FAIL** at the W6
snapshot; of the failing findings, **F-01, F-02, F-03, F-06 are now FIXED and regression-tested**,
F-04/F-07 remain open Low, F-05 accepted. **No Critical/High findings were ever reported**, and the
W6 gate E2E suite (reconnect/security/viewport/insights/admin/notifications/settings/schedule/
session-reporting/focus/pairing/API/smoke) is green on the merged tree.
