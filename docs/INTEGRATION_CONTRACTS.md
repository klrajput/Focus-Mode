# INTEGRATION_CONTRACTS.md — frozen contracts for Focus Mode (contracts-v1)

> **Owner:** A2 (Software Architect) · **Task:** T-005 · **Status:** **FROZEN (contracts-v1)** — protocol `v1`; W1–W7 implemented and merged (**W5 gate:** 1128 unit tests, 27/27 E2E; **W6 gate:** security hardening, no Critical/High; **W7 gate:** **1421 unit tests — server 450** — and **50/50 E2E twice back-to-back**, coverage ≥ 80 % lines in every package). W2 decisions (DEC-013/014/015/016), W3/W4 additions C-14…C-20, W5 additions C-21…C-25 and the W6 security addition **C-26** (server-side single-use attestation nonce cache — DEC-025) are recorded below and verified against shipped code (§10). **W7 changed no wire format.** All role sign-offs ACCEPTED/SIGNED (§10).
> **Machine-readable source of truth:** `shared/src/` (zod schemas + inferred types). This document is the human-readable contract and is kept consistent with it by `/tmp/a2-contracts/check.mjs` (§11).
> **Sources:** `TECHNICAL_DESIGN.md` §4–§6, §7.2, §9–§10, §17 · `REQUIREMENTS.md` FR/NFR/SEC · `docs/DECISIONS.md` DEC-002/003/005/006/009/012/**013/014/015/016/017/019/021/022/023/024/025/026** · `docs/SECURITY_REVIEW.md` §8 (F-01…F-07) · `docs/UX_SPEC.md` §1/§6 (tokens + user-facing copy only).
> **Change process:** any change to a message, endpoint, schema, field or status code requires an ADR + this doc + `shared/` update + A2 + A8 approval + a contract test (AGENTS §5). Requests go in the table in §8 — do not edit the doc directly without that process.

---

## 0. How to consume this contract

1. Import everything from the barrel — never deep-import, never re-declare a type:

   ```ts
   import { loginSchema, registerSchema, type LoginInput } from '@focus-mode/shared';
   ```

2. `@focus-mode/shared` resolves to `shared/dist/index.js` + `.d.ts`. Run `npm run build -w @focus-mode/shared` after pulling (root `npm run build` does it first). `server/`, `agent/` and `client/` must only use the **public** exports listed in §1.7.
3. The zod schema is the validator on **both** sides (NFR-001). Every object schema is strict: unknown fields are rejected, which is also the operator-injection defence (SEC-9, NFR-013).
4. Response bodies are documented here as JSON; they are shaped by the server (T-010/T-012+). Request payloads are zod-validated against the named shared schema. (Response zod schemas are deferred to `contracts-v1.1` per DEC-015 — see clarification C-04.)
5. Terminology: **D** = dashboard (browser, React), **A** = Focus Agent (Electron, the only component touching the OS — INV-1), **API** = Express cloud server. The pairing **code** is shown only in the Focus Agent UI.

---

## 1. Global conventions

### 1.1 API base URL (DEC-013 — full base includes `/api/v1`)

| Caller | Env var | Dev value | Deployed value |
|---|---|---|---|
| Dashboard | `VITE_API_BASE_URL` | `http://localhost:5000/api/v1` | `/api/v1` (same-origin, behind the Vercel/Netlify `/api/*` rewrite) |
| Focus Agent | `AGENT_API_BASE_URL` | `http://localhost:5000/api/v1` | `https://<api-host>/api/v1` |

- The env value is the **full base URL including `/api/v1`**. Clients append only the endpoint path from §3 (`/auth/login`, `/sessions`, …) — no client/agent file may hard-code `/api/v1` anywhere else (NFR-004).
- Paths in §3 are shown **relative to that base**.
- JSON bodies only (`Content-Type: application/json`); the API rejects bodies over `100kb` (TECHNICAL_DESIGN §8).
- Every REST response uses the envelopes in §1.4 — including errors raised by middleware, rate limits and 404/500.

### 1.2 Authentication

| Access label in §3 | Meaning |
|---|---|
| `public` | no credentials |
| `auth` | `Authorization: Bearer <accessToken>` — any active user (USER or ADMIN) |
| `USER` | Bearer token whose user role is `USER` **and** the resource owner check passes (`ownerId === req.user.id`); cross-user ids answer `404 NOT_FOUND` (NFR-003) |
| `ADMIN` | Bearer token with role `ADMIN` (`403 FORBIDDEN` for USER) |
| `agent-public` | agent-facing, unauthenticated but rate-limited (`/agent/register`, `/agent/attest-key`) |
| `agent-secret` | `deviceId + enrollSecret` in the body (`/agent/enroll/poll`) |
| `agent-device` | `Authorization: Bearer <deviceToken>` — the device token, never a user JWT |
| `device-token (WS)` | `/agent-link` upgrade carries `Authorization: Bearer <deviceToken>` |

- Access token: JWT HS256, `JWT_EXPIRES_IN=30m` (SEC-2), held in memory + `sessionStorage` re-hydration by the dashboard.
- Passwords: `bcryptjs` cost ≥ 12 (SEC-1). Pairing codes/tokens: HMAC/hash only in DB (SEC-5/6).
- `ACCOUNT_DISABLED` → `403` on login/refresh; `429 RATE_LIMITED` when a limiter trips (§1.9).

### 1.3 Identifiers, timestamps, numbers

| Kind | Wire format | Shared schema |
|---|---|---|
| MongoDB ids (`userId`, `deviceId`, `sessionId`, `scheduleId`, `presetId`, `notificationId`, `runId`, `agentLinkId`) | 24-char hex ObjectId | `objectIdSchema` |
| `clientSessionId` (REC-006 idempotency key, and the local-channel `sessionId`) | UUID v4 string | `uuidSchema` |
| Timestamps (`startedAt`, `endedAt`, `acceptedAt`, `at`, `endsAt`, `startsAt`, `lastSeenAt`, …) | ISO-8601 **UTC with `Z`**, e.g. `2026-11-10T10:00:00.000Z` | `isoDateTimeSchema` |
| `durationMin` / `plannedMinutes` | integer 1–480 | `durationMinSchema` |
| `actualMinutes` | number 0–1440 (server rounds to 0.1) | `actualMinutesSchema` |
| `timezone` | valid IANA name (`Asia/Kolkata`), validated with `Intl` | `timezoneSchema` |
| Pairing code | **6-digit string** (`"000123"` — string so leading zeros survive) | `pairingCodeSchema` |
| Device OS | `macOS` \| `windows` \| `linux` (exact DB spelling) | `osSchema` |
| Session status | `ACTIVE` \| `COMPLETED` \| `CANCELLED` (PATCH accepts only the two terminal values) | `sessionStatusSchema` / `terminalSessionStatusSchema` |
| Session source | `MANUAL` \| `SCHEDULE` | `focusSourceSchema` |
| End reason | `COMPLETED` \| `USER` \| `AGENT` \| `SLEEP` \| `CRASH_RECOVERY` \| `UNPAIRED` \| `QUIT` | `endReasonSchema` |
| Device presence | `CONNECTED` \| `DISCONNECTED` \| `FOCUSING` (DB), plus dashboard-only `DISCONNECTED` badge | `deviceStatusSchema` |
| Role | `USER` \| `ADMIN` | `roleSchema` |

### 1.4 Success / error envelopes (NFR-002)

```json
{
  "success": true,
  "data": { "id": "507f1f77bcf86cd799439011" },
  "message": "Optional human-readable note"
}
```

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "path": "password", "message": "Password must be at least 8 characters" }
    ]
  }
}
```

- Success is always `200` (or `201` for creation) with `{success:true,data,…}`; there is **no 204** — deletes return `200` with `{success:true,data:{id}}`.
- Error `details` is an array of `{path,message}` (`ValidationIssue` in `shared/src/types.ts`); other failures may omit `details`.
- No stack traces ever reach the client (NFR-002); the server logs the full error.
- Typed helpers: `ApiResponse<T>`, `ApiSuccess<T>`, `ApiErrorBody`, `Paginated<T>` in `shared/src/types.ts`.

### 1.5 HTTP status table (mirrors `ERROR_HTTP_STATUS`)

| Status | Error codes | When |
|---|---|---|
| `200 OK` | — | successful read / update / delete |
| `201 Created` | — | successful create (`/auth/register`, `/sessions`, `/schedules`, presets, agent links, `/agent/register`) |
| `400 Bad Request` | `VALIDATION_ERROR`, `INVALID_PAIRING_CODE`, `PROTECTED_ENTRY` | zod failure, malformed pairing code, allow-list tries to alter protected entries |
| `401 Unauthorized` | `UNAUTHENTICATED` | missing/invalid Bearer token, wrong current password, rejected attestation, device token invalid |
| `403 Forbidden` | `FORBIDDEN`, `ACCOUNT_DISABLED` | wrong role, foreign Origin at WS upgrade, deactivated account |
| `404 Not Found` | `NOT_FOUND` | unknown id **or** a resource owned by another user (never reveal existence) |
| `409 Conflict` | `CONFLICT`, `ALREADY_FOCUSING`, `NO_DEVICE_CONNECTED` | duplicate email, second ACTIVE session per device, no connected device to focus, duplicate `clientSessionId` with different body, **replayed attestation nonce inside its 60 s TTL (C-26)** |
| `410 Gone` | `PAIRING_EXPIRED` | the pairing code existed and is permanently invalid (TTL/attempts/consumed) |
| `429 Too Many Requests` | `RATE_LIMITED` | auth 10/15 min/IP, pair 10/min/user, agent register 5/min/IP (§1.9) |
| `500 Internal Server Error` | `INTERNAL` | unexpected failure; generic message only |

Codes and their statuses are frozen in `shared/src/errors.ts` (13 codes, REQUIREMENTS §8). Per-code mapping (`ERROR_HTTP_STATUS`):

`VALIDATION_ERROR=400`, `UNAUTHENTICATED=401`, `FORBIDDEN=403`, `NOT_FOUND=404`, `CONFLICT=409`, `RATE_LIMITED=429`, `INVALID_PAIRING_CODE=400`, `PAIRING_EXPIRED=410`, `PROTECTED_ENTRY=400`, `ALREADY_FOCUSING=409`, `NO_DEVICE_CONNECTED=409`, `ACCOUNT_DISABLED=403`, `INTERNAL=500`.

### 1.6 List convention (NFR-009)

Every list endpoint returns the standard paginated shape and accepts the standard query parameters:

```json
{
  "success": true,
  "data": {
    "items": [],
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

- Query: `page` (integer ≥ 1, default `1`), `limit` (integer 1–100, default `20`), `sort` (per-resource whitelist, default below), `search` (optional, 1–100 chars, `$`/`.` operators stripped).
- `sort` accepts a field name or the same name prefixed with `-` for descending. Whitelists live in shared: `sessionsSortSchema` (`startedAt`, `endedAt`, `plannedMinutes`, `actualMinutes`), `devicesSortSchema` (`name`, `lastSeenAt`, `createdAt`), `adminUsersSortSchema` (`name`, `email`, `createdAt`, `lastLoginAt`). Lists without a shared sort schema accept `page`/`limit` only and use a fixed per-resource order (all verified against shipped code, C-18/C-25): `GET /schedules` → **`startTime asc, _id asc`** (C-18); `GET /notifications` → **`createdAt desc, _id desc`**; `GET /presets` and `GET /admin/presets` → **`createdAt desc, _id desc`**; `GET /agent-links` (public) → **`os asc, arch asc, _id asc`**; `GET /admin/agent-links` → **`publishedAt desc, _id desc`**. Admin user lists keep the frozen `sort` whitelist (`adminUsersSortSchema`) and additionally accept the C-25 filters.
- Errors: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`.

### 1.7 Shared module surface (what each package may import)

| Module | Exports used by | Contents |
|---|---|---|
| `shared/src/protocol.ts` | client, agent, server (`realtime`), tests | 16 local messages, 6 cloud messages, envelope, unions, type guards, direction tables, `PROTOCOL_VERSION = 1`, `UNAUTHENTICATED_INBOUND_TYPES` |
| `shared/src/errors.ts` | client, server, agent | `ERROR_CODES` (13), `errorCodeSchema`, `ERROR_HTTP_STATUS`, `httpStatusForErrorCode`, `isErrorCode` |
| `shared/src/protected.ts` | server, agent, client (read-only display) | `PROTECTED_BY_OS`, `ALL_PROTECTED_KEYS`, `isProtectedEntry`, `isProtectedKey`, `assertNoProtectedRemoval`, `ProtectedEntryError`, `FOCUS_AGENT_APP_KEY` |
| `shared/src/schemas/` | client, server | request body/query schemas (§3.2) + `appEntrySchema` |
| `shared/src/types.ts` | client, server | `ApiResponse<T>`, `ApiSuccess<T>`, `ApiErrorBody`, `Paginated<T>`, `ValidationIssue`, `AgentConnectionStatus` |

### 1.8 Seed identities (DEC-013 — exam requirement)

| Account | Password | Role | Env vars (server) |
|---|---|---|---|
| `admin@demo.com` | `Admin@123` | `ADMIN` | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` |
| `kabir@demo.com` | `Kabir@123` | `USER` (persona Kabir) | `SEED_USER_EMAIL`, `SEED_USER_PASSWORD` |

`POST /auth/register` always creates role `USER`; there is no role field in the request (strict schema rejects one). Seed script is idempotent (T-013); README and `server/.env.example` must state the same values.

### 1.9 Rate limits (SEC-4)

| Route | Limit |
|---|---|
| `/auth/login`, `/auth/register` | 10 requests / 15 min / IP |
| `/devices/pair` | 10 requests / min / user, **and** ≤ 5 attempts per code (6th invalidates the code → `410 PAIRING_EXPIRED`) |
| `/agent/register` | 5 requests / min / IP |
| `/devices/:id/attest` | 30 requests / min / user |

Exceeding a limit → `429 RATE_LIMITED` (no user enumeration in the message).

### 1.10 Local-channel prerequisites (browser reality, TECHNICAL_DESIGN §9)

- Dashboard supported in **Chrome, Edge, Firefox** (Safari cannot open `ws://127.0.0.1` from an HTTPS page → unsupported; works only when the dashboard itself is served from `http://localhost` in dev).
- Chrome/Firefox may show a Local Network Access prompt; the dashboard shows a pre-prompt explainer and a help card on denial (UX_SPEC), connection code must fail soft.
- The dashboard scans ports `4545`–`4549` (`VITE_AGENT_PORT`, `VITE_AGENT_PORT_RANGE`).

### 1.11 DEC-013 conventions (frozen before W1 — apply to every package)

These three conventions are part of the contract, not local preferences:

| Convention | Rule | Where implemented |
|---|---|---|
| API base URL is the **FULL** base including `/api/v1` | `VITE_API_BASE_URL` (dashboard) and `AGENT_API_BASE_URL` (Focus Agent) already contain the prefix: dev `http://localhost:5000/api/v1`, deployed dashboard `/api/v1` (relative, same-origin `/api/*` rewrite), deployed agent `https://<api-host>/api/v1`. Callers append only endpoint paths (§3); no other file hard-codes `/api/v1` (NFR-004). | §1.1; `client/src/api/http.ts`, `agent/src/config/env.ts` |
| Attestation = **EdDSA (Ed25519)** | Local control is unlocked by an attestation JWT with **60 s TTL**, bound to `nonce` + `aud = deviceId` + `sub = userId` (paired owner); keys are single-line PEM env values (`ATTEST_PRIVATE_KEY`, `ATTEST_PUBLIC_KEY`). Implemented with `node:crypto` (RFC 8037, DEC-016; `jsonwebtoken` only handles HS256 user access tokens). RS256 only via an amendment ADR (DEC-013). | §4.4; `POST /devices/:id/attest`, `GET /agent/attest-key` |
| Seed identities (exam requirement) | `admin@demo.com / Admin@123` (ADMIN) and `kabir@demo.com / Kabir@123` (USER, persona Kabir); `POST /auth/register` always creates USER. | §1.8; `server/src/seed`, `SEED_*` env |

---

## 2. Pairing protocol (TECHNICAL_DESIGN §5.1, REC-002) — numbered sequence

The PDF's `/devices/pair` cannot verify a code the cloud never saw. **REC-002** splits the flow into agent pre-registration + dashboard pair + agent poll. The code is shown **only in the Focus Agent UI**; it is typed by the user into the dashboard form and posted to the **cloud API** — it is never sent over the local `ws://127.0.0.1` channel (DEC-003, enforced by `shared/src/protocol.test.ts`).

1. **Agent generates a 6-digit code and pre-registers its domain-separated digest (DEC-014; no account needed yet).**

   ```json
   {
     "codeHmac": "d0aaea363fec7948aa4d651524195a40a8b4d5c1e2d8d4eaa846d76a904dc2d5",
     "os": "macOS",
     "name": "Kabir-MacBook",
     "agentVersion": "1.4.0"
   }
   ```

   `POST {base}/agent/register` → `201`:

   ```json
   {
     "success": true,
     "data": {
       "deviceId": "507f1f77bcf86cd799439011",
       "enrollSecret": "q8Zt3n0rG6mJ2xV5cB1kL9pA4sD7fH0w"
     }
   }
   ```

   Agent computation (DEC-014): `codeHmac = SHA-256("focus-mode-pair-v1|" + code)` as **64-char lowercase hex** — domain-separated so the same 6 digits always map to the same digest while the plaintext code never leaves the Focus Agent UI. Server stores `pairTokenHash = HMAC-SHA256(PAIR_PEPPER, codeHmac)` (never the plaintext, never the bare digest), `pairExpiresAt = now + 10 min`, `pairAttempts = 0`, `enrollSecretHash`, `ownerId = null`. `409 CONFLICT` if the digest collides → agent generates a new code. Request schema: `deviceRegisterSchema`.
   > Resolved: this was clarification **C-01**; the two-stage derivation is frozen by **DEC-014** (§12 C-01).

2. **Agent UI shows the 6-digit code** (and nothing else leaves the machine). The code is a string (`"000123"`), TTL ≤ 10 min, ≤ 5 attempts, never logged.

3. **User types the code in `/devices` → dashboard pairs over HTTPS REST (auth `USER`).**

   ```json
   { "code": "483920", "name": "Kabir-MacBook" }
   ```

   `POST {base}/devices/pair` → `200`:

   ```json
   {
     "success": true,
     "data": {
       "device": {
         "id": "507f1f77bcf86cd799439011",
         "name": "Kabir-MacBook",
         "os": "macOS",
         "status": "DISCONNECTED",
         "agentVersion": "1.4.0",
         "pairedAt": "2026-11-10T10:00:00.000Z",
         "lastSeenAt": null
       }
     }
   }
   ```

   Server recomputes the same chain from the user-typed code — `codeHmac = SHA-256("focus-mode-pair-v1|" + code)` then `HMAC-SHA256(PAIR_PEPPER, codeHmac)` — and finds the unique pending device whose `pairTokenHash` matches (DEC-014). It enforces TTL ≤ 10 min and ≤ 5 failed guesses (the 6th attempt latches pairing for the rest of the TTL window → `410 PAIRING_EXPIRED`; implementation note: the T-040 latch is per authenticated user, see §12 C-14), then sets `ownerId`, clears `pairTokenHash` (single use), mints the 256-bit device token (stores only its hash), and records `pairedAt`. Errors: `400 VALIDATION_ERROR`, `400 INVALID_PAIRING_CODE`, `410 PAIRING_EXPIRED`, `429 RATE_LIMITED`. Request schema: `devicePairSchema`. **The device token is not returned to the browser.**

4. **Dashboard nudges the local agent** — a `paired` local message with `{}` only (a hostile page forging it can at worst make the agent poll harmlessly).

5. **Agent polls and receives the device token exactly once.**
   `POST {base}/agent/enroll/poll` body `{ "deviceId": "507f1f77bcf86cd799439011", "enrollSecret": "q8Zt3n0rG6mJ2xV5cB1kL9pA4sD7fH0w" }` → `200`:

   ```json
   {
     "success": true,
     "data": {
       "deviceToken": "f3b2…256-bit-hex…",
       "userId": "507f1f77bcf86cd799439012",
       "allowListVersion": 1
     }
   }
   ```

   `POST {base}/agent/enroll/poll` status semantics (C-12, documenting the merged T-040 implementation): while the device is registered but not yet owned/paired (`ownerId` is `null`) the endpoint returns `404 NOT_FOUND`; a wrong/unknown `enrollSecret` also returns `404 NOT_FOUND` (indistinguishable, so the endpoint cannot enumerate pending devices). Once the user has paired and the secret matches, `200` returns the token. After the token has been minted (enrollment consumed) further polls return `410 PAIRING_EXPIRED`. The Focus Agent treats `404`, `202`, `204` and `200`-without-token as *pending* and retries with backoff until the 10-minute code TTL; it treats `400/401/403/409/410` as terminal (stop and show the re-pair/refresh path). The agent stores the token with Electron `safeStorage`, moves `IDLE → PAIRED`, and opens the outbound cloud WS (§5). The token is issued **exactly once**. `agent-secret` access; rate-limited.

Security notes: code HMAC + pepper stored server-side (SEC-5); device token 256-bit random, hash-only in DB, revocable via `DELETE /devices/:id` (SEC-6); pairing code never crosses the local channel and never appears in logs (NFR-016). Two-stage digest rationale and residual risk: DEC-014 + `docs/SECURITY_REVIEW.md`.

---

## 3. REST endpoint contract (base `/api/v1`)

### 3.1 Endpoint table

Path is relative to the full API base (§1.1). `Request schema` is the shared zod schema name from `shared/src/schemas/` — use it verbatim in the server `validate()` middleware and the client form resolver. “Success data” is the `data` value inside the success envelope. Every path below is appended to the **full** API base (`VITE_API_BASE_URL` / `AGENT_API_BASE_URL`, including `/api/v1` — DEC-013, §1.11); attestation tokens are EdDSA with a 60 s TTL (§4.4, DEC-013/DEC-016).

| # | Method | Path | Access | Request schema | Success data (status) | Errors |
|---|---|---|---|---|---|---|
| 1 | GET | `/health` | `public` | — | `{"status":"ok","db":"ok","uptimeSec":42}` (200) — served both at the API base and at the process root (hosting alias); readiness variant is #46 (C-25) | — |
| 2 | POST | `/auth/register` | `public` | `registerSchema` | auth result (201) | `VALIDATION_ERROR`, `CONFLICT`, `RATE_LIMITED` |
| 3 | POST | `/auth/login` | `public` | `loginSchema` | auth result (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `ACCOUNT_DISABLED`, `RATE_LIMITED` |
| 4 | POST | `/auth/logout` | `auth` | — | `{"loggedOut":true}` (200) | `UNAUTHENTICATED` |
| 5 | GET | `/auth/me` | `auth` | — | public user (200) | `UNAUTHENTICATED` |
| 6 | PATCH | `/users/me` | `auth` | `profilePatchSchema` | public user (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 7 | POST | `/users/me/password` | `auth` | `changePasswordSchema` | `{"changed":true}` (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `RATE_LIMITED` |
| 8 | POST | `/devices/pair` | `USER` | `devicePairSchema` | `{"device": device}` (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `INVALID_PAIRING_CODE`, `PAIRING_EXPIRED`, `CONFLICT`, `RATE_LIMITED` |
| 9 | GET | `/devices` | `USER` | `deviceListQuerySchema` | paginated devices (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 10 | DELETE | `/devices/:id` | `USER` | — | `{"id":"<id>","revoked":true}` (200) | `UNAUTHENTICATED`, `NOT_FOUND` |
| 11 | POST | `/devices/:id/attest` | `USER` | `attestRequestSchema` | `{"attestation":"<jwt>","expiresAt":"<iso>","algorithm":"EdDSA"}` (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND`, `NO_DEVICE_CONNECTED`, `CONFLICT` (replayed `(userId, deviceId, nonce)` inside the 60 s TTL — C-26), `RATE_LIMITED` |
| 12 | POST | `/sessions` | `USER` | `sessionCreateSchema` | session (**201** first create; **200** on an identical `clientSessionId` replay — C-18/REC-006) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND`, `ALREADY_FOCUSING` |
| 13 | PATCH | `/sessions/:id` | `USER` | `sessionPatchSchema` | session (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND`, `CONFLICT` |
| 14 | GET | `/sessions` | `USER` | `sessionListQuerySchema` | paginated sessions (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 15 | GET | `/allowlist` | `USER` | — | allow-list (200) | `UNAUTHENTICATED` |
| 16 | PUT | `/allowlist` | `USER` | `allowlistPutSchema` | allow-list (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `PROTECTED_ENTRY` |
| 17 | GET | `/schedules` | `USER` | — (page/limit) | paginated schedules (200; `startTime asc, _id asc` — C-18) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 18 | POST | `/schedules` | `USER` | `scheduleCreateSchema` | schedule (201) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 19 | PATCH | `/schedules/:id` | `USER` | `scheduleUpdateSchema` | schedule (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND` |
| 20 | DELETE | `/schedules/:id` | `USER` | — | `{"id":"<id>"}` (200) | `UNAUTHENTICATED`, `NOT_FOUND` |
| 21 | GET | `/insights` | `USER` | `insightsQuerySchema` | insights (200; optional `weekly` for `30d`/`90d` — C-24) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 22 | GET | `/notifications` | `USER` | — (page/limit) | paginated notifications **+ `unreadCount`** (200; newest first — C-22) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 23 | PATCH | `/notifications/:id/read` | `USER` | — | notification (200) | `UNAUTHENTICATED`, `NOT_FOUND` |
| 24 | GET | `/presets` | `USER` | — (page/limit) | paginated presets (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 25 | GET | `/agent-links` | `public` | — (page/limit) | paginated agent links (200) | `VALIDATION_ERROR` |
| 26 | GET | `/admin/users` | `ADMIN` | `adminUserListQuerySchema` (+ additive `role?` / `isActive?` filters — C-25) | paginated public users (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN` |
| 27 | PATCH | `/admin/users/:id` | `ADMIN` | `adminUserPatchSchema` | public user (200) — self-deactivation/self-demotion → `409 CONFLICT` (C-25) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` |
| 28 | GET | `/admin/presets` | `ADMIN` | — (page/limit) | paginated presets (200) | `UNAUTHENTICATED`, `FORBIDDEN` |
| 29 | POST | `/admin/presets` | `ADMIN` | `presetCreateSchema` | preset (201) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `CONFLICT` |
| 30 | PATCH | `/admin/presets/:id` | `ADMIN` | `presetUpdateSchema` | preset (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` |
| 31 | DELETE | `/admin/presets/:id` | `ADMIN` | — | `{"id":"<id>"}` (200) | `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` |
| 32 | GET | `/admin/agent-links` | `ADMIN` | — (page/limit) | paginated agent links (200) | `UNAUTHENTICATED`, `FORBIDDEN` |
| 33 | POST | `/admin/agent-links` | `ADMIN` | `agentLinkCreateSchema` | agent link (201) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN` |
| 34 | PATCH | `/admin/agent-links/:id` | `ADMIN` | `agentLinkUpdateSchema` | agent link (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` |
| 35 | DELETE | `/admin/agent-links/:id` | `ADMIN` | — | `{"id":"<id>"}` (200) | `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` |
| 36 | GET | `/admin/stats` | `ADMIN` | — | aggregate stats — 7 canonical keys + 4 additive aliases (200; C-25) | `UNAUTHENTICATED`, `FORBIDDEN` |
| 37 | POST | `/agent/register` | `agent-public` | `deviceRegisterSchema` | `{"deviceId":"<id>","enrollSecret":"<secret>"}` (201) | `VALIDATION_ERROR`, `CONFLICT`, `RATE_LIMITED` |
| 38 | POST | `/agent/enroll/poll` | `agent-secret` | `enrollPollSchema` | `{"deviceToken":"<token>","userId":"<id>","allowListVersion":1}` (200; `404` while pending/unpaired or bad secret, `410` once consumed) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND`, `PAIRING_EXPIRED` |
| 39 | GET | `/agent/allowlist` | `agent-device` | — | `{"protectedApps": appEntry[], "userApps": appEntry[], "version": integer}` (200) — device-token auth, used for scheduled starts (C-20) | `UNAUTHENTICATED`, `NOT_FOUND` |
| 40 | GET | `/agent/attest-key` | `agent-public` | — | `{"publicKey":"<pem>","algorithm":"EdDSA"}` (200) | — |
| 41 | WS | `/agent-link` | `device-token (WS)` | — | cloud messages, §5 | close `4401` on bad token |
| 42 | GET | `/sessions/active` | `USER` | — | `{"session": session\|null}` (200) — current ACTIVE session for dashboard refresh/link reconnect (C-15) | `UNAUTHENTICATED` |
| 43 | POST | `/allowlist/preset/:id` | `USER` | — (`?mode=merge\|replace`, default `merge`; server-validated query) | allow-list (200) — preset applied to `userApps`, protected apps filtered, `protectedApps` untouched (C-16) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND` |
| 44 | GET | `/users/me` | `auth` | — | public user (200) — same shape as `/auth/me`, fresh from the `requireAuth` DB load (C-21) | `UNAUTHENTICATED` |
| 45 | POST | `/devices/unpair-all` | `USER` | — | `{"unpaired": number}` (200) — pushes `revoked` to every connected agent, then deletes all caller device rows; `0` when none (C-23) | `UNAUTHENTICATED` |
| 46 | GET | `/health/db` | `public` | — | `{"status":"ok","db":"ok"}` (200) or `503` `{"code":"INTERNAL"}` while mongoose is not connected — readiness probe (C-25) | `INTERNAL` (503) |

ADMIN aggregate rule [PDF §6]: `/admin/stats` returns only counts/minutes — never per-user session detail.

**Attestation replay (C-26, DEC-025).** `POST /devices/:id/attest` also answers **`409 CONFLICT`** when the `(userId, deviceId, nonce)` tuple was already used inside the 60 s attestation TTL: the **first** use signs and returns 200, a replay returns no attestation at all. The cache is **server-side, process-local and bounded** (5 000 live keys, oldest quarter evicted under a flood), so it is defence-in-depth behind the agent's own single-use `challenge` (§4.4): the agent still enforces nonce single-use + 60 s TTL and answers a replayed nonce with `authError{code:'UNAUTHENTICATED'}` (C-13). After the 30/min/user limiter (§1.9) and the `400 VALIDATION_ERROR` schema check, the controller's order is `404 NOT_FOUND` (unknown/foreign device) → `409 NO_DEVICE_CONNECTED` → `409 CONFLICT` (replay) → `200`. No request/response schema change — `attestRequestSchema` is unchanged.

Rows **#42–#43** are the W3 additions accepted in **DEC-019** (C-15/C-16); **#44–#46** are the W5 additions/probe variants (C-21/C-23/C-25). The original 41-operation frozen set from TECHNICAL_DESIGN §5.2 is otherwise unchanged (C-17/C-18 clarify existing rows #12/#14/#17). Shipped-code review found **no invented operations** — 46/46 rows match implemented routes.

### 3.2 Request schemas (single source of truth)

| Schema | Used by | Notes |
|---|---|---|
| `registerSchema` | #2 | `{name, email, password}`; email trimmed/lower-cased; password 8–72, letter+digit |
| `loginSchema` | #3 | `{email, password}`; no composition rules (legacy password → 401, not 400) |
| `profilePatchSchema` | #6 | any non-empty subset of `{name?, timezone?, defaultDurationMin?}` |
| `changePasswordSchema` | #7 | `{currentPassword, newPassword}`; new ≠ current |
| `devicePairSchema` | #8 | `{code, name?}` |
| `deviceListQuerySchema` | #9 | `page`, `limit`, `sort`, `search` |
| `attestRequestSchema` | #11 | `{nonce}` (16–128 URL-safe chars, from the agent `challenge`) |
| `sessionCreateSchema` | #12 | `{deviceId, durationMin, startedAt, clientSessionId, source?}` (`source` defaults `MANUAL`) |
| `sessionPatchSchema` | #13 | `{status, endedAt, actualMinutes, endReason}` — all four required, idempotent |
| `sessionListQuerySchema` | #14 | `page`, `limit`, `sort`, `search`, `from`, `to`, `status`, `source`; `from ≤ to`. Filters are **exactly** these — **no `deviceId` filter** (C-17); clients must not send it. |
| `allowlistPutSchema` | #16 | `{userApps: appEntry[] (≤50, unique keys), protectedApps?: appEntry[]}` |
| `scheduleCreateSchema` | #18 | `{name, days, startTime, durationMin, enabled?=true}` |
| `scheduleUpdateSchema` | #19 | any non-empty subset of the create fields |
| `insightsQuerySchema` | #21 | `{range: "7d"\|"30d"\|"90d" (default 7d), timezone?}` |
| `adminUserListQuerySchema` | #26 | `page`, `limit`, `sort`, `search`; server extends it with additive `role` / `isActive` filters (C-25; the shared schema itself is unchanged) |
| `adminUserPatchSchema` | #27 | any non-empty subset of `{name?, role?, isActive?}` |
| `presetCreateSchema` | #29 | `{name, apps: appEntry[] (1–50, unique keys)}` |
| `presetUpdateSchema` | #30 | any non-empty subset of `{name?, apps?}` |
| `agentLinkCreateSchema` | #33 | `{os, arch, label, url, version (semver)}`; the server additionally enforces an absolute **https** URL on the GitHub hosts `github.com` / `objects.githubusercontent.com` with no credentials (C-25) |
| `agentLinkUpdateSchema` | #34 | any non-empty subset of the create fields; a supplied `url` is re-checked with the same https/GitHub-host rule (C-25) |
| `deviceRegisterSchema` | #37 | `{codeHmac, os, name, agentVersion}`; `codeHmac` = 64-char lowercase SHA-256 hex of `"focus-mode-pair-v1\|" + code` (DEC-014) |
| `enrollPollSchema` | #38 | `{deviceId, enrollSecret}` (32–128 URL-safe chars). Status semantics (C-12): `404 NOT_FOUND` while the device is registered but not yet owned/paired (`ownerId` null) **and** for a wrong/unknown `enrollSecret` (indistinguishable, no enumeration); `200` + token once paired with a matching secret; `410 PAIRING_EXPIRED` once the token has been issued (enrollment consumed). The agent treats `404`/`202`/`204`/`200`-without-token as pending → retries with backoff until the 10-min code TTL; `400/401/403/409/410` are terminal. |
| `appEntrySchema` | nested everywhere | `{key: [a-z0-9-]{2,40}, label: 2–60, win?: string[], mac?: string[], linux?: string[]}` |
| `attestRequestSchema` | #11 | `nonce` is generated by the agent and single-use |

Every schema is a strict object → unknown fields are rejected (NFR-013); validation failures return `400 VALIDATION_ERROR` with `details[]` (NFR-001).

**Non-schema request parameters and response additions (W3/W4/W5, verified against shipped code):**
- **C-15** `GET /sessions/active` — no body/query; response `{session: PublicSession|null}` (§3.3 session shape).
- **C-16** `POST /allowlist/preset/:id` — query `?mode=merge|replace` (default `merge`), validated server-side against a strict enum (`VALIDATION_ERROR` otherwise); response is the standard allow-list object; protected entries in the preset are filtered out and `protectedApps` is never modified (INV-3).
- **C-17** `GET /sessions` — exactly `page,limit,sort,search,from,to,status,source`; **no `deviceId`**.
- **C-18** `GET /schedules` — ordering `startTime asc, _id asc`; replayed `POST /sessions` (same `clientSessionId` + same body) returns `200` with the original session (first create `201`); clients treat both as success.
- **C-21** `GET /users/me` — no body; 200 public user (identical shape to `/auth/me`).
- **C-22** `GET /notifications` — `page`/`limit` only; response is the standard paginated shape **plus `unreadCount`** (counted over ALL the caller's notifications, not just the current page). `PATCH /notifications/:id/read` is idempotent and keeps the first `readAt`.
- **C-23** `POST /devices/unpair-all` — no body; 200 `{unpaired: number}`; the `revoked` frame is pushed to each connected agent first, then all device rows of the caller are deleted (INV-5). Offline devices are revoked in the DB; zero devices → `{unpaired:0}`.
- **C-24** `GET /insights` — response adds optional `weekly` (present only for `30d`/`90d`); all analytics choices are documented in §3.3.
- **C-25** admin/health deltas verified against `server/src/services/admin.service.ts` + `health.routes.ts`: `GET /admin/users` accepts optional `role` (`USER|ADMIN`) and `isActive` (`"true"|"false"`, strict string enum) filters on top of the frozen query; `PATCH /admin/users/:id` answers `409 CONFLICT` for self-deactivation **and** self-demotion; `POST`/`PATCH /admin/agent-links` accept only absolute **https** URLs on `github.com` or `objects.githubusercontent.com` (no credentials; otherwise `400 VALIDATION_ERROR` with `details[{path:'url'}]`); `GET /admin/stats` includes four additive aliases; `GET /health/db` is a readiness probe (503 `INTERNAL` when mongoose is down — outside the standard business status table).
- **C-26** `POST /devices/:id/attest` replay status, verified against `server/src/services/attestation.service.ts`: the same `nonce` for the same `(userId, deviceId)` inside the 60 s TTL → **`409 CONFLICT`** with the standard error envelope and no `data`; a distinct nonce (or the same nonce for another device/user, or after the TTL) still returns 200. Request schema unchanged; the cache is process-local and bounded (defence-in-depth — §3.1 note, §12 C-26).

Mongo collections touched by these endpoints (TECHNICAL_DESIGN §4): `users`, `devices`, `sessions`, `allowlists`, `schedules`, `presets`, `scheduleRuns`, `notifications`, `agentLinks`. The API is the only writer (the dashboard and Focus Agent never touch Mongo directly).

### 3.3 Response object shapes (documented here, shaped by the server)

| Object | Shape |
|---|---|
| `public user` | `{id, name, email, role, timezone, defaultDurationMin, isActive, createdAt, lastLoginAt}` — **never** `passwordHash` (FR-001) |
| `auth result` | `{accessToken, user}` |
| `device` | `{id, name, os, status, agentVersion, pairedAt, lastSeenAt, capabilities?}` |
| `session` | `{id, deviceId, startedAt, endedAt, plannedMinutes, actualMinutes, status, source, clientSessionId, endReason, lastHeartbeatAt}` |
| `allow-list` | `{protectedApps: appEntry[], userApps: appEntry[], version}` — server seeds `protectedApps` from `shared/src/protected.ts`; PUT cannot change them |
| `schedule` | `{id, name, days, startTime, durationMin, enabled, lastRunAt, createdAt}` |
| `notification` | `{id, type, message, readAt, createdAt}` |
| `notification page` | paginated `notification` **plus `unreadCount`** (over all the caller's notifications, not just the page — C-22; newest first) |
| `preset` | `{id, name, apps, createdAt}` |
| `agent link` | `{id, os, arch, label, url, version, publishedAt}` |
| `insights` | `{range, timezone, totals:{focusMinutes, sessions, completed, cancelled, completionRate, currentStreak, longestStreak}, daily:[{date, minutes}], weekly?:[{weekStart, minutes}], bestHours:[{hour, minutes}]}` — **daily is always the last 7 local days regardless of range**; `weekly` (Monday-start `YYYY-MM-DD`) is present only for `30d`/`90d`; minutes are COMPLETED-only (ACTIVE/CANCELLED excluded), rounded to 0.1; completionRate = COMPLETED÷(COMPLETED+CANCELLED) rounded to 3dp (0 when none); streaks are all-time COMPLETED days with ≥10 min anchored today/yesterday; bestHours = top-3 local hours in range (C-24, REQUIREMENTS §6) |
| `admin stats` | seven canonical keys `{users, activeUsers, devices, connectedDevices, sessions, activeSessions, focusMinutes}` **plus four additive aliases** `{totalUsers, totalSessions, totalFocusMinutes, devicesConnected}` (same aggregates); `connectedDevices` = devices with status `CONNECTED` or `FOCUSING`; `focusMinutes` = Σ `actualMinutes` over all sessions rounded to 0.1; aggregates only, no per-user data (C-25) |
| `health` | `{status:'ok', db, uptimeSec}` for `/health` (db is disconnected/connecting/ok/disconnecting); `{status:'ok', db:'ok'}` for `/health/db` (200 when connected, otherwise 503 `INTERNAL`) |

### 3.4 Worked examples

`POST /auth/register` request:

```json
{
  "name": "Kabir",
  "email": "kabir.new@demo.com",
  "password": "Kabir@123"
}
```

Response `201`:

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1MDdmMWY3N2JjZjg2Y2Q3OTk0MzkwMTIifQ.signature",
    "user": {
      "id": "507f1f77bcf86cd799439012",
      "name": "Kabir",
      "email": "kabir.new@demo.com",
      "role": "USER",
      "timezone": "Asia/Kolkata",
      "defaultDurationMin": 60,
      "isActive": true,
      "createdAt": "2026-11-10T10:00:00.000Z",
      "lastLoginAt": null
    }
  }
}
```

`GET /devices` response `200`:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "507f1f77bcf86cd799439011",
        "name": "Kabir-MacBook",
        "os": "macOS",
        "status": "CONNECTED",
        "agentVersion": "1.4.0",
        "pairedAt": "2026-11-10T10:00:00.000Z",
        "lastSeenAt": "2026-11-10T10:05:30.000Z"
      }
    ],
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

`POST /sessions` request (created when the agent confirms `focusStarted`; FR-005/FR-024):

```json
{
  "deviceId": "507f1f77bcf86cd799439011",
  "durationMin": 60,
  "startedAt": "2026-11-10T10:05:00.000Z",
  "clientSessionId": "9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c",
  "source": "MANUAL"
}
```

Second ACTIVE session for the same device → `409`:

```json
{
  "success": false,
  "error": {
    "code": "ALREADY_FOCUSING",
    "message": "This device already has an active focus session."
  }
}
```

`PUT /allowlist` request:

```json
{
  "userApps": [
    {
      "key": "vscode",
      "label": "Visual Studio Code",
      "win": ["Code.exe"],
      "mac": ["com.microsoft.VSCode"]
    }
  ]
}
```

Omitting or altering a protected entry → `400`:

```json
{
  "success": false,
  "error": {
    "code": "PROTECTED_ENTRY",
    "message": "Protected apps cannot be removed: chrome, finder"
  }
}
```

`GET /sessions?page=1&limit=2&sort=-startedAt&status=COMPLETED` response `200`:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "507f1f77bcf86cd799439020",
        "deviceId": "507f1f77bcf86cd799439011",
        "startedAt": "2026-11-10T09:00:00.000Z",
        "endedAt": "2026-11-10T10:00:00.000Z",
        "plannedMinutes": 60,
        "actualMinutes": 60,
        "status": "COMPLETED",
        "source": "MANUAL",
        "clientSessionId": "3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f",
        "endReason": "COMPLETED",
        "lastHeartbeatAt": "2026-11-10T09:59:30.000Z"
      }
    ],
    "page": 1,
    "limit": 2,
    "total": 1,
    "totalPages": 1
  }
}
```

`GET /insights?range=30d` response `200` (daily is always the last 7 local days; `weekly` appears because the range is 30d — C-24):

```json
{
  "success": true,
  "data": {
    "range": "7d",
    "timezone": "Asia/Kolkata",
    "totals": {
      "focusMinutes": 245.5,
      "sessions": 6,
      "completed": 5,
      "cancelled": 1,
      "completionRate": 0.833,
      "currentStreak": 3,
      "longestStreak": 4
    },
    "daily": [
      { "date": "2026-11-05", "minutes": 25 },
      { "date": "2026-11-06", "minutes": 60.5 },
      { "date": "2026-11-07", "minutes": 0 },
      { "date": "2026-11-08", "minutes": 55 },
      { "date": "2026-11-09", "minutes": 40 },
      { "date": "2026-11-10", "minutes": 35 },
      { "date": "2026-11-11", "minutes": 30 }
    ],
    "weekly": [
      { "weekStart": "2026-10-26", "minutes": 120 },
      { "weekStart": "2026-11-02", "minutes": 245.5 }
    ],
    "bestHours": [
      { "hour": 9, "minutes": 120 },
      { "hour": 14, "minutes": 75.5 },
      { "hour": 20, "minutes": 50 }
    ]
  }
}
```

`POST /devices/:id/attest` request / response (REC-003, DEC-013):

```json
{ "nonce": "abcdefghijklmnopqrstuvwxyz012345" }
```

```json
{
  "success": true,
  "data": {
    "attestation": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1MDdmMWY3N2JjZjg2Y2Q3OTk0MzkwMTIifQ.signature",
    "expiresAt": "2026-11-10T10:01:00.000Z",
    "algorithm": "EdDSA"
  }
}
```

`GET /agent/attest-key` response `200` (cached by the agent at start; used to verify local attestations):

```json
{
  "success": true,
  "data": {
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAexamplepublickeymaterial\n-----END PUBLIC KEY-----",
    "algorithm": "EdDSA"
  }
}
```

`GET /users/me` response `200` (identical shape to `/auth/me` — C-21):

```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439012",
    "name": "Kabir",
    "email": "kabir@demo.com",
    "role": "USER",
    "timezone": "Asia/Kolkata",
    "defaultDurationMin": 60,
    "isActive": true,
    "createdAt": "2026-11-10T10:00:00.000Z",
    "lastLoginAt": "2026-11-11T05:30:00.000Z"
  }
}
```

`GET /notifications?page=1&limit=2` response `200` (paginated shape **plus `unreadCount`** — C-22):

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "507f1f77bcf86cd799439031",
        "type": "MISSED_RUN",
        "message": "Your 09:00 focus session was missed because the Focus Agent was offline.",
        "readAt": null,
        "createdAt": "2026-11-11T03:31:00.000Z"
      }
    ],
    "page": 1,
    "limit": 2,
    "total": 1,
    "totalPages": 1,
    "unreadCount": 1
  }
}
```

`POST /devices/unpair-all` response `200` (`revoked` pushed to each connected agent before the rows are deleted — C-23):

```json
{
  "success": true,
  "data": { "unpaired": 2 }
}
```

`GET /admin/stats` response `200` (seven canonical keys + four additive aliases — C-25):

```json
{
  "success": true,
  "data": {
    "users": 12,
    "activeUsers": 11,
    "devices": 7,
    "connectedDevices": 3,
    "sessions": 184,
    "activeSessions": 1,
    "focusMinutes": 5210.5,
    "totalUsers": 12,
    "totalSessions": 184,
    "totalFocusMinutes": 5210.5,
    "devicesConnected": 3
  }
}
```

`GET /health` response `200`:

```json
{
  "success": true,
  "data": { "status": "ok", "db": "ok", "uptimeSec": 42 }
}
```

`GET /health/db` response `200` (readiness; `503` with `{code:"INTERNAL"}` while mongoose is not connected — C-25):

```json
{
  "success": true,
  "data": { "status": "ok", "db": "ok" }
}
```

---

## 4. Local channel — dashboard ↔ Focus Agent (TECHNICAL_DESIGN §6.1–6.2)

### 4.1 Transport

| Property | Value |
|---|---|
| URL | `ws://127.0.0.1:4545/link` — agent port `AGENT_PORT=4545`, fallback `4546`–`4549` (`VITE_AGENT_PORT`, `VITE_AGENT_PORT_RANGE=5`) |
| Bind address | **`127.0.0.1` only** (never `0.0.0.0`; LAN IP unreachable — NFR-010) |
| Subprotocol | `Sec-WebSocket-Protocol: focus.v1` |
| Limits | max 3 concurrent connections, max frame 16 KB, max 20 msg/s per socket |
| Envelope | every message is a JSON object `{v: 1, id: "<correlation-id>"}` + `type`; `shared/src/protocol.ts` `envelopeSchema` |

### 4.2 Upgrade checks (NFR-010, SEC — mandatory, not optional)

| Check | Rule on failure |
|---|---|
| `Origin` ∈ `AGENT_ALLOWED_ORIGINS` (server `CLIENT_URL` list, comma-separated; dev `http://localhost:5173`) | reject upgrade `403` |
| `Host` ∈ `{127.0.0.1:<port>, localhost:<port>}` (DNS-rebinding defence) | reject upgrade `403` |
| `Sec-WebSocket-Protocol: focus.v1` requested and selected | reject upgrade `400` |
| Frame size > 16 KB (`ws` `maxPayload`) | library closes the socket with **`1009`** (message too big) |
| Protocol/policy violation (bad handshake, rate > 20 msg/s) | close policy **`1008`** (policy violation) |

Oversized frames are closed by the `ws` library itself with `1009`; explicit protocol violations use `1008`. The dashboard treats **both** as a disconnect (fail closed) and reconnects with backoff (§4.7) — no behaviour change, this is a documentation correction (DEC-015).

### 4.3 Directions and pre-authentication rules

`A → D` = agent → dashboard, `D → A` = dashboard → agent. The direction table is exported as `LOCAL_MESSAGE_DIRECTIONS`; the agent must reject a frame sent the wrong way.

Before `authOk`, the agent accepts **only** these inbound messages (exported as `UNAUTHENTICATED_INBOUND_TYPES`): `auth`, `getState`, `paired`. A control message (`enterFocus`, `exitFocus`, `listApps`) sent before authentication is answered with `focusRejected{code:'UNAUTHENTICATED'}` and the socket is closed (`1008`); any other unexpected pre-auth frame is answered with `authError{code:'UNAUTHENTICATED'}` and closed (`1008`).

**`auth` failure mapping (C-13, implemented by T-044).** A single-use nonce is consumed before verification. Then:
- a correctly signed token whose `sub` is **another account** (valid token, wrong user) → `authError{code:'FORBIDDEN'}`;
- every other failure — malformed token, non-`EdDSA` alg, bad signature, expired or over-long TTL, not-yet-valid, wrong `aud`, nonce mismatch/replay, unavailable/unusable/unknown key, or an unpaired agent → `authError{code:'UNAUTHENTICATED'}`.
The socket is closed after either error (`1008`).

**Control messages (W3 shipped; verified in the W6 review).** After a valid attestation, `enterFocus`, `exitFocus` and `listApps` are routed to the Focus Agent's real control handlers (`link/handlers.ts` → `FocusController`, with the REC-004 native consent gate for the first focus on a device). A fail-closed `focusRejected{code:'INVALID'}` is returned only when a build has no control handlers wired (test harnesses) or the request cannot be processed — it is a defensive fallback, not the current product behaviour. §4.5 remains the frozen message contract.

### 4.4 Handshake (REC-003, SEC-7)

1. Dashboard opens the socket. Agent immediately sends `hello`.

```json
{
  "v": 1,
  "id": "a-001",
  "type": "hello",
  "agentId": "agent-1",
  "agentVersion": "1.4.0",
  "os": "macOS",
  "state": "IDLE",
  "paired": false,
  "capabilities": { "focus": "full" }
}
```

2. If paired, the agent sends a single-use `challenge` nonce.

```json
{
  "v": 1,
  "id": "a-002",
  "type": "challenge",
  "nonce": "abcdefghijklmnopqrstuvwxyz012345"
}
```

3. Dashboard calls `POST /devices/:id/attest {nonce}` (REST, Bearer user JWT) and receives a short-lived **attestation JWT**.

```json
{
  "v": 1,
  "id": "d-003",
  "type": "auth",
  "attestation": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1MDdmMWY3N2JjZjg2Y2Q3OTk0MzkwMTIifQ.signature"
}
```

4. Agent verifies and answers `authOk` (or `authError`).

```json
{
  "v": 1,
  "id": "a-004",
  "type": "authOk",
  "deviceId": "507f1f77bcf86cd799439011",
  "userId": "507f1f77bcf86cd799439012"
}
```

```json
{
  "v": 1,
  "id": "a-005",
  "type": "authError",
  "code": "UNAUTHENTICATED",
  "message": "Attestation rejected"
}
```

**Attestation rules (DEC-013):** algorithm **EdDSA (Ed25519)** — RS256 is only allowed via an amendment ADR; TTL **60 s**; claims bound to `nonce` (must equal the challenge nonce), `aud = deviceId`, `sub = userId` where `userId` equals the paired owner; the agent caches the public key from `GET /agent/attest-key`; keys are single-line PEM env values (`ATTEST_PRIVATE_KEY`, `ATTEST_PUBLIC_KEY`). A nonce is single-use — replay fails. **Implementation note (DEC-016):** the EdDSA/Ed25519 JWT is signed and verified with `node:crypto` (RFC 8037; `createPrivateKey`/`createPublicKey`, `crypto.sign`/`crypto.verify` with `null` algorithm); `jsonwebtoken@9.0.3` cannot do EdDSA and is used only for the HS256 user access token (SEC-2). Any standard JOSE implementation can verify the same wire format.

### 4.5 Message catalog — local channel (16 messages, frozen)

Every message below is validated by the named zod schema in `shared/src/protocol.ts`.

#### `hello` — A → D
Fields: `agentId: string(1–100)`, `agentVersion: semver`, `os: macOS|windows|linux`, `state: IDLE|PAIRED|FOCUSING`, `paired: boolean`, `capabilities: {focus: full|partial|unsupported, reasons?: string[](≤10)}`.
Invariants: **INV-1** (only the Focus Agent reports its own OS/capabilities), **INV-2** (no control fields). Example above.

#### `challenge` — A → D
Fields: `nonce: string(16–128, URL-safe)`. Invariant: security gate for REC-003 (no OS control before attestation). Example above.

#### `auth` — D → A
Fields: `attestation: string(20–4096)`. Invariant: REC-003 / SEC-7 — the only way to unlock control messages. Example above.

#### `authOk` — A → D
Fields: `deviceId: ObjectId`, `userId: ObjectId`. Invariant: REC-003. Example above.

#### `authError` — A → D
Fields: `code: ErrorCode` (13-code vocabulary), `message: string(1–300)`. The code mapping is frozen by **C-13** (§12): a correctly signed token for another account → `FORBIDDEN`, every other `auth` failure → `UNAUTHENTICATED`; `NOT_PAIRED` is a `focusRejected` code (§4.6) and is never emitted on `authError`. Invariant: REC-003, NFR-010. Example above.

#### `paired` — D → A
Fields: none (`{}`). Invariant: REC-002 — a **nudge only**; the agent polling the cloud is the only way to obtain a device token. Example:

```json
{ "v": 1, "id": "d-006", "type": "paired" }
```

#### `getState` — D → A
Fields: none. Invariant: **INV-5** (agent truth is always queryable, incl. after reconnect). Example:

```json
{ "v": 1, "id": "d-007", "type": "getState" }
```

#### `state` — A → D
Fields: `state`, `session?: {sessionId: uuid, startedAt, endsAt, plannedMinutes, source}`, `protected: appEntry[]`, `allowList: appEntry[]`.
Invariants: **INV-5** (agent is the UI source of truth), **INV-6** (only app keys/labels — no titles/URLs), **INV-3** (protected list reported so the dashboard can lock rows). Example:

```json
{
  "v": 1,
  "id": "a-008",
  "type": "state",
  "state": "PAIRED",
  "session": null,
  "protected": [
    { "key": "chrome", "label": "Google Chrome", "mac": ["com.google.Chrome"] }
  ],
  "allowList": [
    { "key": "vscode", "label": "Visual Studio Code", "win": ["Code.exe"] }
  ]
}
```

#### `listApps` — D → A
Fields: none. Invariant: REC-007 (allow-list picker), **INV-6** (no titles). Example:

```json
{ "v": 1, "id": "d-009", "type": "listApps" }
```

#### `apps` — A → D
Fields: `apps: {key, label, running}[]`. Invariant: **INV-6** (key+label+running only). Example:

```json
{
  "v": 1,
  "id": "a-010",
  "type": "apps",
  "apps": [
    { "key": "vscode", "label": "Visual Studio Code", "running": true },
    { "key": "slack", "label": "Slack", "running": false }
  ]
}
```

#### `enterFocus` — D → A
Fields: `durationMin: 1–480`, `allowList: appEntry[](≤50)`, `reaside?: boolean`, `consent: {acceptedAt: iso, version: string(1–32)}`, `clientSessionId: uuid`.
Invariants: **INV-1** (only the Focus Agent applies focus), **INV-3** (protected entries are never candidates), **INV-4** (agent journals *before* applying), **INV-2** (this request comes from the user's authenticated local socket, never from the cloud). Example:

```json
{
  "v": 1,
  "id": "d-011",
  "type": "enterFocus",
  "durationMin": 60,
  "allowList": [
    { "key": "vscode", "label": "Visual Studio Code", "win": ["Code.exe"] }
  ],
  "reaside": true,
  "consent": { "acceptedAt": "2026-11-10T10:04:30.000Z", "version": "consent-v1" },
  "clientSessionId": "9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c"
}
```

#### `focusStarted` — A → D
Fields: `at: iso`, `endsAt: iso`, `protected: appEntry[]`, `state: "FOCUSING"`, `sessionId: uuid` (= the `clientSessionId`), `source: MANUAL|SCHEDULE`.
Invariants: **INV-4** (emitted only after the journal write + apply), **INV-1**. Example:

```json
{
  "v": 1,
  "id": "a-012",
  "type": "focusStarted",
  "at": "2026-11-10T10:05:00.000Z",
  "endsAt": "2026-11-10T11:05:00.000Z",
  "protected": [
    { "key": "chrome", "label": "Google Chrome", "mac": ["com.google.Chrome"] }
  ],
  "state": "FOCUSING",
  "sessionId": "9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c",
  "source": "MANUAL"
}
```

#### `focusRejected` — A → D
Fields: `code: ALREADY_FOCUSING|UNAUTHENTICATED|NOT_PAIRED|CONSENT_REQUIRED|UNSUPPORTED|INVALID`, `message: string(1–300)`.
Invariant: **INV-5** (a rejected request never leaves focus applied — the agent has already restored or never applied). Example:

```json
{
  "v": 1,
  "id": "a-013",
  "type": "focusRejected",
  "code": "ALREADY_FOCUSING",
  "message": "A focus session is already running."
}
```

#### `exitFocus` — D → A
Fields: `sessionId?: uuid`. Invariant: **INV-5** (restore is always reachable and idempotent). Example:

```json
{
  "v": 1,
  "id": "d-014",
  "type": "exitFocus",
  "sessionId": "9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c"
}
```

#### `focusEnded` — A → D
Fields: `sessionId: uuid`, `at: iso`, `reason: COMPLETED|USER|AGENT|SLEEP|CRASH_RECOVERY|UNPAIRED|QUIT`, `actualMinutes: 0–1440`.
Invariants: **INV-5** (restore completed before emit), **INV-4** (journal cleared after restore). Example:

```json
{
  "v": 1,
  "id": "a-015",
  "type": "focusEnded",
  "sessionId": "9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c",
  "at": "2026-11-10T11:05:00.000Z",
  "reason": "COMPLETED",
  "actualMinutes": 60
}
```

#### `scheduleHeadsUp` — A → D
Fields: `scheduleId: ObjectId`, `startsAt: iso`. Invariant: **INV-2** (a scheduled start is announced, never commanded; the user can cancel; the cloud never sends OS commands). If the user cancels the heads-up, the agent reports `scheduleRunCancelled` on the cloud channel (§5.3, C-19). Example:

```json
{
  "v": 1,
  "id": "a-016",
  "type": "scheduleHeadsUp",
  "scheduleId": "507f1f77bcf86cd799439013",
  "startsAt": "2026-11-11T03:30:00.000Z"
}
```

### 4.6 `focusRejected` codes

| Code | Meaning | Dashboard treatment |
|---|---|---|
| `ALREADY_FOCUSING` | agent is already FOCUSING (FR-024) | toast; resync `getState` |
| `UNAUTHENTICATED` | control message on an unattested socket (REC-003) | re-run handshake |
| `NOT_PAIRED` | agent has no device token | show "Pair a device" |
| `CONSENT_REQUIRED` | native agent consent (REC-004) not yet given | show agent-side dialog hint |
| `UNSUPPORTED` | `capabilities.focus = unsupported` (e.g. Wayland) | disable Start with reason (FR-005) |
| `INVALID` | malformed/unprocessable control request (strict-schema failure inside the agent, controller error, or no control handlers wired in this build) | log + toast |

### 4.7 Reconnect & resync (FR-014)

Dashboard `AgentLink`: connect → handshake; on close/error, reconnect with exponential backoff `0.5 s → 8 s`, re-scan ports 4545–4549, then `getState` to resync. Agent accepts ≤ 3 sockets. If the agent restarts during focus it restores from the journal *before* serving `hello` (INV-4/INV-5, `CRASH_RECOVERY`). Close codes `1009` (oversized frame) and `1008` (protocol violation) both mean “socket not usable” → reset the handshake and reconnect (§4.2).

### 4.8 DEC-003 guarantee — no pairing code over the local channel

The 6-digit code is **never** in any local-channel message. It is shown in the agent UI, typed into the dashboard, and verified by the **cloud** (`/devices/pair`). The frozen schemas are strict, so a `pairingCode` field is rejected; `shared/src/protocol.test.ts` asserts (a) no local schema property matches `pairing|pairToken|codeHmac|enrollSecret`, (b) no 6-digit string enum/const exists, (c) no valid fixture contains a 6-digit string, and (d) injecting `pairingCode` fails validation. A forged `paired` nudge is harmless because the agent still polls the cloud.

---

## 5. Cloud channel — Focus Agent ↔ API (TECHNICAL_DESIGN §6.3, REC-001)

### 5.1 Transport

| Property | Value |
|---|---|
| URL | `wss://<api-host>/api/v1/agent-link` (derived from `AGENT_API_BASE_URL`; the agent appends `/agent-link`) |
| Auth | HTTP upgrade carries `Authorization: Bearer <deviceToken>` (Node `ws` can set headers; browsers cannot — this socket is agent-only) |
| Presence | agent → cloud `heartbeat` every **15 s**; server marks the device `DISCONNECTED` after **45 s** without a heartbeat |
| Reconnect | agent reconnects with backoff; missed scheduleDue windows are recorded as `MISSED` by the server, never retried as commands |
| Envelope | same `{v: 1, id, type}` envelope; strict payloads |
| Unknown/invalid token at upgrade | the socket is upgraded then closed with **`4401`** (no presence entry; the agent treats it as revoked/token-invalid) |
| Revoked (unpair) | server sends `revoked` then closes with `1000`; the agent restores first if FOCUSING, drops the stored token and returns to `IDLE` |

### 5.2 INV-2 whitelist (hard rule)

Cloud → agent may send **only** `scheduleDue` and `revoked`. There is no `enterFocus`, no `exitFocus`, no `focusEnded` command from the cloud — scheduling may only *announce* a due run, and the agent then follows its local consent + heads-up path. `CLOUD_MESSAGE_DIRECTIONS` encodes this and `protocol.test.ts` asserts the cloud→agent set is exactly `['revoked','scheduleDue']`.

> **Implementation note (DEC-016, see §6):** the attestation described in §4.4 is an RFC 8037 EdDSA/Ed25519 JWT signed/verified with `node:crypto`; `jsonwebtoken@9.0.3` handles only the HS256 user access token. The algorithm is unchanged — DEC-013 was amended only on the library claim.

### 5.3 Message catalog — cloud channel (6 messages, frozen)

#### `heartbeat` — agent → cloud
Fields: `state: IDLE|PAIRED|FOCUSING`, `sessionId?: uuid`. Invariants: REC-001 presence, **INV-2** (status only, no commands), **INV-6** (no window data). Example:

```json
{
  "v": 1,
  "id": "c-001",
  "type": "heartbeat",
  "state": "FOCUSING",
  "sessionId": "9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c"
}
```

#### `session.started` — agent → cloud
Fields: `clientSessionId: uuid`, `startedAt: iso`, `plannedMinutes: 1–480`, `source: MANUAL|SCHEDULE`, **`scheduleRunId?: ObjectId`** (present when `source: 'SCHEDULE'` — links the session to the dispatched `scheduleRuns` doc; optional/backward-compatible so older agents still validate — DEC-021/C-19). Invariants: REC-006 idempotency, **INV-1/INV-2** (reporting, not commanding), **INV-6** (no OS detail). Example:

```json
{
  "v": 1,
  "id": "c-002",
  "type": "session.started",
  "clientSessionId": "9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c",
  "startedAt": "2026-11-10T10:05:00.000Z",
  "plannedMinutes": 60,
  "source": "MANUAL"
}
```

#### `session.ended` — agent → cloud
Fields: `clientSessionId: uuid`, `endedAt: iso`, `actualMinutes: 0–1440`, `status: COMPLETED|CANCELLED`, `endReason: EndReason`. Invariants: REC-006 idempotency, **INV-5** (restore already done). Example:

```json
{
  "v": 1,
  "id": "c-003",
  "type": "session.ended",
  "clientSessionId": "9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c",
  "endedAt": "2026-11-10T11:05:00.000Z",
  "actualMinutes": 60,
  "status": "COMPLETED",
  "endReason": "COMPLETED"
}
```

#### `scheduleRunCancelled` — agent → cloud
Fields: `runId: ObjectId` (the dispatched `scheduleRuns` id), `at: iso`. Invariants: **INV-2 unchanged** (agent→cloud report only — the cloud still cannot command focus), FR-012 (the user cancelled the local ≥10 s heads-up) and C-19 (the run becomes `CANCELLED_BY_USER`; no session is created). Example:

```json
{
  "v": 1,
  "id": "c-006",
  "type": "scheduleRunCancelled",
  "runId": "507f1f77bcf86cd799439014",
  "at": "2026-11-10T10:00:10.000Z"
}
```

#### `scheduleDue` — cloud → agent
Fields: `runId: ObjectId`, `scheduleId: ObjectId`, `durationMin: 1–480`, `allowListVersion: integer ≥ 0`. Invariants: **INV-2** (one of the only two cloud→agent messages; announces, never commands), FR-012 (agent shows ≥10 s heads-up before starting). Example:

```json
{
  "v": 1,
  "id": "c-004",
  "type": "scheduleDue",
  "runId": "507f1f77bcf86cd799439014",
  "scheduleId": "507f1f77bcf86cd799439013",
  "durationMin": 25,
  "allowListVersion": 3
}
```

#### `revoked` — cloud → agent
Fields: none. Invariants: **INV-2**, **INV-5** (agent restores first if FOCUSING, then `IDLE`, drops the stored token; FR-029 unpair-all). Example:

```json
{ "v": 1, "id": "c-005", "type": "revoked" }
```

### 5.4 Reporting idempotency (REC-006)

- `clientSessionId` (UUID, generated once per focus session — by the dashboard for MANUAL starts, by the agent for SCHEDULE starts) is **the** idempotency key. The sessions collection has a unique `{userId, clientSessionId}` index.
- `session.started` and `session.ended` may race with the dashboard's `POST /sessions` / `PATCH /sessions/:id`; the server upserts on `{userId, clientSessionId}` and only finalises once. A duplicate report with the same body → `200`, no double count; a conflicting body for an already-finalised session → `409 CONFLICT`.
- The local-channel `sessionId` in `focusStarted`/`focusEnded` equals that `clientSessionId` (the cloud document `_id` never travels over the local channel).
- **Schedule runs (C-19):** a `session.started` carrying `scheduleRunId` confirms the dispatched run (`STARTED` → session linked) and is idempotent under the same `clientSessionId`; `scheduleRunCancelled` flips the run to `CANCELLED_BY_USER` exactly once; a run can never be confirmed twice or by another user's device.

### 5.5 Scheduler semantics (TECHNICAL_DESIGN §8)

- `node-cron` minute tick; a schedule is due when the user's local day ∈ `days`, local `HH:mm === startTime` (uses the user's IANA timezone via `Intl`), and `lastRunAt` is not in the same minute (idempotent).
- Device `CONNECTED` + `PAIRED` → the server creates a `scheduleRuns` document (`status: STARTED`, `firedAt`, `deviceId`) and sends `scheduleDue {runId, scheduleId, durationMin, allowListVersion}`. The agent shows its local ≥10 s heads-up and starts focus locally only after consent — the cloud announces, never commands (INV-2).
- **Run lifecycle (C-19, DEC-021):**
  - **Dispatch → STARTED:** `scheduleDue` sent and the run stored as `STARTED`.
  - **Confirm → session:** agent reports `session.started {…, source:'SCHEDULE', scheduleRunId}`; the server links the session to the run (same user/schedule/device, run still `STARTED`) and marks it confirmed. Duplicate report is idempotent (REC-006).
  - **User cancel → CANCELLED_BY_USER:** agent sends `scheduleRunCancelled {runId, at}` for a cancelled heads-up; no session is created.
  - **Offline at due time → MISSED:** device not `CONNECTED`+`PAIRED` at dispatch → `scheduleRuns(MISSED)` + notification; **force nothing**, never queue a command for later (INV-2/FR-012).
  - **Stale STARTED → MISSED:** a `STARTED` run with no confirming `session.started` within **2 minutes** of `firedAt` (agent crashed after dispatch) is reaped to `MISSED` + notification, so a dead run cannot block the next one.
- Reaper every 5 min finalises abandoned ACTIVE sessions from heartbeat bounds (`status: CANCELLED` unless the agent reported COMPLETED) — analytics honesty (FR-028).

---

## 6. Responsibility matrix and invariants

| INV | Rule (AGENTS §3) | Enforced where |
|---|---|---|
| **INV-1** | Only the Focus Agent touches the OS | Dashboard/API have no OS code; local control messages end at the agent; cloud cannot send focus commands |
| **INV-2** | Cloud may send the agent only `scheduleDue` and `revoked` | §5.2; `CLOUD_MESSAGE_DIRECTIONS`; contract test |
| **INV-3** | Protected set is never removable or touched | `shared/src/protected.ts` + `assertNoProtectedRemoval` (server `PUT /allowlist`); agent excludes protected entries from candidates; `focusStarted.protected` reported |
| **INV-4** | Journal is written **before** focus is applied | Agent `FocusController.enterFocus` order; `focusStarted`/`focusEnded` semantics (§4.5) |
| **INV-5** | Restore is idempotent and reachable from the tray at all times | `exitFocus`, agent tray, `focusEnded` on every end trigger; `getState` resync |
| **INV-6** | No window titles/URLs/contents are read or transmitted | `apps`/`state` payloads carry only `{key,label,running}` / app entries; schemas are strict so nothing extra can be added |

| Fact | Component | Never does |
|---|---|---|
| Accounts, devices, sessions, schedules, allow-lists, analytics | API | Touch the OS (INV-1) |
| Focus application/restore | Focus Agent | Act without pairing + user start (audit at agent) |
| Pairing code display | Focus Agent UI | Send the code over the local channel (DEC-003) |

### 6.1 DEC-013 conventions (frozen — W1 was accepted against these)

| Convention | Contract value | Consumer code |
|---|---|---|
| API base URL | Full base **including `/api/v1`** in `VITE_API_BASE_URL` and `AGENT_API_BASE_URL`; callers append endpoint paths only (§1.1, §1.11) | `client/src/api/http.ts`, `agent/src/config/env.ts`, `agent/src/cloud/*` |
| Attestation | **EdDSA (Ed25519)**, 60 s TTL, bound to `nonce` + `aud=deviceId` + `sub=userId`; signed/verified via `node:crypto` (RFC 8037, DEC-016); `jsonwebtoken` only for HS256 user tokens; RS256 needs an amendment ADR | `POST /devices/:id/attest`, `GET /agent/attest-key`, agent link auth (T-044) |
| Seed identities | `admin@demo.com / Admin@123` (ADMIN), `kabir@demo.com / Kabir@123` (USER); registration always creates USER | `server/src/seed`, README, `SEED_*` env |

### 6.2 W3/W4 contract additions (A2-reviewed 2026-11-10)

| Ref | Addition | Where |
|---|---|---|
| C-14 | Pairing attempt latch is **per authenticated user** within the 10-min TTL (DEC-017): attempts 1–5 → `400 INVALID_PAIRING_CODE`, 6th+ → `410 PAIRING_EXPIRED`; correct codes from other users unaffected | §1.9, §12 C-14 |
| C-15 | `GET /sessions/active` (USER) → `{session: PublicSession\|null}` for dashboard refresh/link reconnect | §3.1 #42 |
| C-16 | `POST /allowlist/preset/:id?mode=merge\|replace` (default `merge`; protected apps filtered; `protectedApps` untouched — INV-3) | §3.1 #43 |
| C-17 | `GET /sessions` filters exactly `page,limit,sort,search,from,to,status,source` — **no `deviceId`** | §3.2 |
| C-18 | `GET /schedules` order `startTime asc, _id asc`; replayed `POST /sessions` → `200` (first create `201`) | §3.1 #12/#17, §1.6 |
| C-19 | Schedule-run lifecycle; new agent→cloud `scheduleRunCancelled {runId, at}`; optional `session.started.scheduleRunId` (DEC-021) | §5.3, §5.4, §5.5, §12 C-19 |
| C-20 | `GET /agent/allowlist` (device-token auth) → `{protectedApps,userApps,version}` for scheduled starts (endpoint added by A5 in W4) | §3.1 #39 |

These additions were reviewed by **A2 against the W3/W4 code and ADRs (DEC-017/DEC-019/DEC-021)** on 2026-11-10; A8 re-checks them in the W4 integration pass. INV-2 is unchanged — cloud→agent remains exactly `[scheduleDue, revoked]`.

**W6 shipped-message review (2026-11-11):** all 16 local + 6 cloud messages match the shipped agent/server code. The `/agent-link` hub accepts exactly the four `AGENT_TO_CLOUD` types (`heartbeat`, `session.started`, `session.ended`, `scheduleRunCancelled`) and still sends only `scheduleDue`/`revoked`; the local link routes authenticated control messages to the W3 handlers. **No message drift found.**

**W7 re-check (2026-11-11):** W7's client route-level code split (`React.lazy` + vendor chunks) and agent hardening changed **no message, field, direction or status code**. `session.started` (incl. optional `scheduleRunId`) and `scheduleRunCancelled` are unchanged, the cloud channel is still 4 up / 2 down, and INV-2 (`[scheduleDue, revoked]`) still holds. **No wire change in W7.**

---

## 7. Error handling matrix (REST + local channel)

- REST errors: §1.4 envelope with `error.code` from the 13-code vocabulary; `details[]` only for `VALIDATION_ERROR`; no stack traces.
- Local channel: `authError.code` uses the same vocabulary; `focusRejected.code` uses the 6 local-only codes in §4.6. Neither carries a stack or OS internals.
- User-facing copy lives in `docs/UX_SPEC.md` §6 (A3 owns it); this contract only freezes codes/shapes. Dashboard maps `code → copy` once.

---

## 8. Requested changes

| # | Requested by | Date (IST) | Contract area | Proposed change | Status |
|---|---|---|---|---|---|
| 1 | A2 (shipped-code review, W6) | 2026-11-11 | `/health` probes | Document the shipped `GET /health/db` readiness variant + root `/health` hosting alias, including `503 INTERNAL` when the DB is down (shipped in W1; never in the contract table). | ACCEPTED — documented in C-25 |
| 2 | A2 (shipped-code review, W6) | 2026-11-11 | Admin API | Document the W5 additive admin surface: four stats aliases, `role`/`isActive` filters, self-demotion/-deactivation `409 CONFLICT`, agent-link https + GitHub host allowlist. | ACCEPTED — documented in C-25 |
| 3 | A2 (shipped-code review, W6) | 2026-11-11 | List ordering | Record the shipped per-resource orders (notifications `createdAt desc`; presets `createdAt desc`; public agent-links `os,arch,_id`; admin agent-links `publishedAt desc`) instead of the old generic `createdAt desc` sentence. | ACCEPTED — documented in §1.6 / C-25 |
| 4 | A2 (W7 contract review) | 2026-11-11 | `POST /devices/:id/attest` | Document the shipped server-side single-use nonce replay cache: a replayed `(userId, deviceId, nonce)` inside the 60 s TTL answers `409 CONFLICT` (no attestation), first use still 200. ADR already exists (**DEC-025**), no schema change. | ACCEPTED — folded in as **C-26** (§3.1 #11 + note, §3.2, §12) |
| 5 | A2 (W7 contract review) | 2026-11-11 | §1.9 rate limits | The shipped W6 limiters are broader than the four rows in §1.9: `RATE_LIMIT_*_MAX` also gates insights (60/min/user), notifications (120/min/user), sessions (120/min/user), user settings (60/min/user), admin (120/min/user), the public/agent routes (`RATE_LIMIT_PUBLIC_MAX`, 60/min/IP, on `/agent/enroll/poll` + `/agent/attest-key`) and a general `/api/v1` flood guard (600/min/IP). Proposed: extend the §1.9 table (documentation only — defaults/security unchanged). | **PENDING** — needs A0/A8 ack; not folded in this pass |

To request a change: add a row here **and** notify A2/A8 and A0 — then follow §9. Do not implement a divergent message/endpoint/schema “just for now”; a rejected request keeps the frozen contract.

---

## 9. Change process (AGENTS §5)

1. **ADR** in `docs/DECISIONS.md` (A0 owns): context → decision → consequences; bump the protocol version if a wire format changes.
2. **`docs/INTEGRATION_CONTRACTS.md`** (this file, A2) updated with the new/changed contract + examples.
3. **`shared/`** (A2) updated: schema/type/guard + colocated test; `npm run build -w @focus-mode/shared`.
4. **Approval:** A2 + A8 review; contract test added/updated; A0 records the decision and applies tag `contracts-v1.x`.
5. Re-run the consistency check in §11 and paste the output in the PR/status row.

Rules that never change without replacing an INV in AGENTS §3: envelopes, the 13 error codes, protected-set semantics, the pairing-code-never-on-local-channel rule, INV-2.

---

## 10. Sign-off

| Role | Owner | Area reviewed | Status | Date | Evidence (one line) |
|---|---|---|---|---|---|
| Frontend | A4 | REST endpoints used by the dashboard (auth, devices, sessions, allow-list, schedules, insights, admin), local WS client, error envelopes | **ACCEPTED** | 2026-11-10 | PR #2 merged; CI green on ubuntu-24.04/windows-latest/macos-latest; unit/integration 353 tests |
| Backend | A5 | All REST endpoints/payload schemas, pairing + attestation, scheduler/agent-link semantics | **ACCEPTED** | 2026-11-10 | PR #3 merged; CI green on ubuntu-24.04/windows-latest/macos-latest; unit/integration 353 tests |
| Database | A6 | Data shapes behind §3 (9 collections + indexes incl. partial-unique ACTIVE session per device, DEC-013 seed identities) | **ACCEPTED** | 2026-11-10 | PR #4 merged; CI green on ubuntu-24.04/windows-latest/macos-latest; unit/integration 353 tests |
| Desktop Agent | A7 | Local WS server/handshake, all 16 local messages, cloud client/heartbeat/idempotency | **ACCEPTED** | 2026-11-10 | PR #4 merged (agent W1); CI green on ubuntu-24.04/windows-latest/macos-latest; unit/integration 353 tests; W2 cloud/auth tracked in T-042/T-044 |
| Integration | A8 | Contract tests, env/base-URL convention, pairing flow, cross-package consistency | **ACCEPTED** | 2026-11-10 | 93/93 automated contract checks; pairing E2E green on merged W2; C-12/C-13 match shipped code |
| Contract fold-in review (W4/W5) | A2 | Shipped-code review of all W4/W5 REST routes + local/cloud messages; C-14…C-25 fold-in | **SIGNED** | 2026-11-11 | 46/46 endpoints, 16/16 local + 6/6 cloud messages verified against code; C-21…C-25 verified; no contract-breaking drift (1128 unit tests + 27/27 E2E at the W5 gate) |
| W7 contract review — C-26 folded; shipped-code re-check | A2 | C-26 fold-in + shipped-code re-check of the attest route, the cloud/local message set after the W7 client routing/bundle split and agent hardening, and the error envelopes | **SIGNED** | 2026-11-11 | **No wire changes in W7** — `session.started` / `scheduleRunCancelled` unchanged, 46/46 endpoints still match routes; C-26 documented from `attestation.service.ts` + the 409 regression tests (`security-hardening.test.ts`, `attestation.test.ts`, `w6-followup-hardening.test.ts`); W7 gate **1421 unit tests (server 450)** + **E2E 50/50 twice back-to-back**; §11 **36/36** checks + 48/48 JSON examples PASS |

A0 recorded W1 acceptance on 2026-11-10: **PRs #2/#3/#4 merged, CI green on `ubuntu-24.04` / `windows-latest` / `macos-latest`, unit/integration suites 353 tests green**. W2 (pairing + attestation + agent-link hub + agent cloud client + client AgentLink) is **merged to `main` with CI green**. A8 signed off the contract on 2026-11-10 (**93/93 automated contract checks; pairing E2E green on merged W2; C-12/C-13 match shipped code**), so **all five rows are ACCEPTED**; the `contracts-v1` tag stands, and any further wire change follows §9 (`contracts-v1.1`). A8/A0 also confirmed the C-12 wording (404 when `ownerId` is `null` or the enroll secret is wrong/unknown; 200 once paired with a matching secret; 410 once consumed) matches shipped code.

**W4 contract additions** (C-14…C-20; new agent→cloud `scheduleRunCancelled`; optional `session.started.scheduleRunId`) were **A2-reviewed on 2026-11-10** and are recorded in §12; A8 re-checks them in the W4 integration pass.

**W5 contract additions** (C-21…C-25) were reviewed against the **shipped W5 code** and **A2-signed on 2026-11-11**; the W6 delta list (documented drift vs code bugs) is in that task's report. No frozen wire format changed — C-21…C-25 are additive endpoints/fields, response aliases, security tightening and ordering documentation.

**W6 security addition** (**C-26**, server-side single-use attestation nonce replay cache) comes from **DEC-025** and the W6 security fixes in `439792b`; it is documented in §3.1/§3.2/§12 and **adds one error status on an existing route only** (`409 CONFLICT` on `POST /devices/:id/attest`) — no new endpoint, field or message, so `contracts-v1` stands.

**W7 contract review** (2026-11-11): the W7 work was test consolidation, client route-level bundle splitting and agent hardening — **it produced no wire change**. Re-checked against the merged W7 tree: the cloud channel is still 6 messages (4 up / 2 down) with `session.started` and `scheduleRunCancelled` byte-identical in shape, the local channel is still 16 messages, and all 46 endpoints still match their shipped routes and error columns. Evidence at the gate: **1421 unit tests (server 450)**, **E2E 50/50 twice back-to-back** (retries 0, 15 files), §11 36/36 + 48/48 JSON. The only contract-relevant W7 finding was **documentation drift**, not code drift: §1.7 still said 5 cloud messages (fixed here), and the W6 replay-cache tests were labelled `delta C-25` in `attestation.test.ts` (code comment; the contract id is **C-26** — noted for A5, not edited from this task).

---

## 11. Consistency check (doc ↔ shared ↔ TECHNICAL_DESIGN)

Run from the repo root (script in `/tmp`, not committed):

```bash
node /tmp/a2-contracts/check.mjs
```

Checks performed: (a) every local/cloud message name in this doc matches `shared/dist` runtime exports; (b) every request-schema name in §3.2 is exported by `shared` and appears in this doc; (c) every endpoint path in this doc is traceable to TECHNICAL_DESIGN §5.2 or an accepted W3/W5 addition (DEC-019, C-21/C-23/C-25), and no endpoint is invented; (d) all 9 Mongo collection names from TECHNICAL_DESIGN §4 appear here; (e) all 13 error codes and their HTTP statuses appear here; (f) INV-1…INV-6 are documented and the cloud→agent whitelist is exactly `[scheduleDue, revoked]`; (g) all fenced `json` examples parse as valid JSON; (h) envelope version is `v: 1` / protocol `v1`; (i) DEC-014 two-stage pairing digest is documented; (j) DEC-015 close codes (`1009` oversized frame / `1008` protocol violation) are documented; (k) all role sign-offs plus the A2 W4/W5 review line are ACCEPTED/SIGNED; (l) C-12 pending enroll-poll semantics are documented; (m) C-13 local `auth` error mapping is documented (W3 control handlers shipped); (n) DEC-016 `node:crypto` EdDSA implementation note is documented; (o) C-05 `authError` vocabulary agrees with C-13; (p) A8 sign-off is recorded with evidence; (q) cloud channel documents all 6 messages incl. `scheduleRunCancelled` as AGENT_TO_CLOUD; (r) `session.started.scheduleRunId` is documented (DEC-021/C-19); (s) C-14…C-26 are documented; (t) the W4/W5 A2-review lines are present; (u) `GET /users/me`, `unpair-all`, `unreadCount`, insights `weekly` and health `/health/db` are documented; (v) admin deltas C-25 (aliases, filters, self-demotion 409, agent-link https allowlist) are documented; (w) per-resource list orders are documented (§1.6) and the stale W2 control-scope sentence is gone; (x) **C-26** (DEC-025 single-use attestation nonce cache, `409 CONFLICT` on replay) is documented in §3.1/§3.2/§12 and matches the shipped replay cache + its 409 regression tests. Separate scripts prove the Markdown still parses (`/tmp/a2-contracts/md-check.mjs`: balanced fences, constant table column counts with `\|` escapes honoured, required sections, single H1, balanced inline code) and that the JSON examples are valid (`/tmp/a2-contracts/json-check.mjs`: 48/48).

> The `/tmp` scripts are not committed; they were recreated for this pass from their documented behaviour and assert against `shared/dist`, `TECHNICAL_DESIGN.md`, `docs/DECISIONS.md` and the shipped server sources.

Script output (pasted from the actual run, 2026-11-11 — W7 tree, C-26 folded):

```
$ node /tmp/a2-contracts/check.mjs
[PASS] shared module loads from shared/dist/index.js — 122 exports, PROTOCOL_VERSION=1
[PASS] local messages documented (§4.5) — 16/16 documented, missing=[]
[PASS] local message directions match LOCAL_MESSAGE_DIRECTIONS — 16/16 exact
[PASS] cloud messages documented (§5.3) — 6/6 documented, missing=[]
[PASS] cloud directions match CLOUD_MESSAGE_DIRECTIONS — 6/6 exact
[PASS] INV-2: cloud→agent set is exactly [revoked, scheduleDue] — cloud→agent=[revoked,scheduleDue]
[PASS] DEC-021 new message scheduleRunCancelled is AGENT_TO_CLOUD (cloud channel 6 = 4 up / 2 down) — types=6, up=4, down=[revoked,scheduleDue]
[PASS] session.started.scheduleRunId is optional in shared and documented (DEC-021/C-19) — schemaHasField=true, docMentionsDEC-021=true
[PASS] request schemas exported by shared and named in doc — 23/23 ok, notExported=[], notInDoc=[]
[PASS] endpoint table matches the frozen 41-operation set — 46/46 documented, missing=[], invented=[]
[PASS] every documented path is traceable to TECHNICAL_DESIGN §5.2, DEC-019 or W5 C-21/C-23/C-25 — 46/46 traceable, adrMissing=[], w5RefMissing=[], unknown=[]
[PASS] Mongo collections 9/9 documented and present in TECHNICAL_DESIGN §4 — 9/9 ok, missing=[]
[PASS] error codes 13/13 with matching HTTP status — 13/13 present, status mismatches=[]
[PASS] invariants INV-1…INV-6 documented — 6/6 present, missing=[]
[PASS] envelope v:1 and PROTOCOL_VERSION=1 referenced — PROTOCOL_VERSION=1, envelope example present
[PASS] fenced JSON examples parse as valid JSON — 48/48 valid (≥20 required)
[PASS] DEC-003 pairing-code rule documented + contract test present — doc §4.8 + shared/src/protocol.test.ts
[PASS] DEC-013: full base URL, EdDSA attestation, seed identities documented — VITE_API_BASE_URL + AGENT_API_BASE_URL + EdDSA + admin@demo.com + Kabir@123
[PASS] governance: requested-changes table, change process, 5 ACCEPTED sign-offs — 5 ACCEPTED, 0 PENDING sign-off rows
[PASS] DEC-014 two-stage pairing digest documented — SHA-256(domain|code) -> HMAC(PAIR_PEPPER, codeHmac), TTL 10 min, <=5 attempts, single use
[PASS] DEC-015 close codes documented (1009 oversized frame / 1008 protocol violation) — both treated as a disconnect
[PASS] C-12 pending enroll-poll semantics documented (§3.1 #38, §3.2, §5.1) — 404 pending/unpaired + bad secret, 410 consumed; agent retries 404/202/204/200-without-token
[PASS] C-13 local auth error mapping + W3 control-message scope documented (§4.3) — wrong sub -> FORBIDDEN; others -> UNAUTHENTICATED; control msgs routed to W3 handlers
[PASS] DEC-016 node:crypto EdDSA implementation note documented (§1.11/§4.4/§5.2/§6.1/§12) — EdDSA/Ed25519 via node:crypto; jsonwebtoken only HS256 user tokens
[PASS] C-05 authError vocabulary agrees with C-13 (§4.3/§4.5/§12) — wrong sub -> FORBIDDEN; everything else -> UNAUTHENTICATED; NOT_PAIRED only focusRejected
[PASS] A8 sign-off recorded with evidence (93/93 checks, pairing E2E, C-12/C-13) — all five original §10 rows ACCEPTED
[PASS] contract decisions C-14…C-26 documented in §12 — 13/13 present, missing=[]
[PASS] W4 additions recorded as A2-reviewed (§10/§6.2) — §10 + §6.2 present
[PASS] schedule-run lifecycle C-19 documented (STARTED confirm/cancel/offline MISSED/stale 2 min) — dispatch→confirm→CANCELLED_BY_USER | offline MISSED | stale 2 min MISSED
[PASS] W5 additions C-21…C-24 documented (users/me, unreadCount, unpair-all, insights weekly + analytics choices) — endpoint rows #44/#45 + C-21…C-24 rows + §3.3 shapes
[PASS] C-25 admin/health deltas documented (aliases, filters, self-demotion 409, https host allowlist, /health/db) — stats aliases + filters + CONFLICT + allowlist + readiness probe
[PASS] per-resource list orders documented in §1.6 (C-18/C-25) — schedules/notifications/presets/agent-links
[PASS] control-message section updated to shipped W3 behaviour (no stale W2 scope) — §4.3 + C-13 agree
[PASS] §8 requested-changes records the real shipped-code drift (4 accepted rows) — health probes + admin API + list ordering + C-26 (4 rows)
[PASS] §10 A2 W4/W5 contract-review sign-off recorded — SIGNED with evidence
[PASS] C-26 attestation nonce replay cache documented (DEC-025) + shipped evidence — §12 C-26 row + §3.1 #11 CONFLICT + attestation.service.ts replay cache + 409 test
RESULT: 36/36 checks PASS
$ echo $?
0
```

```
$ node /tmp/a2-contracts/md-check.mjs
[PASS] code fences are balanced — 104 fence markers (52 blocks)
[PASS] every table has a constant column count — 22 tables
[PASS] all 14 required sections present (§0–§13) — missing=[]
[PASS] single H1 and no duplicated headings — H1=1, duplicated=[]
[PASS] inline code backticks are balanced per line — odd-count lines=[]
[PASS] every table has a separator row under the header — 22 tables checked
RESULT: 6/6 markdown checks PASS
$ node /tmp/a2-contracts/json-check.mjs
[PASS] all 48 fenced JSON examples parse
RESULT: 48/48 JSON examples valid
```

> The script prints the same lines when re-run; if it fails after a contract change, **do not commit the change** until §9 is followed.

---

## 12. Clarifications and contract decisions (documented, no silent changes)

These points are under-specified in TECHNICAL_DESIGN; the choice below is now part of `contracts-v1` plus the W2 amendments DEC-014/DEC-015/DEC-016, the W3/W4 additions DEC-017/DEC-019/DEC-021, the W5 additions C-21…C-25 (W5 gate DEC-024), the W6 security addition C-26 (W6 gate DEC-025) and the admin deltas from the W6 shipped-code review. Items marked **ADR** need an ADR before implementation reaches them.

| # | Topic | Decision / issue | Owner | Needs ADR |
|---|---|---|---|---|
| C-01 | **Pairing digest derivation** | **RESOLVED by DEC-014** (two-stage digest, implemented in W2): the Focus Agent computes `codeHmac = SHA-256("focus-mode-pair-v1\|" + code)` (64-char lowercase hex) and posts it to `/agent/register`; the server stores `pairTokenHash = HMAC-SHA256(PAIR_PEPPER, codeHmac)`; `/devices/pair` recomputes the same chain from the user-typed code and matches the pending device; TTL 10 min, ≤5 failed guesses then invalidation, single use; `/agent/enroll/poll` returns the device token exactly once. The plaintext code never crosses the local channel or the wire. | A5/A7 (decided A0) | no — **DEC-014** |
| C-02 | Local `sessionId` format | Frozen as a **UUID equal to the dashboard/agent `clientSessionId`** (correlation id). The Mongo session `_id` never crosses the local channel. | A2 | no |
| C-03 | Envelope on cloud messages | TECHNICAL_DESIGN §6.2 mandates `{v:1,id}` for local messages only; cloud messages use the **same envelope** for uniform validation/logging. | A2 | no |
| C-04 | REST response schemas | **DEFERRED to `contracts-v1.1` per DEC-015 (post-W2).** Request bodies are zod schemas in `shared`; response bodies are documented here and hand-typed in `client/src/api/types.ts` for W1. Not a release blocker. | A2/A8 | deferred — DEC-015 |
| C-05 | `authError.code` | Uses the full 13-code vocabulary (TECHNICAL_DESIGN only says “code”). The concrete mapping is **C-13** (§4.3, §4.5, §12): a correctly signed attestation whose `sub` is another account → `FORBIDDEN`; every other `auth` failure (malformed, bad alg/signature, expired/over-long TTL, not-yet-valid, wrong `aud`, nonce mismatch/replay, unknown/unusable key, unpaired) → `UNAUTHENTICATED`. `NOT_PAIRED` is a `focusRejected` code (§4.6) and is **never** emitted on `authError`; `INTERNAL` is not used on this frame in the shipped implementation. | A7 | no (agrees with C-13) |
| C-06 | `deviceRegister.name` | Required (TECHNICAL_DESIGN lists `name` in the register fields); the agent sends the machine hostname. | A7 | no |
| C-07 | `revoked` payload | Frozen empty; if a reason is ever added it is a contract change (§9). | A2 | no |
| C-08 | `capabilities.reasons` cap | Max 10 strings × 200 chars (display-only, UX_SPEC help text). | A2 | no |
| C-09 | Attestation algorithm | **EdDSA (Ed25519)** per DEC-013, 60 s TTL, `nonce`+`aud(deviceId)`+`sub(userId)` bound; RS256 only via amendment ADR. **Implementation (DEC-016):** JWT signed/verified with `node:crypto` (RFC 8037); `jsonwebtoken@9.0.3` cannot do EdDSA and is used only for the HS256 user access token. | A5 | no (DEC-013/DEC-016) |
| C-10 | MongoDB Memory Server dir | `MONGOMS_DOWNLOAD_DIR=<repo>/node_modules/.cache/mongodb-memory-server` on this dev machine (KI-006) — dev/test setup detail, **not** a wire-contract change. | A5/A9 | no |
| C-11 | Local-channel close codes | An oversized frame (>16 KB, `ws` `maxPayload`) is closed by the `ws` library with **`1009`** (message too big); explicit protocol/policy violations use **`1008`**. The dashboard treats **both** as a disconnect (fail closed, reset handshake, reconnect with backoff). Documentation correction only — no behaviour change (DEC-015). | A7/A2 | no — DEC-015 |
| C-12 | Pending enroll-poll status | **RESOLVED (documentation, W2).** `POST /agent/enroll/poll` returns `404 NOT_FOUND` while the device is registered but not yet owned/paired (`ownerId` null) **and** for a wrong/unknown `enrollSecret` (indistinguishable, no enumeration); `200` + token once paired with a matching secret; `410 PAIRING_EXPIRED` after the token was issued once (enrollment consumed). The Focus Agent treats `404`/`202`/`204`/`200`-without-token as pending and retries with backoff until the 10-min code TTL; `400/401/403/409/410` are terminal. Documented so a future server change cannot silently break pairing (§3.1 #38, §3.2, §5.1 step 5). Wording confirmed correct against shipped code by A0/A8 (2026-11-10). | A5/A7 | no — documentation |
| C-13 | Local `auth` error mapping | **RESOLVED (documentation, W2; W3 shipped).** A correctly signed attestation whose `sub` is another account → `authError{code:'FORBIDDEN'}`; every other failure (malformed, bad alg/signature, expired/over-long TTL, not-yet-valid, wrong `aud`, nonce mismatch/replay, unknown/unusable key, unpaired) → `authError{code:'UNAUTHENTICATED'}`. Pre-auth control frames → `focusRejected{code:'UNAUTHENTICATED'}` + close `1008`. Authenticated control messages are routed to the real W3 handlers (§4.3); `focusRejected{INVALID}` is only the defensive fallback when handlers are absent/unprocessable. | A7 | no — documentation |
| C-14 | Pairing attempt latch scope | **ACCEPTED — DEC-017.** SEC-5's "≤5 attempts per code" is implemented as a latch of **5 failed guesses per authenticated user** within the 10-min code TTL (the server looks pending devices up by peppered digest, so a wrong guess cannot be attributed to one pending code): attempts 1–5 → `400 INVALID_PAIRING_CODE`, 6th+ → `410 PAIRING_EXPIRED` for that user/window; correct codes from other users are unaffected. Residual risk (many accounts) accepted and tracked for W6 `SECURITY_REVIEW.md`; strict per-code semantics would need a coarse code-prefix bucket counter (documented, not implemented). | A5/A9 | no — DEC-017 |
| C-15 | `GET /sessions/active` | **ACCEPTED — DEC-019.** USER-scoped helper returning `{session: PublicSession\|null}` for the caller's current `ACTIVE` session (dashboard refresh after reload / local-link reconnect). Not in the original 41-operation TECHNICAL_DESIGN §5.2 table; uses only frozen response shapes (§3.1 #42). | A5/A4 | no — DEC-019 |
| C-16 | `POST /allowlist/preset/:id` | **ACCEPTED — DEC-019.** Applies an admin preset to `userApps` with `?mode=merge\|replace` (default `merge`, strict server-validated enum); preset entries that are protected are filtered out and `protectedApps` is never modified (**INV-3**); `VALIDATION_ERROR` if the merge would exceed 50 user apps, `NOT_FOUND` for unknown preset (§3.1 #43). | A5/A4 | no — DEC-019 |
| C-17 | Session list filters | **ACCEPTED — DEC-019.** `GET /sessions` filters stay exactly `page,limit,sort,search,from,to,status,source`; there is **no `deviceId` filter** (adding one would need a shared-schema change and no AC requires it). Clients must not send it. | A2/A4 | no — DEC-019 |
| C-18 | Schedule ordering + session replay | **ACCEPTED — DEC-019.** `GET /schedules` is ordered `startTime asc, _id asc` (per-resource sort, not the generic `createdAt desc`). Replayed `POST /sessions` with the same `clientSessionId` and body returns **200** with the original session; the first create is **201**. Clients treat both as success. | A5/A4 | no — DEC-019 |
| C-19 | Schedule-run lifecycle | **ACCEPTED — DEC-021 (ADR text pending in DECISIONS.md — A0).** Dispatch: server creates `scheduleRuns(STARTED)` and sends `scheduleDue`. Confirm: agent `session.started` with optional **`scheduleRunId`** links the session to the run (idempotent; same user/schedule/device). Cancel: agent sends new agent→cloud **`scheduleRunCancelled {runId, at}`** for a cancelled heads-up → run `CANCELLED_BY_USER`, no session. Offline at due time → `MISSED` + notification. Stale `STARTED` with no confirming `session.started` within **2 min** of `firedAt` → reaped to `MISSED` + notification. Cloud→agent whitelist unchanged (INV-2). | A5/A7 | yes — DEC-021 |
| C-20 | `GET /agent/allowlist` | **ACCEPTED for W4 (verified shipped in W6).** Agent-facing, `Authorization: Bearer <deviceToken>` (not a user JWT); returns `{protectedApps, userApps, version}` so a scheduled start can use the current allow-list and detect version drift. Already present in the frozen endpoint table (#39) — this records the response shape/auth. | A5/A7 | no |
| C-21 | `GET /users/me` | **ACCEPTED (W5, verified shipped).** Authenticated (`auth` label — USER and ADMIN) alias of `/auth/me` returning the fresh public-user shape; used by settings/refresh flows. Additive, no schema change. | A4/A5 | no |
| C-22 | Notifications `unreadCount` | **ACCEPTED (W5, verified shipped).** `GET /notifications` keeps the standard paginated envelope and adds `unreadCount` counted over ALL the caller's notifications (not the page); newest first (`createdAt desc, _id desc`); query remains `page`/`limit` only. `PATCH /notifications/:id/read` stays idempotent (first `readAt` wins). | A5/A4 | no |
| C-23 | `POST /devices/unpair-all` | **ACCEPTED (W5, verified shipped).** USER-scoped, no body, 200 `{unpaired:number}`. For each device the `revoked` frame is pushed first (agent restores + IDLE, INV-5), then the row/token hash is deleted; offline devices are still revoked; zero devices → `{unpaired:0}` (FR-029). | A5/A4 | no |
| C-24 | Insights `weekly` + analytics choices | **ACCEPTED (W5, verified shipped).** Additive optional `weekly:[{weekStart, minutes}]` present only for `30d`/`90d` (Monday-start `YYYY-MM-DD`). Documented choices: `daily` is always the last 7 local days regardless of range; minutes are COMPLETED-only (ACTIVE/CANCELLED excluded — FR-028); completionRate = COMPLETED÷(COMPLETED+CANCELLED) rounded 3dp, 0 when none; streaks are all-time COMPLETED days with ≥10 min anchored today/yesterday; bestHours = top-3 local hours in the range; all bucketing uses the user's IANA timezone via `Intl` (DST-correct). | A5/A4 | no |
| C-25 | Admin/health shipped deltas | **ACCEPTED (shipped-code review, W6 — documented, no wire change).** (1) `GET /admin/stats` = 7 canonical keys + four additive aliases `{totalUsers,totalSessions,totalFocusMinutes,devicesConnected}`; `connectedDevices` counts `CONNECTED` or `FOCUSING`; `focusMinutes` = Σ `actualMinutes` over all sessions rounded 0.1. (2) `GET /admin/users` adds strict `role`/`isActive` filters (server-side extension of the frozen schema). (3) `PATCH /admin/users/:id` self-deactivation **and** self-demotion → `409 CONFLICT`. (4) Agent-link create/update URLs must be absolute https on `github.com`/`objects.githubusercontent.com`, no credentials (`400 VALIDATION_ERROR`, `details[{path:'url'}]`). (5) `GET /health/db` readiness probe (503 `INTERNAL` while mongoose disconnected; `/health` is also aliased at the process root). (6) Per-resource list orders fixed in §1.6. | A2/A5 | no — documented |
| C-26 | Attestation nonce single use (server side) | **ACCEPTED — DEC-025** (W6 security fix `439792b`; re-verified on the shipped W7 tree). `POST /devices/:id/attest` keeps a **server-side replay cache keyed `(userId, deviceId, nonce)`**: the **first** use inside the 60 s attestation TTL signs and returns `200` with `{attestation, expiresAt, algorithm:"EdDSA"}`; replaying the same tuple while the entry is live answers **`409 CONFLICT`** in the standard error envelope (`{success:false,error:{code:"CONFLICT",message:"This attestation nonce was already used."}}`) and **no** attestation. A different nonce, the same nonce for another `(userId, deviceId)`, and the same tuple **after** the 60 s TTL all still succeed. The cache holds expiry timestamps only (never the token), prunes expired entries lazily on each call and is **capped at 5 000 live keys** (oldest quarter evicted under a flood) so a hostile client cannot grow memory without bound. **Defence-in-depth, not the primary gate:** the agent's `challenge` nonce stays single-use and bound by §4.4/C-13 (a replayed nonce there → `authError{code:'UNAUTHENTICATED'}`), the 30/min/user limiter (§1.9) still applies, and the cache is **process-local** — correct for the single-instance API in TECHNICAL_DESIGN §8; a future multi-instance deployment would need a shared store (documented limit, not a wire change). **No schema change:** `attestRequestSchema` is unchanged and no new endpoint/field/message was added — only a new error status on an existing route (§3.1 #11, §3.2 bullet). | A5/A2 | no — DEC-025 |

---

## 13. Handoff notes

- Files delivered by T-004/T-005 (A2): `shared/src/{protocol,errors,protected,types,index}.ts`, `shared/src/schemas/{common,app,auth,user,device,allowlist,schedule,session,insights,admin,index}.ts`, colocated tests, `shared/tsconfig.build.json`, this document.
- Delivered in W0 (branch `feat/a2-contracts`): `feat(shared): freeze protocol, schemas, errors and protected set`; `docs(contracts): add frozen REST, local WS and cloud WS integration contracts`.
- W2 documentation pass (branch `feat/a2-contracts-w2`): `docs(contracts): record DEC-013/014 conventions and W2 sign-offs` — DEC-013 §1.11/§3/§6, DEC-014 pairing digest §2/§12, `1009`/`1008` close codes §4.2/§4.7/§12, W1 sign-offs §10.
- W2 documentation pass b (branch `feat/a2-contracts-w2b`, this file only): `docs(contracts): document pending enroll-poll, auth errors and node:crypto EdDSA` — C-12 pending enroll-poll (§3.1 #38, §3.2, §5.1), C-13 auth/authError mapping + current W2 scope (§4.3, §12), DEC-016 implementation note (§1.11, §4.4, §5.2, §6.1, §12 C-09), W2 merged-status line (§0, §10), delta notes C-14. No code, schema or wire changes.
- Post-W2 documentation pass c (branch `feat/a2-contracts-c05`, this file only): `docs(contracts): fix C-05 auth error vocabulary and record A8 sign-off` — C-05 rewritten to reference C-13 (§4.3/§4.5/§12 agree, `NOT_PAIRED` is `focusRejected` only), A8 sign-off recorded in §10 (all five rows ACCEPTED), header/§13 status updated. No code, schema or wire changes.
- W4 contract pass (branch `feat/a2-w4-contracts`): `feat(shared): add schedule-run lifecycle message and document W3/W4 contracts` — `shared/src/protocol.ts` adds optional `session.started.scheduleRunId` + new agent→cloud `scheduleRunCancelled`; this doc records C-14…C-20 (§1.6, §3.1, §3.2, §4.5, §5.3, §5.4, §5.5, §6.2, §10, §12). No other package touched.
- W6 contract pass (branch `feat/a2-w6-contracts`): `docs(contracts): fold in W5 contracts and review shipped endpoints` — C-21…C-25 folded in and verified against shipped code; §8 records three accepted contract-surface deltas (health probes, admin API, list ordering); §10 adds the A2 W4/W5 review line; endpoint table 43 → 46; §11 counts updated (46 endpoints, 48 JSON examples). No source/shared edits.
- W7 contract pass (branch `feat/a2-w9-contracts`, this file only): `docs(contracts): fold in C-26 and sign off the W7 contract review` — **C-26** (server-side single-use attestation nonce cache, DEC-025) added to §3.1 #11 (`409 CONFLICT`) + a route note, to §3.2 as a C-26 bullet and to §12 as its own row; §10 gains the **W7 contract review — SIGNED** row with the W7 gate evidence; §11 gains check (x) and the re-run output (36/36 + 48/48 JSON + 6/6 markdown); header/§1.7 counters refreshed (W1–W7 merged, 6 cloud messages); §6.2 records the W7 no-wire-change re-check. **No source, shared or wire change.**
- Open: C-04 typed response schemas in `contracts-v1.1` (DEC-015); F-102…F-113 UX polish (A4, W6); W6 security/release gates (A9/A10).
