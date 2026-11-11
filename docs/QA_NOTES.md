# QA_NOTES.md — W6 verification measurements (owner A8)

> Purpose: record the **measured** quality evidence for the W6 gate — NFR-011 latency, the built
> client bundle, and unit-test coverage per workspace — with the exact commands and honest limits.
> This is not a release certificate: the QA report (`docs/QA_REPORT.md`, A9) and the manual Phase-8
> checklist remain the release record.
>
> Environment: macOS 15.7.7 arm64 · Node 26.11.1 · Playwright 1.65.0 (Chromium 158) ·
> Vitest 5.1.0 + `@vitest/coverage-v8` 5.1.0. E2E API = real Express app + in-memory MongoDB seeded
> with the DEC-013 demo data, served on loopback with the E2E rate-limit knobs. Measurements re-run at the W6 gate
> 2026-11-11 ~05:30 IST on this dev machine — **loopback, not production hardware or network**.

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
| `server` | 29 | 450 | 92.96 | 85.07 | 95.30 | 94.31 |
| `client` | 36 | 251 | 85.23 | 79.09 | 85.89 | 87.45 |
| `agent` | 38 | 545 | 90.49 | 81.70 | 89.73 | 93.13 |
| **total** | **111** | **1421** | — | — | — | — |

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

## 6. W6-gate re-measurement (A0, final merged tree)

After the W6 branches merged (`439792b` + E2E fixes), A0 re-ran the same commands on `main`:

- **Unit/integration:** `175 (shared) + 345 (server) + 171 (client) + 513 (agent) = 1204 passed`, 0 failed
  (the earlier table above has been updated to these final numbers; the first draft predated the
  W6 follow-up tests).
- **Coverage:** `shared` 100.00 % lines / 95.45 % branch · `server` 89.44 % / 76.30 % · `client`
  80.70 % / 72.68 % · `agent` 88.63 % / 77.33 % (v8 provider, defaults). The TECHNICAL_DESIGN §14
  80 %-lines target is met by every package; the weakest files listed above are unchanged candidates
  for W7 (server `utils/mongo-errors.ts` is now covered by the CastError→404 tests, so its number
  should rise on the next run — re-check in W7).
- **E2E:** the W6 suite is **47 tests across 14 files** (adds `reconnect`, `viewport` ×4, `security`
  ×8, `perf`); the W6 gate run is recorded in `docs/AGENT_STATUS.md`. Two harness bugs found at the
  gate were fixed and re-verified: the reconnect spec was missing the REC-004 native-dialog stub and
  shared the demo user (DEC-017 per-user pairing latch), and the missed-run spec used a fresh user
  whose timezone default (UTC) did not match the schedule timezone it computed (Asia/Kolkata).
- **NFR-011:** unchanged from §1 (worst p95 **7.22 ms** vs the 300 ms target, loopback measurement).

## 7. E2E stability policy (learned at the W6 gate, enforced in W7)

The suite is a **verification instrument**: a flaky test is a bug, not weather. These rules are how
the 47-test gate is kept deterministic across repeated runs (two-run evidence in §7).

1. **Quiet-tree rule for gate runs.** A full-suite gate run only happens after the working tree has
   been quiet for ~60 s (no `*.ts`/`*.tsx` edits in `server/src`, `client/src`, `agent/src`,
   `shared/src`) and the last merge for the wave is in. Specs are *written* against feature branches,
   never *judged* on a half-merged tree; re-run after every merge. This is the documented answer to
   KI-012 (shared-checkout branch churn): self-gating keeps the signal honest, but the final numbers
   always come from a quiet, merged tree.
2. **Fresh fixture per behavioural spec; no shared latch.** Every pairing-heavy spec starts from a
   known-clean account: `pairAgentViaUi` revokes every existing device through the real API and
   cancels any leftover `ACTIVE` session (a crashed earlier spec must not cause
   `409 ALREADY_FOCUSING`). Long-wait/scheduler-only specs that do not need demo data (the missed-run
   test) register a **fresh user** so the demo user's device/session state cannot leak in. DEC-017's
   one-concurrent-pairing latch is per-user — isolating users removes the race entirely.
3. **One agent, one port, always released.** Agent E2E uses the fixed `AGENT_PORT=4645`, so a spec
   may never start the next agent until the previous process has released the port:
   `launchAgent()` waits for `waitForPortReleased(4645, 10s)` and every spec closes its agent in
   `finally`. A crash test (`SIGKILL`) deliberately keeps the `userData` directory alive for the
   relaunch and deletes it itself; normal `close()` owns and removes its temp profile.
4. **Real timers only where the product uses real time.** The scheduler tests compute a due time in
   the user's IANA timezone **at least 3 minutes ahead** (a 2-minute lead can race the agent's post-
   pairing cloud nudge under load), use the real cron scheduler (`test.slow()`,
   `setTimeout(240_000)`), and poll the API for truth — no fake clocks, no `page.waitForTimeout` as
   an assertion. The scheduled-session spec also **fails fast** if the dashboard↔agent local-channel
   frames were never captured/authenticated after pairing, instead of waiting out the due-time window
   and reporting a misleading "no heads-up" flake. UI interactions use auto-waiting locators/`expect.poll`.
5. **Locator rules.** Role-based nav links resolve twice because the AppShell renders the desktop
   sidebar *and* the mobile drawer in the DOM → use `.first()` for nav links (KI-014). The
   viewport-aware shell marker is `navigation[Main navigation] OR button[Open navigation]` so the
   same auth helper works at 360 px and 1440 px. Never assert on a locator that can match a hidden
   duplicate.
6. **`test.fixme` policy — self-gate or don't claim it.** A test may be skipped **only** when an
   in-product capability is genuinely absent from the checkout, and then it must (a) be driven by a
   source probe in `e2e/helpers/features.ts`, (b) carry the precise missing piece in the reason, and
   (c) auto-run the moment the feature merges. Skipping to hide a flake, a failure, or a slow test is
   forbidden; the W6 final tree runs all 47 tests with **0 skipped**.
7. **Lazy routes need content waits, not URL waits.** Since A4's route split, `/`, `/focus`,
   `/devices`, `/allowlist`, `/schedules`, `/insights`, `/settings` and `/admin` mount asynchronously
   behind the "Loading page…" fallback. A `page.goto()` + `expect(page).toHaveURL()` does NOT mean the
   page rendered: wait for the route shell (`main`), the route `<h1>`, and — for data-driven sections —
   the real content (`getByRole`/`locator.first()` auto-waits) before asserting counts. This exact
   lesson fixed the W7 `settings` download-links flake.
8. **No retries as masking.** `retries: 0` for the local gate. When a test flakes, the fixture is
   fixed (isolation, tolerance, wait strategy) and re-run twice; a second green run is the evidence,
   not a retry count. Load tolerance (parallel workers/other agents on the same machine) is handled by
   generous-but-finite waits on *observable* state, never by sleeping blindly.

## 8. Real-browser accessibility (axe) + two-run stability evidence (W7)

### 8.1 `e2e/a11y.spec.ts` — axe in Chromium at 1440×900

Command: `PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test e2e/a11y.spec.ts --reporter=list`

`@axe-core/playwright` 4.14.0, tags `wcag2a, wcag2aa, wcag21a, wcag21aa`, **colour-contrast explicitly
enabled**, 14 route audits: landing, login, signup, public 404; dashboard, focus, devices, allowlist,
schedules, insights, settings; ADMIN `/admin`, the USER `/403` redirect page, authenticated 404.
The spec waits for the route shell (`networkidle` + `main` + `<h1>`), so A4's lazy-route split does
not race it.

| view | result |
|---|---|
| public routes (landing/login/signup/404) | PASS — 0 violations (31/25/31/18 axe passes) |
| user routes (7) | PASS — 0 violations per route (37–42 passes each) |
| admin + 403 + authenticated 404 | PASS — 0 violations (48/37/18 passes) |
| **asserted gate (serious + critical)** | **0 across all 14 routes** |

Honest notes (not hidden): `results.incomplete` rows are logged as `[a11y] … INCOMPLETE` for manual
review — `aria-valid-attr-value` 1 node on shell pages, `label-content-name-mismatch` 1 node on
`/schedules`, and **`color-contrast` 12 nodes on `/insights`** (axe cannot compute contrast inside the
Recharts SVG at runtime; these are *incomplete*, not violations — a manual contrast check of the
chart palette is on the Phase-8 checklist). No moderate/minor *violations* were reported on any route.

The spec found real defects that the jsdom axe tests could not see and they were fixed before this
evidence was recorded: landing download-link accessible names (`50f8285`), Insights chart
`aria-hidden-focus` (`50f8285`), account-menu content-derived name (`7b4f684`, after an earlier
ordering attempt `8968479` still failed because axe's visible text for the avatar+name is `"KKabir"`
with no separator). KI-022 is closed by this run.

### 8.2 Two back-to-back full-suite runs (stability evidence)

Command (identical, sequential, `retries: 0`): `PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test --reporter=list`

**Run 1:** `RUN A:   50 passed (7.6m)`
**Run 2:** `RUN B:   50 passed (7.0m)`

Both runs are identical sequential invocations on the same quiet tree (`main` @593113c + A5/A7
unit-test-only edits), **retries: 0**, no manual intervention, 15 spec files / 50 tests each.

| spec | run 1 (tests / failed / wall) | run 2 (tests / failed / wall) |
|---|---|---|
| e2e/a11y.spec.ts | 3 / 0 / 19.7 s | 3 / 0 / 19.4 s |
| e2e/admin.spec.ts | 3 / 0 / 5.6 s | 3 / 0 / 5.5 s |
| e2e/api-sessions.spec.ts | 4 / 0 / 1.3 s | 4 / 0 / 1.3 s |
| e2e/focus.spec.ts | 1 / 0 / 8.2 s | 1 / 0 / 5.6 s |
| e2e/insights.spec.ts | 2 / 0 / 2.7 s | 2 / 0 / 2.7 s |
| e2e/notifications.spec.ts | 2 / 0 / 1.9 s | 2 / 0 / 1.8 s |
| e2e/pairing.spec.ts | 1 / 0 / 2.9 s | 1 / 0 / 2.8 s |
| e2e/perf.spec.ts | 1 / 0 / 4.2 s | 1 / 0 / 4.1 s |
| e2e/reconnect.spec.ts | 1 / 0 / 4.7 s | 1 / 0 / 4.7 s |
| e2e/schedule.spec.ts | 2 / 0 / 6.0 m | 2 / 0 / 5.4 m |
| e2e/security.spec.ts | 8 / 0 / 4.8 s | 8 / 0 / 5.1 s |
| e2e/session-reporting.spec.ts | 1 / 0 / 3.2 s | 1 / 0 / 3.2 s |
| e2e/settings.spec.ts | 3 / 0 / 7.7 s | 3 / 0 / 7.7 s |
| e2e/smoke.spec.ts | 8 / 0 / 4.4 s | 8 / 0 / 4.5 s |
| e2e/viewport.spec.ts | 10 / 0 / 26.2 s | 10 / 0 / 26.6 s |
| **total** | **50 / 0 / 7.6 m** | **50 / 0 / 7.0 m** |

Duration notes: the suite is dominated by the real-clock scheduler spec (two due-time waits, ~5–6 min
per run); everything else is sub-30 s per spec. The two-run sequence totals ~15 min wall-clock, which
is why gate evidence is captured in this file rather than on every push.

**Flakes found *during* this evidence run and fixed (no retries masking):**

1. `settings` download-links asserted the anchor count immediately after the URL changed; with A4's
   lazy `/settings` route the section renders after `GET /agent-links` resolves → it read 0 anchors
   in both early runs. Fixed by waiting for the route `<h1>` then the first real link (auto-waiting),
   and the rule "lazy routes need content waits" is policy rule 7 in §7.
2. `schedule` scheduled-session missed the `scheduleHeadsUp` local frame once (1/4 full runs): the
   2-minute lead could race the post-pairing cloud nudge under load. Fixed by a **3-minute lead** and
   a fail-fast check that the dashboard↔agent local-channel frames were actually captured after
   pairing (so a capture failure is reported immediately, not as a misleading 4-minute "no heads-up"),
   plus the scheduler timing rule in policy rule 4 in §7.

After these two fixes, the two runs above are **fully green** and were run back-to-back on the final
tree; the fixed specs were also re-run individually before the pair (settings 3/3, schedule 2/2).

## 9. W7 quality-gate measurement (A0, merged tree @ `01d5490`)

- **Unit/integration:** `175 + 450 + 251 + 545 = 1421` passed across 111 files (W7 added +217 tests:
  server error-mapping/races/JWT/env, agent win32 FFI + drivers, client pages/routes/auth, plus
  route-level app tests). Lint/format/typecheck/build clean; CI green on ubuntu-24.04 / macOS /
  Windows after the tampered-signature test was made deterministic (a base64url padding flake).
- **Coverage (lines / branch):** `shared` 100.00 / 95.45 · `server` **94.31 / 85.07** (was 89.44 /
  76.30) · `client` **87.45 / 79.09** (was 80.70 / 72.68) · `agent` **93.13 / 81.70** (was 88.63 /
  77.33). Weak-file gaps closed: `win32.ts` 56.77→96.61 % lines, `mongo-errors.ts` 62.5→100,
  `jwt-eddsa.ts` 29.72→100, `env.ts` 69.56→100, `session-id.ts` 20→100, `login.tsx` 58.33→100.
  Deliberately unpainted (defensive/race-only branches) are listed in the W7 worker reports.
- **Bundle:** route-level split measured in `docs/QA_NOTES.md` §2 context — entry chunk
  1,013.13→165.90 KiB raw (−83.6 %), eager first load 1,013.13→557.38 KiB (−45 %), largest chunk
  368.95 KiB (`charts`, `/insights` only), no chunk >500 kB.
- **E2E:** **50/50 passed twice back-to-back** (7.6 m / 7.0 m, retries 0), 15 files, incl. the new
  real-browser axe spec (14 routes, **0 serious/critical and 0 other violations**; 3 real a11y
  defects found and fixed in production code), stability policy in §7, per-spec durations in §8.2.
- **Supply chain:** CI secret scan now runs full history on every push+PR — real proof: 140 commits
  reachable / 104 scanned / 3.75 MB / **no leaks found** (KI-021 fixed by narrowing the allowlist).
- **Packaging:** release dry-run `42977816541` = **success**: 4/4 builds, fuses+asar gates green,
  **4/4 source AGENT_SMOKE and 4/4 packaged-artifact smoke** (macOS `.app`, Linux `squashfs-root`,
  Windows `win-unpacked`), **0 GitHub Releases** (tag-only guard).
