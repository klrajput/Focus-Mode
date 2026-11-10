# INTEGRATION_CONTRACTS.md — frozen contracts for Focus Mode (contracts-v1)

> **Owner:** A2 (Software Architect) · **Task:** T-005 · **Status:** **FROZEN (contracts-v1)** — protocol `v1`; W1 implementation accepted, W2 merged to main (CI green), W2 decisions recorded (DEC-013/014/015/016). A8 integration sign-off remains **PENDING** (§10).
> **Machine-readable source of truth:** `shared/src/` (zod schemas + inferred types). This document is the human-readable contract and is kept consistent with it by `/tmp/a2-contracts/check.mjs` (§11).
> **Sources:** `TECHNICAL_DESIGN.md` §4–§6, §7.2, §9–§10, §17 · `REQUIREMENTS.md` FR/NFR/SEC · `docs/DECISIONS.md` DEC-002/003/005/006/009/012/**013/014/015/016** · `docs/UX_SPEC.md` §1/§6 (tokens + user-facing copy only).
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
| `409 Conflict` | `CONFLICT`, `ALREADY_FOCUSING`, `NO_DEVICE_CONNECTED` | duplicate email, second ACTIVE session per device, no connected device to focus, duplicate `clientSessionId` with different body |
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
- `sort` accepts a field name or the same name prefixed with `-` for descending. Whitelists live in shared: `sessionsSortSchema` (`startedAt`, `endedAt`, `plannedMinutes`, `actualMinutes`), `devicesSortSchema` (`name`, `lastSeenAt`, `createdAt`), `adminUsersSortSchema` (`name`, `email`, `createdAt`, `lastLoginAt`). Lists without a shared sort schema (schedules, notifications, presets, agent links) accept `page`/`limit` only and use a fixed deterministic sort (`createdAt` desc).
- Errors: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`.

### 1.7 Shared module surface (what each package may import)

| Module | Exports used by | Contents |
|---|---|---|
| `shared/src/protocol.ts` | client, agent, server (`realtime`), tests | 16 local messages, 5 cloud messages, envelope, unions, type guards, direction tables, `PROTOCOL_VERSION = 1`, `UNAUTHENTICATED_INBOUND_TYPES` |
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
| 1 | GET | `/health` | `public` | — | `{"status":"ok","db":"ok","uptimeSec":42}` (200) | — |
| 2 | POST | `/auth/register` | `public` | `registerSchema` | auth result (201) | `VALIDATION_ERROR`, `CONFLICT`, `RATE_LIMITED` |
| 3 | POST | `/auth/login` | `public` | `loginSchema` | auth result (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `ACCOUNT_DISABLED`, `RATE_LIMITED` |
| 4 | POST | `/auth/logout` | `auth` | — | `{"loggedOut":true}` (200) | `UNAUTHENTICATED` |
| 5 | GET | `/auth/me` | `auth` | — | public user (200) | `UNAUTHENTICATED` |
| 6 | PATCH | `/users/me` | `auth` | `profilePatchSchema` | public user (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 7 | POST | `/users/me/password` | `auth` | `changePasswordSchema` | `{"changed":true}` (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `RATE_LIMITED` |
| 8 | POST | `/devices/pair` | `USER` | `devicePairSchema` | `{"device": device}` (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `INVALID_PAIRING_CODE`, `PAIRING_EXPIRED`, `CONFLICT`, `RATE_LIMITED` |
| 9 | GET | `/devices` | `USER` | `deviceListQuerySchema` | paginated devices (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 10 | DELETE | `/devices/:id` | `USER` | — | `{"id":"<id>","revoked":true}` (200) | `UNAUTHENTICATED`, `NOT_FOUND` |
| 11 | POST | `/devices/:id/attest` | `USER` | `attestRequestSchema` | `{"attestation":"<jwt>","expiresAt":"<iso>","algorithm":"EdDSA"}` (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND`, `NO_DEVICE_CONNECTED`, `RATE_LIMITED` |
| 12 | POST | `/sessions` | `USER` | `sessionCreateSchema` | session (201) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND`, `ALREADY_FOCUSING` |
| 13 | PATCH | `/sessions/:id` | `USER` | `sessionPatchSchema` | session (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND`, `CONFLICT` |
| 14 | GET | `/sessions` | `USER` | `sessionListQuerySchema` | paginated sessions (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 15 | GET | `/allowlist` | `USER` | — | allow-list (200) | `UNAUTHENTICATED` |
| 16 | PUT | `/allowlist` | `USER` | `allowlistPutSchema` | allow-list (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `PROTECTED_ENTRY` |
| 17 | GET | `/schedules` | `USER` | — (page/limit) | paginated schedules (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 18 | POST | `/schedules` | `USER` | `scheduleCreateSchema` | schedule (201) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 19 | PATCH | `/schedules/:id` | `USER` | `scheduleUpdateSchema` | schedule (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND` |
| 20 | DELETE | `/schedules/:id` | `USER` | — | `{"id":"<id>"}` (200) | `UNAUTHENTICATED`, `NOT_FOUND` |
| 21 | GET | `/insights` | `USER` | `insightsQuerySchema` | insights (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 22 | GET | `/notifications` | `USER` | — (page/limit) | paginated notifications (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 23 | PATCH | `/notifications/:id/read` | `USER` | — | notification (200) | `UNAUTHENTICATED`, `NOT_FOUND` |
| 24 | GET | `/presets` | `USER` | — (page/limit) | paginated presets (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED` |
| 25 | GET | `/agent-links` | `public` | — (page/limit) | paginated agent links (200) | `VALIDATION_ERROR` |
| 26 | GET | `/admin/users` | `ADMIN` | `adminUserListQuerySchema` | paginated public users (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN` |
| 27 | PATCH | `/admin/users/:id` | `ADMIN` | `adminUserPatchSchema` | public user (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` |
| 28 | GET | `/admin/presets` | `ADMIN` | — (page/limit) | paginated presets (200) | `UNAUTHENTICATED`, `FORBIDDEN` |
| 29 | POST | `/admin/presets` | `ADMIN` | `presetCreateSchema` | preset (201) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `CONFLICT` |
| 30 | PATCH | `/admin/presets/:id` | `ADMIN` | `presetUpdateSchema` | preset (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` |
| 31 | DELETE | `/admin/presets/:id` | `ADMIN` | — | `{"id":"<id>"}` (200) | `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` |
| 32 | GET | `/admin/agent-links` | `ADMIN` | — (page/limit) | paginated agent links (200) | `UNAUTHENTICATED`, `FORBIDDEN` |
| 33 | POST | `/admin/agent-links` | `ADMIN` | `agentLinkCreateSchema` | agent link (201) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN` |
| 34 | PATCH | `/admin/agent-links/:id` | `ADMIN` | `agentLinkUpdateSchema` | agent link (200) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` |
| 35 | DELETE | `/admin/agent-links/:id` | `ADMIN` | — | `{"id":"<id>"}` (200) | `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` |
| 36 | GET | `/admin/stats` | `ADMIN` | — | aggregate stats (200) | `UNAUTHENTICATED`, `FORBIDDEN` |
| 37 | POST | `/agent/register` | `agent-public` | `deviceRegisterSchema` | `{"deviceId":"<id>","enrollSecret":"<secret>"}` (201) | `VALIDATION_ERROR`, `CONFLICT`, `RATE_LIMITED` |
| 38 | POST | `/agent/enroll/poll` | `agent-secret` | `enrollPollSchema` | `{"deviceToken":"<token>","userId":"<id>","allowListVersion":1}` (200; `404` while pending/unpaired or bad secret, `410` once consumed) | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND`, `PAIRING_EXPIRED` |
| 39 | GET | `/agent/allowlist` | `agent-device` | — | allow-list + `version` (200) | `UNAUTHENTICATED`, `NOT_FOUND` |
| 40 | GET | `/agent/attest-key` | `agent-public` | — | `{"publicKey":"<pem>","algorithm":"EdDSA"}` (200) | — |
| 41 | WS | `/agent-link` | `device-token (WS)` | — | cloud messages, §5 | close `4401` on bad token |

ADMIN aggregate rule [PDF §6]: `/admin/stats` returns only counts/minutes — never per-user session detail.

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
| `sessionListQuerySchema` | #14 | `page`, `limit`, `sort`, `search`, `from`, `to`, `status`, `source`; `from ≤ to` |
| `allowlistPutSchema` | #16 | `{userApps: appEntry[] (≤50, unique keys), protectedApps?: appEntry[]}` |
| `scheduleCreateSchema` | #18 | `{name, days, startTime, durationMin, enabled?=true}` |
| `scheduleUpdateSchema` | #19 | any non-empty subset of the create fields |
| `insightsQuerySchema` | #21 | `{range: "7d"\|"30d"\|"90d" (default 7d), timezone?}` |
| `adminUserListQuerySchema` | #26 | `page`, `limit`, `sort`, `search` |
| `adminUserPatchSchema` | #27 | any non-empty subset of `{name?, role?, isActive?}` |
| `presetCreateSchema` | #29 | `{name, apps: appEntry[] (1–50, unique keys)}` |
| `presetUpdateSchema` | #30 | any non-empty subset of `{name?, apps?}` |
| `agentLinkCreateSchema` | #33 | `{os, arch, label, url (absolute), version (semver)}` |
| `agentLinkUpdateSchema` | #34 | any non-empty subset of the create fields |
| `deviceRegisterSchema` | #37 | `{codeHmac, os, name, agentVersion}`; `codeHmac` = 64-char lowercase SHA-256 hex of `"focus-mode-pair-v1\|" + code` (DEC-014) |
| `enrollPollSchema` | #38 | `{deviceId, enrollSecret}` (32–128 URL-safe chars). Status semantics (C-12): `404 NOT_FOUND` while the device is registered but not yet owned/paired (`ownerId` null) **and** for a wrong/unknown `enrollSecret` (indistinguishable, no enumeration); `200` + token once paired with a matching secret; `410 PAIRING_EXPIRED` once the token has been issued (enrollment consumed). The agent treats `404`/`202`/`204`/`200`-without-token as pending → retries with backoff until the 10-min code TTL; `400/401/403/409/410` are terminal. |
| `appEntrySchema` | nested everywhere | `{key: [a-z0-9-]{2,40}, label: 2–60, win?: string[], mac?: string[], linux?: string[]}` |
| `attestRequestSchema` | #11 | `nonce` is generated by the agent and single-use |

Every schema is a strict object → unknown fields are rejected (NFR-013); validation failures return `400 VALIDATION_ERROR` with `details[]` (NFR-001).

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
| `preset` | `{id, name, apps, createdAt}` |
| `agent link` | `{id, os, arch, label, url, version, publishedAt}` |
| `insights` | `{range, timezone, totals:{focusMinutes, sessions, completed, cancelled, completionRate, currentStreak, longestStreak}, daily:[{date, minutes}], bestHours:[{hour, minutes}]}` (analytics definitions: REQUIREMENTS §6) |
| `admin stats` | `{users, activeUsers, devices, connectedDevices, sessions, activeSessions, focusMinutes}` — aggregates only |

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

`GET /insights?range=7d` response `200`:

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
      { "date": "2026-11-04", "minutes": 25 },
      { "date": "2026-11-05", "minutes": 60.5 }
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

`GET /health` response `200`:

```json
{
  "success": true,
  "data": { "status": "ok", "db": "ok", "uptimeSec": 42 }
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

**Current W2 scope (not final contract).** After a valid attestation, dashboard control messages (`enterFocus`, `exitFocus`, `listApps`) are rejected with `focusRejected{code:'INVALID'}` until W3 wires the FocusController + REC-004 native consent. This is honest fail-closed behaviour, not the final contract: §4.5 remains the frozen message contract, and W3 replaces the rejection with real handling.

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
Fields: `code: ErrorCode` (13-code vocabulary), `message: string(1–300)`. Invariant: REC-003, NFR-010. Example above.

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
Fields: `scheduleId: ObjectId`, `startsAt: iso`. Invariant: **INV-2** (a scheduled start is announced, never commanded; the user can cancel; the cloud never sends OS commands). Example:

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
| `INVALID` | malformed request (zod failure inside the agent) | log + toast |

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

### 5.3 Message catalog — cloud channel (5 messages, frozen)

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
Fields: `clientSessionId: uuid`, `startedAt: iso`, `plannedMinutes: 1–480`, `source: MANUAL|SCHEDULE`. Invariants: REC-006 idempotency, **INV-1/INV-2** (reporting, not commanding), **INV-6** (no OS detail). Example:

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

### 5.5 Scheduler semantics (TECHNICAL_DESIGN §8)

- `node-cron` minute tick; a schedule is due when the user's local day ∈ `days`, local `HH:mm === startTime` (uses the user's IANA timezone via `Intl`), and `lastRunAt` is not in the same minute (idempotent).
- Device `CONNECTED` + `PAIRED` → send `scheduleDue`; the run is recorded `STARTED` when the agent confirms (via `session.started`).
- Device offline → record `scheduleRuns(MISSED)` + create a notification; **force nothing**, never queue a command for later (INV-2/FR-012).
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

---

## 7. Error handling matrix (REST + local channel)

- REST errors: §1.4 envelope with `error.code` from the 13-code vocabulary; `details[]` only for `VALIDATION_ERROR`; no stack traces.
- Local channel: `authError.code` uses the same vocabulary; `focusRejected.code` uses the 6 local-only codes in §4.6. Neither carries a stack or OS internals.
- User-facing copy lives in `docs/UX_SPEC.md` §6 (A3 owns it); this contract only freezes codes/shapes. Dashboard maps `code → copy` once.

---

## 8. Requested changes

| # | Requested by | Date (IST) | Contract area | Proposed change | Status |
|---|---|---|---|---|---|
| — | — | — | — | *No changes requested since the `contracts-v1` freeze (2026-11-10).* | — |

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
| Integration | A8 | Contract tests, env/base-URL convention, pairing flow, cross-package consistency | **PENDING** | — | W2 integration review (T-047) still open |

A0 recorded W1 acceptance on 2026-11-10: **PRs #2/#3/#4 merged, CI green on `ubuntu-24.04` / `windows-latest` / `macos-latest`, unit/integration suites 353 tests green**. W2 (pairing + attestation + agent-link hub + agent cloud client + client AgentLink) is **merged to `main` with CI green**. A8's W2 integration review is the only open sign-off; the `contracts-v1` tag stands, and any further wire change follows §9 (`contracts-v1.1`).

---

## 11. Consistency check (doc ↔ shared ↔ TECHNICAL_DESIGN)

Run from the repo root (script in `/tmp`, not committed):

```bash
node /tmp/a2-contracts/check.mjs
```

Checks performed: (a) every local/cloud message name in this doc matches `shared/dist` runtime exports; (b) every request-schema name in §3.2 is exported by `shared` and appears in this doc; (c) every endpoint path in this doc exists in TECHNICAL_DESIGN §5.2 (normalised `:id` params) and no endpoint is invented; (d) all 9 Mongo collection names from TECHNICAL_DESIGN §4 appear here; (e) all 13 error codes and their HTTP statuses appear here; (f) INV-1…INV-6 are documented; (g) all fenced `json` examples parse as valid JSON; (h) envelope version is `v: 1` / protocol `v1`; (i) DEC-014 two-stage pairing digest is documented; (j) DEC-015 close codes (`1009` oversized frame / `1008` protocol violation) are documented; (k) sign-off table has 4 ACCEPTED + 1 PENDING; (l) C-12 pending enroll-poll semantics are documented; (m) C-13 local `auth` error mapping + current W2 control scope are documented; (n) DEC-016 `node:crypto` EdDSA implementation note is documented. Separate scripts prove the Markdown still parses (`/tmp/a2-contracts/md-check.mjs`: balanced fences, consistent tables, required sections) and that the JSON examples are valid (`/tmp/a2-contracts/json-check.mjs`: 42/42).

Script output (pasted from the actual run, 2026-11-10):

```
$ node /tmp/a2-contracts/check.mjs
[PASS] shared module loads from shared/dist/index.js — 121 exports, PROTOCOL_VERSION=1
[PASS] local messages documented (§4.5) — 16/16 documented, missing=[]
[PASS] local message directions match LOCAL_MESSAGE_DIRECTIONS — 16/16 exact
[PASS] cloud messages documented (§5.3) — 5/5 documented, missing=[]
[PASS] cloud directions match CLOUD_MESSAGE_DIRECTIONS — 5/5 exact
[PASS] INV-2: cloud→agent set is exactly [revoked, scheduleDue] — cloud→agent=[scheduleDue,revoked]
[PASS] request schemas exported by shared and named in doc — 23/23 ok, notExported=[], notInDoc=[]
[PASS] endpoint table matches the frozen 41-operation set — 41/41 documented, missing=[], invented=[]
[PASS] every documented path is traceable to TECHNICAL_DESIGN §5.2 — 41/41 traceable, unknown=[]
[PASS] Mongo collections 9/9 documented and present in TECHNICAL_DESIGN §4 — 9/9 ok, missing=[]
[PASS] error codes 13/13 with matching HTTP status — 13/13 present, status mismatches=[]
[PASS] invariants INV-1…INV-6 documented — 6/6 present, missing=[]
[PASS] envelope v:1 and PROTOCOL_VERSION=1 referenced — PROTOCOL_VERSION=1, envelope example present
[PASS] fenced JSON examples parse as valid JSON — 42/42 valid (≥20 required)
[PASS] DEC-003 pairing-code rule documented + contract test present — doc §4.8 + shared/src/protocol.test.ts
[PASS] DEC-013: full base URL, EdDSA attestation, seed identities documented — VITE_API_BASE_URL + AGENT_API_BASE_URL + EdDSA + admin@demo.com + Kabir@123
[PASS] governance: requested-changes table, change process, 4 ACCEPTED + 1 PENDING sign-off — 4 ACCEPTED, 1 PENDING sign-off rows
[PASS] DEC-014 two-stage pairing digest documented — SHA-256(domain|code) -> HMAC(PAIR_PEPPER, codeHmac), TTL 10 min, <=5 attempts, single use
[PASS] DEC-015 close codes documented (1009 oversized frame / 1008 protocol violation) — both treated as a disconnect
[PASS] C-12 pending enroll-poll semantics documented (§3.1 #38, §3.2, §5.1) — 404 pending/unpaired + bad secret, 410 consumed; agent retries 404/202/204/200-without-token
[PASS] C-13 local auth error mapping + W2 control-message scope documented (§4.3) — wrong sub -> FORBIDDEN; others -> UNAUTHENTICATED; control msgs -> INVALID until W3
[PASS] DEC-016 node:crypto EdDSA implementation note documented (§1.11/§4.4/§5.2/§6.1/§12) — EdDSA/Ed25519 via node:crypto; jsonwebtoken only HS256 user tokens
RESULT: 22/22 checks PASS
$ echo $?
0
```

> The script prints the same lines when re-run; if it fails after a contract change, **do not commit the change** until §9 is followed.

---

## 12. Clarifications and contract decisions (documented, no silent changes)

These points are under-specified in TECHNICAL_DESIGN; the choice below is now part of `contracts-v1` plus the W2 amendments DEC-014/DEC-015/DEC-016. Items marked **ADR** need an ADR before implementation reaches them.

| # | Topic | Decision / issue | Owner | Needs ADR |
|---|---|---|---|---|
| C-01 | **Pairing digest derivation** | **RESOLVED by DEC-014** (two-stage digest, implemented in W2): the Focus Agent computes `codeHmac = SHA-256("focus-mode-pair-v1\|" + code)` (64-char lowercase hex) and posts it to `/agent/register`; the server stores `pairTokenHash = HMAC-SHA256(PAIR_PEPPER, codeHmac)`; `/devices/pair` recomputes the same chain from the user-typed code and matches the pending device; TTL 10 min, ≤5 failed guesses then invalidation, single use; `/agent/enroll/poll` returns the device token exactly once. The plaintext code never crosses the local channel or the wire. | A5/A7 (decided A0) | no — **DEC-014** |
| C-02 | Local `sessionId` format | Frozen as a **UUID equal to the dashboard/agent `clientSessionId`** (correlation id). The Mongo session `_id` never crosses the local channel. | A2 | no |
| C-03 | Envelope on cloud messages | TECHNICAL_DESIGN §6.2 mandates `{v:1,id}` for local messages only; cloud messages use the **same envelope** for uniform validation/logging. | A2 | no |
| C-04 | REST response schemas | **DEFERRED to `contracts-v1.1` per DEC-015 (post-W2).** Request bodies are zod schemas in `shared`; response bodies are documented here and hand-typed in `client/src/api/types.ts` for W1. Not a release blocker. | A2/A8 | deferred — DEC-015 |
| C-05 | `authError.code` | Uses the full 13-code vocabulary (TECHNICAL_DESIGN only says “code”); the agent in practice emits `UNAUTHENTICATED`/`NOT_PAIRED`/`INTERNAL`. | A7 | no |
| C-06 | `deviceRegister.name` | Required (TECHNICAL_DESIGN lists `name` in the register fields); the agent sends the machine hostname. | A7 | no |
| C-07 | `revoked` payload | Frozen empty; if a reason is ever added it is a contract change (§9). | A2 | no |
| C-08 | `capabilities.reasons` cap | Max 10 strings × 200 chars (display-only, UX_SPEC help text). | A2 | no |
| C-09 | Attestation algorithm | **EdDSA (Ed25519)** per DEC-013, 60 s TTL, `nonce`+`aud(deviceId)`+`sub(userId)` bound; RS256 only via amendment ADR. **Implementation (DEC-016):** JWT signed/verified with `node:crypto` (RFC 8037); `jsonwebtoken@9.0.3` cannot do EdDSA and is used only for the HS256 user access token. | A5 | no (DEC-013/DEC-016) |
| C-10 | MongoDB Memory Server dir | `MONGOMS_DOWNLOAD_DIR=<repo>/node_modules/.cache/mongodb-memory-server` on this dev machine (KI-006) — dev/test setup detail, **not** a wire-contract change. | A5/A9 | no |
| C-11 | Local-channel close codes | An oversized frame (>16 KB, `ws` `maxPayload`) is closed by the `ws` library with **`1009`** (message too big); explicit protocol/policy violations use **`1008`**. The dashboard treats **both** as a disconnect (fail closed, reset handshake, reconnect with backoff). Documentation correction only — no behaviour change (DEC-015). | A7/A2 | no — DEC-015 |
| C-12 | Pending enroll-poll status | **RESOLVED (documentation, W2).** `POST /agent/enroll/poll` returns `404 NOT_FOUND` while the device is registered but not yet owned/paired (`ownerId` null) **and** for a wrong/unknown `enrollSecret` (indistinguishable, no enumeration); `200` + token once paired with a matching secret; `410 PAIRING_EXPIRED` after the token was issued once (enrollment consumed). The Focus Agent treats `404`/`202`/`204`/`200`-without-token as pending and retries with backoff until the 10-min code TTL; `400/401/403/409/410` are terminal. Documented so a future server change cannot silently break pairing (§3.1 #38, §3.2, §5.1 step 5). | A5/A7 | no — documentation |
| C-13 | Local `auth` error mapping | **RESOLVED (documentation, W2).** A correctly signed attestation whose `sub` is another account → `authError{code:'FORBIDDEN'}`; every other failure (malformed, bad alg/signature, expired/over-long TTL, not-yet-valid, wrong `aud`, nonce mismatch/replay, unknown/unusable key, unpaired) → `authError{code:'UNAUTHENTICATED'}`. Pre-auth control frames → `focusRejected{code:'UNAUTHENTICATED'}` + close `1008`. Authenticated control messages (`enterFocus`/`exitFocus`/`listApps`) currently → `focusRejected{code:'INVALID'}` until W3 wires FocusController + REC-004 consent — **current W2 scope, not final contract** (§4.3). | A7 | no — documentation |
| C-14 | Pairing attempt latch scope | **Documented W2 implementation detail (no requirement change).** SEC-5's "≤5 attempts per code" is enforced as a latch of **5 failed guesses per authenticated user** within the 10-min code TTL (the server looks pending devices up by peppered digest, so a wrong guess cannot be attributed to one pending code). The 6th user attempt → `410 PAIRING_EXPIRED` for the rest of the window; correct codes presented by other users are unaffected. Residual risk bounded by the pair/register rate limits; tracked for W6 `SECURITY_REVIEW.md`. Needs an ADR if the team wants strict per-code semantics. | A5/A9 | proposed (if strict per-code required) |

---

## 13. Handoff notes

- Files delivered by T-004/T-005 (A2): `shared/src/{protocol,errors,protected,types,index}.ts`, `shared/src/schemas/{common,app,auth,user,device,allowlist,schedule,session,insights,admin,index}.ts`, colocated tests, `shared/tsconfig.build.json`, this document.
- Delivered in W0 (branch `feat/a2-contracts`): `feat(shared): freeze protocol, schemas, errors and protected set`; `docs(contracts): add frozen REST, local WS and cloud WS integration contracts`.
- W2 documentation pass (branch `feat/a2-contracts-w2`): `docs(contracts): record DEC-013/014 conventions and W2 sign-offs` — DEC-013 §1.11/§3/§6, DEC-014 pairing digest §2/§12, `1009`/`1008` close codes §4.2/§4.7/§12, W1 sign-offs §10.
- W2 documentation pass b (branch `feat/a2-contracts-w2b`, this file only): `docs(contracts): document pending enroll-poll, auth errors and node:crypto EdDSA` — C-12 pending enroll-poll (§3.1 #38, §3.2, §5.1), C-13 auth/authError mapping + current W2 scope (§4.3, §12), DEC-016 implementation note (§1.11, §4.4, §5.2, §6.1, §12 C-09), W2 merged-status line (§0, §10), delta notes C-14. No code, schema or wire changes.
- Open: A8's W2 integration review (§10); C-04 typed response schemas in `contracts-v1.1` (DEC-015).
