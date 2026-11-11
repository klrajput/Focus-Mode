# QA_NOTES.md — W6 verification measurements (owner A8)

> Purpose: record the **measured** quality evidence for the W6 gate — NFR-011 latency, the built
> client bundle, and unit-test coverage per workspace — with the exact commands and honest limits.
> This is not a release certificate: the QA report (`docs/QA_REPORT.md`, A9) and the manual Phase-8
> checklist remain the release record.
>
> Environment: macOS 15.7.7 arm64 · Node 26.11.1 · Playwright 1.65.0 (Chromium 158) ·
> Vitest 5.1.0 + `@vitest/coverage-v8` 5.1.0. E2E API = real Express app + in-memory MongoDB seeded
> with the DEC-013 demo data, served on loopback with the E2E rate-limit knobs. Measurements taken
> 2026-11-10 ~23:36 IST on this dev machine — **loopback, not production hardware or network**.

## 1. NFR-011 — API latency

REQUIREMENTS §5 NFR-011 (REC): **API p95 ≤ 300 ms on seed data** (plus focus-apply ≤ 3 s,
status-propagation ≤ 1 s, and agent idle CPU/RAM limits, covered separately below).

Method (reproducible spec: `e2e/perf.spec.ts`, `test.slow()`): after one warm-up request, **200
sequential** requests per endpoint through Playwright's `APIRequestContext` against the seeded E2E
API; nearest-rank percentiles from real wall-clock timings.

Command:

```bash
PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test e2e/perf.spec.ts --reporter=list
```

| endpoint | p50 (ms) | p95 (ms) | max (ms) | n |
|---|---|---|---|---|
| GET /health (public) | 0.46 | 1.04 | 3.20 | 200 |
| GET /devices | 1.02 | 1.66 | 6.76 | 200 |
| GET /sessions?limit=20 | 0.99 | 2.30 | 3.39 | 200 |
| GET /insights?range=7d | 5.27 | 7.22 | 82.37 | 200 |
| GET /notifications?limit=20 | 0.83 | 1.29 | 6.17 | 200 |
| GET /allowlist | 0.86 | 1.00 | 1.58 | 200 |
| GET /schedules | 0.77 | 0.97 | 1.46 | 200 |
| GET /agent-links (public) | 0.56 | 0.65 | 1.08 | 200 |
| GET /admin/users (admin) | 0.78 | 1.13 | 2.60 | 200 |
| GET /admin/stats (admin) | 1.00 | 1.51 | 30.51 | 200 |

**Verdict: PASS.** Worst p95 = **7.22 ms** (`GET /insights?range=7d`, the only real aggregation),
i.e. ~41× inside the 300 ms target; the spec asserts `worst.p95 <= 300` on every run so a
regression fails the suite. Caveats: loopback + in-memory MongoDB, single client, no TLS; production
hosting (Render/Railway + Atlas) will be slower — treat these numbers as a *floor* and re-measure on
the deployed API before claiming the target publicly.

**NFR-011 parts not measured here (honest):**
- *focus applied ≤ 3 s / status propagation ≤ 1 s* — covered **functionally** by the E2E flows
  (consent → `/sessions` ACTIVE; badge flips to Connected live after pairing; state resync after an
  agent crash) but not instrumented as a p95 metric. W7 can add timing assertions to
  `e2e/focus.spec.ts` if the viva needs exact numbers.
- *agent idle CPU < 2 %, RAM < 200 MB* — an OS-level measurement; **NEEDS-HUMAN** on the Phase-8
  checklist (macOS local + Windows/Linux), out of scope for the Playwright suite.

## 2. Client bundle (production build)

Command: `npm run build -w @focus-mode/client` (Vite 8 production build; source maps excluded from
the shipped-size numbers below — they are build artefacts, not served assets).

| asset | raw | gzip |
|---|---|---|
| `index-*.js` (single chunk) | 987.8 KiB | 284.8 KiB |
| `index-*.css` | 31.0 KiB | 6.8 KiB |
| **total (2 files)** | **1018.8 KiB** | **291.6 KiB** |

**Observation (no NFR target exists for bundle size):** Vite warns that the JS bundle exceeds the
500 kB minified chunk threshold — the dashboard ships Recharts, `motion` and the full router in one
chunk. This is acceptable for the exam demo but is a W7 improvement candidate (route-level
`React.lazy`/code-splitting for `/insights` and `/admin`, and dropping unused icon imports). Sources
are unminified in dev; these are minified+gzip production numbers.

## 3. Unit-test coverage (`npx vitest run --coverage`, per workspace)

Command (from each workspace directory): `npx vitest run --coverage` — v8 provider, defaults (no
thresholds configured, so this is measurement rather than a gate).

| workspace | test files | tests (all pass) | % stmts | % branch | % funcs | % lines |
|---|---|---|---|---|---|---|
| `shared` | 8 | 175 | 100.00 | 95.45 | 100.00 | 100.00 |
| `server` | 20 | 302 | 87.64 | 75.68 | 93.10 | 89.28 |
| `client` | 25 | 156 | 79.24 | 73.13 | 80.17 | 81.59 |
| `agent` | 36 | 513 | 85.91 | 77.33 | 85.71 | 88.63 |
| **total** | **89** | **1146** | — | — | — | — |

Coverage target from TECHNICAL_DESIGN §14 is **80 % lines on `shared`, `server/services`,
`agent/focus`** (excluding drivers' OS calls): `shared` 100 %, `server/services` 91.87 %,
`agent/focus` 90.88 % — **PASS** on all three. (This checkout's client run counts 156 tests; A0's
later note mentions 171 client tests including the axe/accessibility unit file, which was not on
this checkout at measurement time.)

Weakest files (lines %) — gaps for W7 owners:

| workspace | file | % lines | gap note |
|---|---|---|---|
| `shared` | `src/protected.ts` | 100 (92.85 % branch, line 211) | branch edge only |
| `server` | `src/utils/jwt-eddsa.ts` | **29.72** | EdDSA verify helpers exercised through integration tests, not unit-tested directly — A5/T-043 |
| `server` | `src/utils/mongo-errors.ts` | 53.84 | duplicate-key/ CastError branches — A5 |
| `server` | `src/realtime/agentHub.ts` | 83.14 | reconnect/timeout branches — A5/A7 |
| `client` | `src/pages/not-found.tsx`, `src/pages/signup.tsx`, `src/hooks/query-client.ts` | **0** | imported only through routes/e2e; add small component tests — A4 |
| `client` | `src/focus/session-id.ts` | 20 | `crypto.randomUUID` fallback branches — A4 |
| `client` | `src/pages/login.tsx` | 58.33 | rate-limit/banner branches — A4 |
| `client` | `src/pages/settings.tsx` | 74.35 | unpair-all error paths — A4 |
| `agent` | `src/focus/drivers/unavailable.ts` | 40 | unsupported-OS path — A7 |
| `agent` | `src/focus/drivers/win32.ts` | 56.77 | Windows-only branches (CI covers) — A7 |
| `agent` | `src/focus/drivers/exec.ts` | 57.69 | child-process helper — A7 |

No tests were added in this task beyond E2E scope (per task rules); the gaps above are handed to the
W7 owners.

## 4. Playwright E2E suite (this checkout)

Command: `PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test --reporter=list`

Specs: `admin`, `api-sessions`, `focus`, `insights`, `notifications`, `pairing`, `perf`,
`reconnect`, `schedule` (real scheduler + missed run), `security`, `session-reporting`, `settings`,
`smoke`, `viewport` (NFR-006 ×3 viewports). See the W6 gate report for the exact pass/skip line; the
suite is the executable proof behind the numbers in §1 and the live report is in
`docs/AGENT_STATUS.md`.

## 5. Honest limits / follow-ups

- All E2E runs use the **FakeDriver** Focus Agent and in-memory MongoDB — real OS window management
  and native dialogs stay **NEEDS-HUMAN** (KI-005/KI-013).
- The `reconnect` spec documents the sandbox limitation that `safeStorage` is unavailable, so the
  relaunched agent re-pairs (token memory-only); with a keychain the same path skips re-pairing
  (**NEEDS-HUMAN** to verify on a normal user account).
- **No real-browser axe spec was added by A8**: client axe unit tests / the pinned
  `@axe-core/playwright` adapter are A4/A9's (W7 / T-084); adding one here without fixing findings
  would either block the gate or be a fake pass.
- API latency numbers are loopback-only (see §1 caveat); bundle has no requirement threshold (§2).
