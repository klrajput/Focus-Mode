# QA_REPORT.md — Focus Mode (W3Grads PS03, W9 QA & security report)

> **Owner:** A9 (QA & Security Engineer) · **Task:** `task-52` (W9-QA-Report) · **Wave:** W9
> **Tree head at writing:** `63c06d3` (`docs(status): record W6 gate PASS with security/verification evidence`) on `main`
> **Date:** 2026-11-11 · **Status:** handoff draft — not a release certificate
> **Write scope of this task:** this file only. No source edits, no git operations, no heavy suites re-run
> (W7 workers are using the shared tree). Every number below is quoted from an **already-recorded**
> artefact, named inline; nothing is inferred from a build succeeding.

**One-line verdict.** W0–W6 gates are recorded PASS: **1204/1204 unit + integration tests**, **47/47
Playwright E2E (0 skipped)**, **real macOS `PASS darwin/arm64`**, **API p95 7.22 ms vs a 300 ms target**,
**coverage ≥ 80 % lines in every package**, **0 Critical / 0 High security findings** (3 Mediums fixed in
`439792b` and re-verified), installers built by CI for 4 targets with 4/4 per-OS smoke jobs green.
Remaining work is **human-gated evidence** (Windows/Linux desktops, native tray/notification visuals,
installer-level launch, signing/tag, live deployment) plus **W7 quality work that is still running**
(real-browser axe, bundle split, coverage gaps, secret-scan history). No Critical defect is open; no P0
requirement is unbuilt.

---

## 1. Scope & environment

### 1.1 What is under test

| Component | Workspace | Shape |
|---|---|---|
| Shared contract package | `shared/` | zod schemas, 13 error codes, protected sets, local/cloud message unions (protocol v1) |
| REST + WS API | `server/` | Express 5 + Mongoose 9 + MongoDB, JWT auth, pairing/attestation, scheduler, insights, admin |
| Dashboard SPA | `client/` | React 19 + Vite 8 + React Router 7, 13 routes (11 app + 403 + 404) |
| Focus Agent | `agent/` | Electron 45, local link server on `127.0.0.1`, focus controller, OS drivers, tray |
| Integration harness | `e2e/` | Playwright 1.65 against the **real** API + in-memory MongoDB + real Electron agent |
| Evidence tools | `scripts/smoke/`, `scripts/verify/`, `agent/build/` | `AGENT_SMOKE` launcher, macOS real-focus probe, fuses flip/verify |
| Delivery | `.github/workflows/` | `ci.yml` (3-OS matrix), `release.yml` (4 native runners + per-OS smoke), `codeql.yml` |

### 1.2 Pinned versions (exact pins, no ranges — policy DEC-009)

| Runtime / tool | Version | Where verified |
|---|---|---|
| Node (dev machine) | **26.11.1** | `docs/AGENT_STATUS.md` §0.1, `docs/QA_NOTES.md` header |
| Node (CI) | **22** | `.github/workflows/ci.yml` `setup-node` step |
| Electron | **45.2.3** | `agent/package.json` |
| electron-builder / `@electron/fuses` | **26.18.0** / **2.1.3** | `agent/package.json` |
| Express / Mongoose | **5.3.0** / **9.12.1** | `server/package.json` |
| zod | **4.6.7** | `shared`, `server`, `client`, `agent` package manifests |
| React / React DOM | **19.3.1** | `client/package.json` |
| Vite / Vitest / coverage-v8 | **8.3.7** / **5.1.0** / **5.1.0** | `client/package.json`, root `package.json` |
| Playwright + Chromium | **1.65.0** / Chromium **158** | root `package.json`, `docs/QA_NOTES.md` header |
| axe-core / `@axe-core/playwright` | **4.14.0** / **4.14.0** | root `package.json` |
| TypeScript / ESLint / Prettier | **5.9.3** / **10.14.0** / **3.9.10** | root `package.json` |
| mongodb-memory-server | **11.3.0** | `server/package.json` |

The full pinned dependency set was re-verified against the registry in `docs/AGENT_STATUS.md` §0.4
("registry `latest` matched the blueprint for every package"). Lockfile is committed; CI installs with
`npm ci`.

### 1.3 DEV environment and its honest constraints

macOS **15.7.7 arm64**, Node **26.11.1**, DSH workspace-write sandbox. Four environment constraints are
documented and mitigated, **none of which affect CI or the shipped app**:

- **KI-001** npm cache is root-owned → `npm_config_cache=<repo>/.npmcache`.
- **KI-006** `mongodb-memory-server` cannot write `~/.cache` → `MONGOMS_DOWNLOAD_DIR=<repo>/node_modules/.cache/mongodb-memory-server`.
- **KI-007** Playwright browsers live in the workspace → `PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers`.
- **KI-008** Electron under DSH needs three **test-only** launch adjustments (strip `ELECTRON_RUN_AS_NODE`,
  `--no-sandbox`, `--user-data-dir=<temp>`), all inside `e2e/helpers/agent.ts`; shipped Electron hardening
  is untouched.

### 1.4 CI matrix

| Pipeline | Matrix | What it runs |
|---|---|---|
| `ci.yml` → `validate` | `ubuntu-24.04`, `windows-latest`, `macos-latest` (Node 22) | `npm ci` → **lint → format:check → typecheck → build → test**, plus a blocking `npm audit --omit=dev --audit-level=critical` on Linux |
| `ci.yml` → secret scan | Linux | checksum-pinned **gitleaks** CLI against the full git history |
| `release.yml` → `build` | `windows-x64`, `macos-arm64`, `macos-x64`, `linux-x64` (native runners) | electron-builder per target with `--publish never`, then **fuse gate (macOS/Windows)**, **asar-contents gate (all OSes)**, artifact upload |
| `release.yml` → `smoke` | same 4 targets | installer size/sha256 verification + **`AGENT_SMOKE` per OS** (Linux under `Xvfb`) |
| `release.yml` → `publish` | tag-only (`v*`) | draft GitHub Release; **skipped on `workflow_dispatch`** |
| `codeql.yml` | — | static analysis (CodeQL) |

### 1.5 What "verified" means in this report — and what it never means

| Level | Meaning | Example |
|---|---|---|
| **V1 — automated, this machine** | A repo command ran here and exited 0 | `npm test`, `npx playwright test`, `scripts/verify/macos-focus-smoke.ts` |
| **V2 — automated, CI** | Green GitHub Actions run on that OS | 3-OS validate matrix; release builds + smoke |
| **V3 — real-OS probe** | A real OS API was driven and the effect read back from a **separate** process | macOS `PASS darwin/arm64` (DEC-005/DEC-020) |
| **V4 — independent review** | Adversarial attack log or UX/a11y audit with reproducible evidence IDs | `docs/SECURITY_REVIEW.md` (148 checks), A3 UX review |
| **N — NEEDS-HUMAN** | Only a person on that physical desktop can produce the evidence | Phase-8 T-100/T-101/T-102 |

Explicit non-meanings, applied throughout: **compiling is not verification**; a merged PR is not
verification; a documented fix counts only with a regression test **run on the merged tree**; docs and
diagrams are not evidence of behaviour. Where evidence is partial, this report says 🟡 and names the gap
rather than rounding up.

**Global limits of the whole evidence set.** (1) All E2E and perf runs are **loopback** against an
**in-memory MongoDB**, single client, no TLS — production numbers will be slower. (2) Playwright projects
**Chromium only**; Firefox/WebKit are not in the automated matrix. (3) The dashboard was never deployed to
a live host, so NFR-017 and the deployed-Safari/Local-Network-Access behaviour are unproven. (4) All
installers are **unsigned** and none was launched after installation. (5) The original exam PDF is absent
(KI-003/DEC-003), so the blueprint — not the PDF — is the requirement source. (6) **W7 is in progress at
the time of writing and is deliberately not counted**: at tree head `63c06d3` no W7 evidence is recorded,
the measured client bundle is still one ~1 MB chunk, and the real-browser axe pass, bundle split,
coverage-gap and full-history secret-scan work have not landed as evidence. Those items are labelled
*W7 in progress* rather than counted as done, and must be re-measured when the wave closes. (7)
**Concurrent workers are editing this checkout**: W7 has uncommitted working-tree changes (client routes,
`vite.config.ts`, `ci.yml`/`release.yml`, `.gitleaks.toml`, a new `e2e/a11y.spec.ts`, and edits to
`KNOWN_ISSUES`/`RELEASING`) that appeared after the documents quoted here were read. Every figure in this
report is therefore anchored to **recorded, committed evidence at `63c06d3`**, not to the live working
tree; a W7 close-out should refresh §2, §3 and §6 from the new measurements.

---

## 2. Test strategy & evidence

### 2.1 Strategy in one paragraph

Cheap checks run everywhere (lint, format, strict TypeScript on all four packages, shared-contract unit
tests); behaviour is proven with integration tests that boot the **real** Express app against an in-memory
MongoDB seeded with the DEC-013 demo data; the product surface is proven with Playwright against the
**real** dashboard, API and Electron agent (no mocked backend, DB or agent); OS-level behaviour is proven
only where a real desktop exists (macOS), and is otherwise reported as capabilities and marked
NEEDS-HUMAN. Security is proven adversarially against a throwaway loopback stack, separate from the
team's own tests. Every wave gate re-ran the suites on the **merged** tree, which is what caught several
integration bugs at the gate (`main.ts` never assigning `link.server` in W3, the KI-010 pairing race in
W4, the `/agent/register` limiter tripping the suite's own 6th agent launch in W6).

### 2.2 Unit + integration tests (merged tree, W6 gate)

Command: `npm test` (root → `npm run test --workspaces --if-present`; `pretest` builds `shared`).
Coverage command, from each workspace: `npx vitest run --coverage` (v8 provider, **no thresholds
configured** — this is measurement, not a gate).

| Workspace | Test files | Tests | % stmts | % branch | % funcs | % lines |
|---|---|---|---|---|---|---|
| `shared` | 8 | **175** | 100.00 | 95.45 | 100.00 | 100.00 |
| `server` | 22 | **345** | 87.71 | 76.30 | 93.28 | 89.44 |
| `client` | 26 | **171** | 78.61 | 72.68 | 80.43 | 80.70 |
| `agent` | 36 | **513** | 85.91 | 77.33 | 85.71 | 88.63 |
| **total** | **92** | **1204** | — | — | — | — |

Source: `docs/QA_NOTES.md` §3 table and §6 re-measurement (final merged-tree numbers).
Note on a superseded intermediate: `docs/QA_NOTES.md` line 88 records an earlier snapshot in which this
checkout's client run counted **156** tests; the final table and §6 use **171** (the axe/accessibility
unit file landed later). This report uses **1204**, the number recorded at the W6 gate.

Regression tests specific to this wave are spread across the packages: `server/src/test/w6-followup-hardening.test.ts`
(**12** tests) covers F-01/F-02/F-03/F-06; the agent suite includes reconnect/re-attestation races and the
link-abuse matrix (**16 KB frame / 3 connections / 20 msg-per-s / Origin / Host / subprotocol**); the
client suite includes axe checks and the F-101 allow-list guard.

### 2.3 Coverage against the TECHNICAL_DESIGN §14 target

Target: **≥ 80 % lines** on `shared`, `server/services`, `agent/focus` (excluding OS driver calls).

| Scope | Lines | Verdict |
|---|---|---|
| `shared` (package) | **100.00 %** | PASS |
| `server/services` | **91.87 %** | PASS |
| `agent/focus` | **90.88 %** | PASS |

Source: `docs/QA_NOTES.md` §3. Every package is also ≥ 80 % lines at package level (table above).

Known weak files — **handed to W7, in progress, not fixed here**: `server/src/utils/jwt-eddsa.ts` 29.72 %,
`server/src/utils/mongo-errors.ts` 53.84 %, `client/src/pages/{not-found,signup}.tsx` and
`client/src/hooks/query-client.ts` 0 % (imported only through routes/E2E), `agent/src/focus/drivers/{win32,exec,unavailable}.ts`
40–58 %. `docs/QA_NOTES.md` flags that `mongo-errors.ts` should rise on the next run because the
CastError→404 tests now exercise it — **not yet re-measured**, so this report does not claim it.

### 2.4 Playwright E2E — 47/47 passed, 0 skipped, 14 files

Command: `PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test --reporter=list`
(W6 gate run: **47 passed, 0 skipped, 4.7 min**, on merged `main` — `docs/AGENT_STATUS.md` W6 gate row).
Harness: `workers: 1`, `fullyParallel: false`, retries 1 in CI / 0 locally, real API process + in-memory
MongoDB + DEC-013 seed, real Electron agent via `_electron`.

| Spec file | Tests | Scenario(s) |
|---|---|---|
| `admin.spec.ts` | 3 | ADMIN sees real users table + aggregate stats matching the API; USER blocked in UI **and** API (403); deactivate/reactivate through the real UI with login blocked while disabled |
| `api-sessions.spec.ts` | 4 | POST creates ACTIVE, second ACTIVE → 409 `ALREADY_FOCUSING`, PATCH finalises idempotently; `clientSessionId` duplicate is a no-op (REC-006); validation/owner-scoping/unknown-device (NFR-001/NFR-003); protected-app change → `PROTECTED_ENTRY` (INV-3/FR-008) |
| `focus.spec.ts` | 1 | Start → consent modal → `/focus` countdown → End Focus → agent restores → session `CANCELLED` in the API |
| `insights.spec.ts` | 2 | Seeded totals in the UI match `GET /insights` exactly; fresh account shows the approved empty state, not invented data |
| `notifications.spec.ts` | 2 | Seeded missed-run alert shows real unread count and clicking marks it read; fresh user sees the empty state |
| `pairing.spec.ts` | 1 | Real agent pairs on `/devices`, connects, unpairs; **no page reload** at either transition (KI-010 regression) |
| `perf.spec.ts` | 1 | NFR-011: all 10 endpoints inside p95 ≤ 300 ms on seed data (200 sequential requests each) |
| `reconnect.spec.ts` | 1 | Real `SIGKILL` mid-focus → honest lost-contact UI → relaunch/re-pair → session finalised `CRASH_RECOVERY` (T-080) |
| `schedule.spec.ts` | 2 | Real scheduler: due run starts focus with source `SCHEDULE`, records the run, persists the session; agent offline at due time → `MISSED` + notification, no focus |
| `security.spec.ts` | 8 | 401 on every protected route without a Bearer token; USER never reaches admin APIs; env-configured limiter produces a deterministic 429 envelope; SEC-4 `/devices/pair` burst → 429 `RATE_LIMITED`; CORS preflight rejects a foreign Origin and reflects the dashboard Origin; unknown fields rejected by strict schemas; malformed ObjectId → 404 never 500; agent link rejects a foreign Origin |
| `session-reporting.spec.ts` | 1 | Dashboard closed → agent reports the end → exactly one finalised session (FR-027/REC-006) |
| `settings.spec.ts` | 3 | Password change (old fails, new works); unpair-all revokes the agent and every device token; download links render only real published URLs |
| `smoke.spec.ts` | 8 | API up with connected DB; `/login` and `/signup` render; seeded demo login reaches the shell; signup creates an account; wrong password shows real 401 copy; anonymous visitor redirected; Electron agent launches with the FakeDriver and shows a 6-digit code |
| `viewport.spec.ts` | **10** | NFR-006: 3 viewports (360×740, 768×1024, 1440×900) × public / USER / ADMIN+403 route sets, each asserting `scrollWidth <= clientWidth`, plus the pair dialog and mobile drawer inside 360 px |
| **total** | **47** | **14 files, 0 skipped, 0 `test.fixme` active** |

Two count reconciliations, so the numbers are auditable: (a) `docs/QA_NOTES.md` §4 lists "`viewport` ×4"
— that is 4 `describe` blocks; the spec **generates 10 tests** (3 looped groups × 3 viewports + 1 dialog
test), which is why 14 files total 47 and not 41. (b) `test.fixme` declarations remain in the specs as
**self-gating fallbacks**: they only activate when a feature file is absent from the checkout (KI-012).
On the merged tree every one of them is inactive — the W6 gate recorded **0 skipped**.

### 2.5 NFR-011 — API latency (measured, PASS)

REQUIREMENTS §5 NFR-011: **API p95 ≤ 300 ms on seed data**. Method: one warm-up request, then **200
sequential** requests per endpoint through Playwright's `APIRequestContext`; nearest-rank percentiles from
wall-clock timings (`e2e/perf.spec.ts`, `test.slow()`).

| Endpoint | p50 (ms) | p95 (ms) | max (ms) | n |
|---|---|---|---|---|
| `GET /health` (public) | 0.46 | 1.04 | 3.20 | 200 |
| `GET /devices` | 1.02 | 1.66 | 6.76 | 200 |
| `GET /sessions?limit=20` | 0.99 | 2.30 | 3.39 | 200 |
| `GET /insights?range=7d` | 5.27 | **7.22** | 82.37 | 200 |
| `GET /notifications?limit=20` | 0.83 | 1.29 | 6.17 | 200 |
| `GET /allowlist` | 0.86 | 1.00 | 1.58 | 200 |
| `GET /schedules` | 0.77 | 0.97 | 1.46 | 200 |
| `GET /agent-links` (public) | 0.56 | 0.65 | 1.08 | 200 |
| `GET /admin/users` (admin) | 0.78 | 1.13 | 2.60 | 200 |
| `GET /admin/stats` (admin) | 1.00 | 1.51 | 30.51 | 200 |

Source: `docs/QA_NOTES.md` §1. **Verdict: PASS** — worst p95 **7.22 ms** (the only real aggregation),
≈ **41× inside** the 300 ms target; the spec asserts `worst.p95 <= 300` on every run so a regression fails
the suite. Caveat: loopback + in-memory MongoDB + one client + no TLS → treat as a **floor** and
re-measure on the deployed API before claiming the target publicly.

The other NFR-011 limbs are **not** instrumented as metrics: *focus applied ≤ 3 s* and *status propagation
≤ 1 s* are covered **functionally** by the E2E transitions (consent → `/sessions` ACTIVE; badge flips
without reload; state resync after crash), and *agent idle CPU < 2 %, RAM < 200 MB* is an OS-level
measurement that stays **NEEDS-HUMAN** (Phase-8 checklist).

### 2.6 Real-OS evidence — macOS FOCUS-1/FOCUS-2

`npx tsx scripts/verify/macos-focus-smoke.ts` → **`PASS darwin/arm64`** (exit 0). It drives the **real**
`FocusController` + **real** `DarwinDriver`: launches and hides its own TextEdit instance, verifies the
hide from a **separate** `osascript` process (DEC-005: same-process state is never trusted), clears the
journal, proves a second `exitFocus` is an idempotent no-op, restores, and verifies the restore the same
way. Nothing else on the machine is touched; no window titles or URLs are read (INV-6).
Source: `docs/PLATFORMS.md` §2/§8, `docs/AGENT_STATUS.md` W3 gate row (DEC-020).

This is the **P0 "one fully working OS"** claim (DEC-008, macOS arm64) and it is real-driver evidence, not
a mock. Windows and Linux X11 drivers have mocked-native contract suites + CI builds only (see §5).

### 2.7 `AGENT_SMOKE` per OS (CI)

The release workflow runs the packaged-code smoke on **all four** targets: `windows-x64`,
`macos-arm64`, `macos-x64`, `linux-x64` (Linux under `Xvfb`). Entry point:
`node scripts/smoke/launch.mjs` (same check locally). It requires exactly: one
`SMOKE_READY port=<n>` line, `hello.paired === false` (honest — the smoke run is unpaired),
`getState.state === 'IDLE'` (nothing faked or left applied), and self-exit 0 within 20 s.
Run **`42873654284`** (W6): **4/4 build jobs + 4/4 `AGENT_SMOKE` jobs green, fuses/asar gates PASS,
0 GitHub Releases created**. First-installer run **`42858934575`** (W4): 4/4 builds + 4/4 smoke, 0 releases.
Sources: `docs/AGENT_STATUS.md` W4/W6 gate rows, `docs/PLATFORMS.md` §6.

The smoke proves the **packaged code + Electron boot headless + a real loopback `hello`/`getState`
round-trip**. It does **not** prove that an installed `.dmg`/`.exe`/AppImage launches — that is
NEEDS-HUMAN (T-100 W7, T-101 M6, T-102 L3).

### 2.8 Client bundle (production build)

Command: `npm run build -w @focus-mode/client` (Vite 8; source maps excluded from shipped size).

| Asset | raw | gzip |
|---|---|---|
| `index-*.js` (single chunk) | 987.8 KiB | 284.8 KiB |
| `index-*.css` | 31.0 KiB | 6.8 KiB |
| **total (2 files)** | **1018.8 KiB** | **291.6 KiB** |

Source: `docs/QA_NOTES.md` §2. **No NFR target exists for bundle size**; Vite warns that the JS chunk
exceeds 500 kB minified because Recharts + `motion` + the full router ship together. This is the exact
item handed to W7 (route-level `React.lazy`/code-splitting). It is **not fixed at the evidence baseline**:
the ~1 MB single chunk is the measured state at `63c06d3`; a W7 split is in flight and unmeasured, so this
report does not claim an improvement.

### 2.9 Accessibility

- **axe-core unit checks: 0 violations across 11 routes** (A4, W6) with the F-102…F-113 fixes applied;
  `client` suite **171** tests.
- Keyboard/focus management, skip link, `aria-live` countdown, labelled form errors and reduced-motion
  handling are exercised by those unit tests.
- **Gap, W7 in progress:** at the recorded baseline `docs/QA_NOTES.md` §5 notes that A8 added **no
  real-browser axe spec**; the pinned `@axe-core/playwright` adapter exists but no committed spec drove it.
  NFR-008 is therefore 🟡 (§3), not ✅. A W7 `e2e/a11y.spec.ts` was appearing as an uncommitted working-tree
  file during handoff — it is **not** counted until it runs green on the merged tree and its result is
  recorded.

### 2.10 What the E2E suite deliberately does not prove

| Limit | Detail | Ref |
|---|---|---|
| Focus E2E uses the **FakeDriver** | Real OS window management is proven only by the macOS probe; tray/visuals are manual | KI-005, KI-013 |
| Native consent dialog is **stubbed inside the Electron main process** | Test-only seam; production code untouched; the gate still blocks Start until the agent-side prompt resolves | KI-011 |
| Tray menu + OS notifications are **not automatable** | The equivalent controller path (`exitFocus`) and the machine-readable frames are asserted instead | KI-013 |
| Reconnect spec re-pairs | `safeStorage` unavailable in the sandbox, so the relaunched agent's token is memory-only; a keychain would skip re-pairing | `docs/QA_NOTES.md` §5 |
| Native visuals, permissions, sleep/resume, installer launch | Phase-8 human checklist | T-100/T-101/T-102 |
| Chromium only | Firefox/WebKit absent from the matrix | this report §1.5 |

---

## 3. Requirements coverage matrix (55 rows)

**Source of truth:** `docs/REQUIREMENT_TRACEABILITY.md` §18 — a **W1–W5 refresh** containing 55
requirement rows (**30 FR + 17 NFR + 8 REC**), each already carrying an evidence cell. This report does
**not** re-derive it; it reproduces the status and, where the **W6 gate** produced newer evidence, upgrades
the row and marks it `W6↑`. Rows still marked 🔄 in §18 (FR-013, FR-019, FR-021, FR-025, FR-029) were
closed by the W5 gate and re-proven at W6; the 📋 P2 rows are **not delivered** and are not counted as
coverage.

**Rollup (this report's assessment):** **39 ✅ verified · 12 🟡 partial (each with a named NEEDS-HUMAN or
W7-in-progress gap) · 4 📋 P2 not delivered.** No P0 requirement is unbuilt; every 🟡 has a human-gated or
explicitly-in-progress residual, never an unknown one.

### 3.1 Functional requirements (FR-001 … FR-030)

| ID | Pri | Status | Evidence | Residual / gate |
|---|---|---|---|---|
| FR-001 | P0 | ✅ | server auth integration tests (401/403/429, bcrypt cost 12, no `passwordHash` leak) + real-API E2E login; CI 3 OSes | — |
| FR-002 | P0 | 🟡 | Electron agent launches/pairs/reports in real E2E; `AGENT_SMOKE` green locally + 4 CI targets | Native tray/menu-bar **visuals** = NEEDS-HUMAN (KI-013/T-101) |
| FR-003 | P0 | ✅ | real pairing E2E (real code → `POST /devices/pair` → Connected via Ed25519 attestation); KI-010 reload gap fixed W4 | — |
| FR-004 | P0 | ✅ | link integration tests + real E2E over `ws://127.0.0.1`; badge transitions assert **no page reload** (pair + unpair) | — |
| FR-005 | P0 | ✅ | FakeDriver focus E2E (consent → countdown → aside → end) + real macOS hide (`PASS darwin/arm64`) | — |
| FR-006 | P0 | ✅ | journal-first idempotent restore tests + focus E2E; real macOS restore verified from a separate process | — |
| FR-007 | P0 | ✅ | countdown derived from absolute `endsAt` in E2E; timer/auto-end/sleep accounting unit-tested; 1–480 validation | — |
| FR-008 | P0 | ✅ | protected apps never candidates (property tests) + `PROTECTED_ENTRY` on 4 attack shapes + E2E + locked UI rows | — |
| FR-009 | P0 | ✅ | `enterFocus` impossible before Confirm (spy test); consent payload tested; global focus indicator on every authed route | — |
| FR-010 | P0 | ✅ | sessions API (filters, pagination, sort, capped `actualMinutes`) + `api-sessions` / `session-reporting` E2E | — |
| FR-011 | P1 | 🟡 | macOS **real** verified (DEC-020); Windows koffi + Linux X11 drivers behind the frozen `FocusDriver` with mocked-native contract suites + CI builds | Windows/Linux **runtime** = NEEDS-HUMAN (KI-005, T-100/T-102) |
| FR-012 | P1 | ✅ | real-scheduler E2E (create → minute tick → `scheduleDue` → ≥10 s cancellable heads-up → source `SCHEDULE` session → run recorded); timezone/DST unit tests | — |
| FR-013 | P1 | ✅ **W6↑** | W5 gate: insights API + `/insights` page real; `insights.spec.ts` 2/2 (seeded totals match API; fresh-user empty state); hand-computed fixtures for Asia/Kolkata, UTC, Europe/London DST | §18 still says 🔄 (W5 snapshot) |
| FR-014 | P1 | ✅ **W6↑** | link reconnect/backoff + heartbeat; sleep/resume reconcile + crash recovery; **T-080 reconnect E2E**: real `SIGKILL` → honest lost-contact → relaunch → `CRASH_RECOVERY` finalisation | Re-pairs in the sandbox (no `safeStorage`); keychain skip unverified (NEEDS-HUMAN) |
| FR-015 | P2 | 📋 | not delivered — W10 bonus (optional MV3 extension, assumption A-12) | Out of W9 scope; **not counted as coverage** |
| FR-016 | P2 | 📋 | not delivered — W10 bonus | as above |
| FR-017 | P2 | 📋 | not delivered — W10 bonus | as above |
| FR-018 | P2 | 📋 | not delivered — W10 bonus | as above |
| FR-019 | P0 | ✅ **W6↑** | W5 gate: admin APIs + `/admin` page real; `admin.spec.ts` 3/3 (users table + aggregate stats match API; USER 403 in UI **and** API; deactivate/reactivate via UI); self-demotion/self-deactivation → 409 | §18 still says 🔄 |
| FR-020 | P0 | ✅ | allow-list GET/PUT + presets (merge/replace), protected rows preserved, UI editor with `listApps` picker + rollback | — |
| FR-021 | P0 | ✅ **W6↑** | all 13 routes real (11 app + 403 + 404); W5 gate "all P0/P1 pages complete"; viewport spec covers public/USER/ADMIN+403 sets at 3 sizes | §18 says 🟡 (W5 pages mid-landing) |
| FR-022 | P0 | 🟡 | agent window states (UNPAIRED/PAIRED/FOCUSING/error), countdown, locked allow-list rows, tray End focus/Quit; 67 UI tests | Native visuals = NEEDS-HUMAN (KI-013) |
| FR-023 | P0 | ✅ | journal-first ordering test (driver call log), crash recovery on startup, kill-during-write safety; real macOS journal clear | — |
| FR-024 | P0 | ✅ | `ALREADY_FOCUSING`/`focusRejected` tests + sessions API 409 (partial unique index) + E2E | — |
| FR-025 | P1 | ✅ **W6↑** | W5 gate: notifications REST + bell UI; **missed-run E2E un-gated and green** (offline at due → `MISSED` + notification, no focus) | §18 says 🟡 |
| FR-026 | P0 | ✅ | TTL 10 min, single-use, ≤5-attempt latch (5th → 400, 6th → 410), hash-only storage (DEC-014/DEC-017) | — |
| FR-027 | P0 | ✅ | dashboard-closed reporting E2E — agent reports the end, exactly one finalised session (idempotent `clientSessionId`) | — |
| FR-028 | P1 | ✅ | reaper tests for stale ACTIVE sessions (heartbeat-bounded `actualMinutes`); analytics definitions unit-tested | — |
| FR-029 | P0 | ✅ **W6↑** | `/settings` page + `/users/me`, password, unpair-all APIs; `settings.spec.ts` 3/3 (old password fails, new works; unpair-all revokes agent + tokens; real download URLs only) | §18 says 🔄 |
| FR-030 | P0 | ✅ | idempotent seed tests (run twice → identical counts); refuses production without `--force`; same seed powers E2E | — |

### 3.2 Non-functional requirements (NFR-001 … NFR-017)

| ID | Pri | Status | Evidence | Residual / gate |
|---|---|---|---|---|
| NFR-001 | — | ✅ | shared zod schemas used by client + server; `VALIDATION_ERROR` with `details[]`; inline field errors; strict schemas reject unknown fields (E2E) | — |
| NFR-002 | — | ✅ | central error middleware: forced 500 returns generic message, no `stack` in JSON, consistent envelope; malformed-id → 404 (F-01 fix) | — |
| NFR-003 | — | ✅ | CORS allow-list, helmet, 429 on 11th login, `$ne` injection → 400, cross-user id → 404 | — |
| NFR-004 | — | ✅ | zod-validated env modules per package; CI gitleaks scan with reviewed allowlist; no hard-coded URLs outside config modules | gitleaks `*.md` allowlist = KI-021 (Low, open) |
| NFR-005 | — | ✅ | ESLint 10 + Prettier; lint/format:check green locally and in the 3-OS CI matrix | — |
| NFR-006 | — | ✅ **W6↑** | Playwright no-horizontal-scroll spec: 3 viewports × public/USER/ADMIN+403, plus pair dialog and drawer at 360 px (**10 generated tests**) | §18 says 🟡 (spec landed after the refresh) |
| NFR-007 | — | 🟡 | loading/empty/error/success states exist and are tested per page as pages landed; empty states asserted in insights/notifications E2E | Full per-screen state sweep (T-093) not evidenced as a single pass |
| NFR-008 | — | 🟡 | axe-core **0 violations across 11 routes** (unit); contrast tokens 43/43 PASS in UX_SPEC; semantics shipped | **Real-browser axe spec missing** — W7 in progress (A8/A4) |
| NFR-009 | — | ✅ | `/api/v1` base, Bearer auth, status codes, list envelope `{items,page,limit,total,totalPages}`; contract + per-route integration tests | — |
| NFR-010 | — | ✅ | link server binds `127.0.0.1` only; foreign Origin/Host rejected at upgrade (E2E); unauth message limits tested; LAN unreachable by binding | — |
| NFR-011 | — | 🟡 | **API p95 = 7.22 ms worst vs 300 ms target** (10 endpoints × 200 requests, loopback); focus-apply/status-propagation covered functionally | CPU/RAM limits unmeasured (NEEDS-HUMAN); loopback is a floor; deployed re-measure pending |
| NFR-012 | — | 🟡 | real unsigned installers for 4 targets (runs `42858934575`, `42873654284`), 4/4 `AGENT_SMOKE` green, fuses/asar gates PASS | **Installer-level launch**, signing/notarisation = NEEDS-HUMAN |
| NFR-013 | — | ✅ | least-data payloads + strict schemas; INV-6 no-title assertions in driver tests; `passwordHash` never serialised | — |
| NFR-014 | — | 🟡 | header comments per module and strict TS in place; `docs/VIVA_NOTES.md` exists as a **draft** | Final viva notes + architecture documentation pass = W9 deliverable |
| NFR-015 | — | 🟡 | conventional commits + branch-per-feature; every human in history is a human action (D-09); no AI trailers in the log | `git shortlog -sn` proof at the release gate pending |
| NFR-016 | — | ✅ | pino redaction test (`authorization`/`password`/tokens) + request-id handling; agent uses electron-log event-only logging; agent secret-free log test | — |
| NFR-017 | — | 🟡 | deploy configs + README setup verified **locally**; DEPLOYMENT.md written | **Deployment is not live** (no hosting credentials) — T-120/T-121 |

### 3.3 Recommendations (REC-001 … REC-008)

| ID | Pri | Status | Evidence | Residual / gate |
|---|---|---|---|---|
| REC-001 | P0 | ✅ | cloud `/agent-link` hub: device-token auth, heartbeat 15 s, 45 s disconnect timeout, INV-2 (`scheduleDue`/`revoked` only) enforced by tests | — |
| REC-002 | P0 | ✅ | two-stage pairing digest per DEC-014; register/pair/poll + token-once tests + real pairing E2E | — |
| REC-003 | P0 | ✅ | EdDSA attestation (`node:crypto`, DEC-016): wrong nonce/expiry/user rejected; unauth `enterFocus` → `focusRejected{UNAUTHENTICATED}` | — |
| REC-004 | P0 | 🟡 | native first-run consent gate tested (cannot be answered by the page; stored + revocable) | Dialog **visuals** NEEDS-HUMAN; E2E uses a main-process test seam (KI-011) |
| REC-005 | P1 | ✅ | enforcement loop tested with the FakeDriver call log: re-asides new windows, never protected, stops on exit, disabled → zero extra calls | — |
| REC-006 | P0 | ✅ | `clientSessionId` idempotency tests + E2E: duplicate reports merge, no double count, dashboard-closed path covered | — |
| REC-007 | P1 | ✅ | `listApps`/`apps` local messages (key+label+running only) consumed by the allow-list picker | — |
| REC-008 | P0 | 🟡 | default-off behaviour unit-tested (tray menu + view-model) | Literal tray toggle = NEEDS-HUMAN (KI-013/T-101) |

### 3.4 How to read this matrix without over-claiming

- ✅ means the requirement's acceptance criteria have **automated or real-OS evidence in this repo/CI**.
  It does **not** mean the PDF was available to diff against (KI-003/DEC-003) and it does not mean the
  feature was exercised on every OS.
- 🟡 always names the missing evidence; none of the twelve 🟡 rows hides an unknown failure.
- 📋 rows (FR-015…FR-018) are **P2 bonus scope deliberately not built**; a submission claim of "30/30 FR"
  would be false — the honest figure is **26 of 30 delivered** (23 ✅ + 3 🟡), 4 planned.
- Contract-level coverage is separate and green: **46/46 REST endpoints** documented and matching code,
  **16/16 local + 6/6 cloud messages**, **9/9 Mongo collections**, **13/13 error codes**, INV-1…INV-6,
  **35/35 consistency checks PASS** (`docs/INTEGRATION_CONTRACTS.md` §11). C-1…C-26 are recorded, with
  **C-26** (single-use attestation nonce cache) documented in **DEC-025/`AGENT_STATUS`** rather than in
  the contracts §12 table that stops at C-25 — a documentation-location nuance, not a missing control.

---

## 4. Security posture

### 4.1 Method, independence and snapshot caveat

`docs/SECURITY_REVIEW.md` is an **independent adversarial review** (A9) run against a throwaway loopback
stack: memory MongoDB + the real API + the real `LinkServer`/`AttestationGate` + real Chromium for XSS
rendering. Harness lived in `/tmp` (nothing added to the product tree), 12 attack groups, **148 checks —
132 PASS / 16 FAIL** at the snapshot, pinned to `main` @ **`05e6187`** plus the live W6 working-tree
edits. The review deliberately used **real tokens, real pairing digests, real Ed25519 attestations and a
real cron tick**, not the team's own test doubles.

**Snapshot caveat (KI-012):** the review ran while W6 work was landing on a shared checkout, so some
findings describe a tree that has since moved. Section 8 of the review re-checks every finding on the
final merged tree; **this report uses the re-verified status**, not the snapshot status.

### 4.2 SEC-1…SEC-10 scorecard (A9's independent result)

| Control | Requirement | Result | Evidence anchor |
|---|---|---|---|
| SEC-1 | bcrypt ≥ 12 | **PASS** | stored `$2b$12$…`; `BCRYPT_COST = 12` in `auth.service.ts`/`user.service.ts` |
| SEC-2 | HS256, 30 min TTL, secret ≥ 32 B | **PASS** | real login token `alg=HS256 ttl=1800 iss=focus-mode-api aud=focus-mode-dashboard`; `env.ts` enforces ≥32 chars |
| SEC-3 | helmet + strict CORS | **PASS** | F1-01…03, F2-01…02; `credentials:false` |
| SEC-4 | rate limits | **PASS** | 30 → 429 burst; pairing 5/min then 429; register 5/min then 429; **X-Forwarded-For spoofing does not reset the bucket** |
| SEC-5 | pairing digest / TTL / single use | **PASS** (residual per DEC-017) | 5 wrong guesses → 6th 410; correct codes of other users unaffected |
| SEC-6 | device token 256-bit, hash at rest, revocable | **PASS** | only `deviceTokenHash` stored; delete → REST 401 + WS 4401 |
| SEC-7 | EdDSA, 60 s, nonce-bound | **PASS** | forged key, replayed nonce, wrong aud/sub, expired, alg=none all rejected |
| SEC-8 | Electron hardening | **PASS** (source + suites + artifact fuses) | `contextIsolation:true, sandbox:true, nodeIntegration:false, webSecurity:true`, CSP `default-src 'none'`; 7 fuses verified on packaged artifacts (§4.4) |
| SEC-9 | operator/prototype stripping | **PASS** | `email.$ne` → 400 with `path: "email.$ne"`; prototype/mass-assignment rejected |
| SEC-10 | least-data payloads | **PASS** | no `passwordHash`; aggregate-only admin stats; whitelist mappers |
| INV-2 | cloud→agent = `scheduleDue`, `revoked` only | **PASS** | `shared/src/protocol.test.ts` 71 tests; hub enforces twice |
| INV-3 | protected set immutable | **PASS** | 4 attack shapes → `PROTECTED_ENTRY` |
| INV-6 | no titles/URLs read | **PASS (source)** | greps + `source-guard.test.ts` 13 + `selection.test.ts` 23; OS trace on a signed build = NEEDS-HUMAN |

### 4.3 Findings F-01…F-07 — status on the merged tree

**Headline: 0 Critical, 0 High.** Three Mediums were fixed in **`439792b`** (`fix(server): harden W6
follow-ups (deep JSON, deactivated accounts, malformed ids)`) and re-verified; two Lows remain open; one
Low is an accepted design risk.

| ID | Severity | Finding | Status | Fix / re-verification |
|---|---|---|---|---|
| **F-01** | Medium | Malformed ObjectId path params returned **500 INTERNAL** on `DELETE /devices/:id`, `POST /devices/:id/attest`, `PATCH /sessions/:id`, `POST /allowlist/preset/:id` (NFR-002 violation + stack-trace log noise) | **FIXED** (`439792b`) | Central `CastError`/`BSONError` → 404 mapping + safe ObjectId parsing at service boundaries; all four routes assert **404 NOT_FOUND**, standard envelope, no stack trace (`w6-followup-hardening.test.ts`, 12 tests; server 22 files / 345 tests green) |
| **F-02** | Medium | ~4 KiB deeply-nested JSON (≥4000 nested arrays) from an **unauthenticated** caller overflowed the stack in `findForbiddenKeys` → 500 on any path | **FIXED** (`439792b`) | `findForbiddenKeys` rewritten as an explicit-stack **iterative** walk; 4 000 / 12 000 / 20 000-deep arrays and 4 000 / 8 000-deep objects → **400 VALIDATION_ERROR** (never 500, no `RangeError`); an operator hidden at ~4 000 depth is still rejected; a legitimate 50-deep payload validates |
| **F-03** | Medium | Deactivating an account did **not** revoke device credentials or stop the scheduler: device token still 200 on `/agent/allowlist`, agent reports persisted sessions for the disabled account, cron still dispatched `scheduleDue` | **FIXED** (`439792b`) | `requireDeviceToken` re-checks `isActive` (403 `ACCOUNT_DISABLED`); `reportSessionStarted` refuses deactivated owners (0 sessions persisted); scheduler filters `isActive:true` **before claiming `lastRunAt`** (no dispatch, no MISSED spam); admin deactivation calls `revokeAllDevicesForUser` |
| **F-04** | Low | `POST /agent/enroll/poll` state oracle: after consumption a **wrong** secret answers 410, an unknown id answers 404 (no token leak) | **OPEN** — KI-018 | Accepted for W6 as out of the hardening scope; fix is "404 on mismatched secret even after consumption" |
| **F-05** | Low | Stateless access tokens survive password change/logout for the remaining 30-min TTL | **ACCEPTED RISK** — KI-019 | Documented contract behaviour (client drops token; `sessionStorage`, not `localStorage`); optional `tokenVersion` claim listed as future hardening |
| **F-06** | Low | `POST /agent/enroll/poll` had **no rate limiter** (the only unauth DB-touching endpoint without one) | **FIXED** (W6 base) | Route behind `createPublicRateLimiter('agent-poll')`; follow-up test asserts the limiter headers |
| **F-07** | Low | `.gitleaks.toml` allowlists **every Markdown path** (a `*.md` suffix rule), so a secret pasted into any `.md` file would not fail CI | **OPEN** — KI-021 | Local pattern greps + CI gitleaks found **no committed secrets**; allowlist narrowing = W7 (A10) / W9 |

Re-verification attribution (stated honestly in the source): the review's §8 is a **Lead (A0) spot-check**
on the final merged tree, not a second full independent A9 run. It confirms each finding through A5's
regression tests plus targeted probes. This QA report therefore claims "**fixed with regression tests,
confirmed on the merged tree**" — not "independently re-attacked end to end".

### 4.4 Packaging hardening on **real artifacts** (fuses + asar)

`agent/electron-builder.yml` `afterPack` calls `agent/build/flip-fuses.mjs`, which flips and then
**self-verifies** the fuse wire (build fails if the final state is wrong). Required state:

| Fuse | State | Why |
|---|---|---|
| `RunAsNode` | **Disabled** | `ELECTRON_RUN_AS_NODE` cannot turn the app into a plain Node interpreter |
| `EnableNodeOptionsEnvironmentVariable` | **Disabled** | `NODE_OPTIONS` injection refused |
| `EnableNodeCliInspectArguments` | **Disabled** | no `--inspect` debugger attach |
| `OnlyLoadAppFromAsar` | **Enabled** | no `app/` shadowing beside the asar |
| `EnableEmbeddedAsarIntegrityValidation` | **Enabled** (macOS only — not implemented elsewhere) | asar integrity validated at launch |
| `GrantFileProtocolExtraPrivileges` | **Disabled** | `file://` renders without extra privileges |
| `EnableCookieEncryption` | **Enabled** | any accidental cookie store is OS-encrypted |

Artifact-level evidence (`docs/RELEASING.md` §11.1): the W4 installer from run `42858934575` was built
**before** the hook existed and shipped **insecure defaults** (`RunAsNode` Enabled, `OnlyLoadAppFromAsar`
Disabled, …). After the hook, a locally packaged app reads back **all seven** in the required state
(`RunAsNode` Disabled, `EnableCookieEncryption` Enabled, `EnableNodeOptionsEnvironmentVariable` Disabled,
`EnableNodeCliInspectArguments` Disabled, `EnableEmbeddedAsarIntegrityValidation` Enabled,
`OnlyLoadAppFromAsar` Enabled, `GrantFileProtocolExtraPrivileges` Disabled). CI now **gates** on it:
release run `42873654284` records **fuses/asar PASS** alongside 4/4 builds + 4/4 smoke.

**Honest scope limits:** the fuse gate runs on **macOS and Windows only** (the Linux AppImage/deb payload
has no standalone bundle the fuses CLI can read; the hook still runs on `linux-unpacked`), while the
asar-contents gate (required `/dist/main.js`, `/dist/ui/index.html`, `/dist/ui/preload.cjs`,
`/package.json`; forbidden `.env`, certs/keys, `src/`, own source maps) runs on **every OS**. Fuses harden
the runtime but are **not** a substitute for code signing — all artifacts remain unsigned.

### 4.5 Residual risks accepted (with references)

| Risk | Why accepted | Ref |
|---|---|---|
| An attacker registering many accounts can try 5 codes per account per 10-min window | Bounded by account-creation limits (10/15 min/IP), 10/min/user pair limit, 10-min TTL, single use, 10⁶ space | DEC-017, C-14 |
| A compromised TLS endpoint allows offline brute force of the 10⁶ code space via `codeHmac` | Codes short-lived and worthless after single use; DB alone (no `PAIR_PEPPER`) cannot be brute-forced | DEC-014 |
| Pairing latch + rate-limit stores are in-memory (single API instance) | Documented single-instance deployment; restart clears the latch but TTL + per-IP/user limits remain the bound | DEC-017 |
| Access tokens are stateless (password change/logout do not revoke) | 30-min TTL, `sessionStorage` only, no refresh tokens | F-05 / KI-019 |
| Device tokens live until unpair (no scheduled rotation) | SEC-6 requires revocability, which exists; rotation = re-pair | SEC-6 |
| Safari cannot open `ws://127.0.0.1` from an HTTPS dashboard | Documented unsupported browser; help card shipped | KI-004 |
| Rate limits are per IP with no `trust proxy` set | XFF spoofing does not reset the bucket, so no bypass; W8 deployment must set `trust proxy 1` so clients are not collapsed onto one IP | `rateLimit.ts` note, BL-07 |

### 4.6 What the security work does **not** prove

1. **No signed/notarised installer was launched** — fuses are verified by reading the wire, not by
   attacking a running signed app.
2. **No OS-level trace for INV-6** — source greps prove no title/URL APIs are called by our code; only a
   trace on a signed build could prove nothing is read out-of-band.
3. **`gitleaks` is not installed in this sandbox** — the review used pattern greps + `git ls-files`; CI
   runs the checksum-pinned binary.
4. **Electron sandbox on Windows/Linux desktops** — `sandbox:true` is source-verified; the KI-008 launch
   workarounds are test-only, and non-harness desktop sandboxing is NEEDS-HUMAN.
5. **No live deployment** — HTTPS/TLS, proxy headers, real-IP limiting and CORS against a real origin are
   unexercised.

---

## 5. Known limitations & NEEDS-HUMAN register

Nothing in this table may be ticked without evidence recorded here (OS version, build id, screenshot or
video). Everything below is **human-gated**, not "assumed working".

| # | Item | Why no worker can verify it | Evidence required | Ref |
|---|---|---|---|---|
| 1 | **Windows 10/11 runtime window control** | No Windows desktop in this session; mocked-native suites + CI build only | T-100 W1–W8: real hide/restore, elevated-window skip, `taskkill`, sleep/resume, install/uninstall, SmartScreen | KI-005, PLATFORMS §3/§7 |
| 2 | **Linux X11 runtime window control** | No Linux desktop; contract tests + Xvfb CI smoke only | T-102 L1–L3: real start/end, Wayland unsupported message blocks Start, AppImage run, deb install/uninstall | KI-005, PLATFORMS §4 |
| 3 | **Native tray menu, consent dialog, scheduled heads-up + OS notification visuals** | Native `NSMenu`/notifications have no Playwright handle; only the machine-readable frames are asserted | T-101 M1–M7 (incl. tray End focus / Quit / visual banner) | KI-011, KI-013 |
| 4 | **Safari on the deployed HTTPS dashboard** | Safari blocks `ws://127.0.0.1` from HTTPS; documented unsupported | Manual check on the deployed origin if Safari support is ever claimed | KI-004, PLATFORMS §5 |
| 5 | **Chrome/Edge/Firefox Local Network Access prompt** | The one-time LNA permission prompt needs a real browser profile | Allow/deny both paths on the deployed dashboard; help card behaviour | PLATFORMS §5 |
| 6 | **Wayland** | Not a defect: `capabilities.focus = "unsupported"` + reason, dashboard blocks Start | Verify the honest capability message on a Wayland session (L2) | PLATFORMS §1/§4 |
| 7 | **Unsigned installers** | No certificates in this environment | Signing/notarisation per `docs/RELEASING.md` §5–§6 | NFR-012 |
| 8 | **Installer-level launch** | CI proves the packaged code boots headless, not that an installed dmg/exe/AppImage launches | T-100 W7, T-101 M6, T-102 L3 | PLATFORMS §6 |
| 9 | **Deployment is not live** | No hosting credentials; NFR-017 verified locally only | Deploy the API + dashboard, re-run NFR-011 against the deployed URL, record the URL | NFR-017, T-120/T-121 |
| 10 | **Signing + tag-publish not performed** | Releases are maintainer-tagged; `workflow_dispatch` intentionally skips publish | Push a `v*` tag and confirm the draft release + checksums | DEC-022, RELEASING §2 |
| 11 | **Agent idle CPU < 2 %, RAM < 200 MB** | OS-level measurement, not in Playwright scope | Measure idle CPU/RAM on macOS + Windows + Linux | NFR-011 |
| 12 | **Original exam PDF absent** | Blueprint treated as authoritative; any PDF-vs-blueprint delta is undetectable | Human supplies the PDF for a final diff | KI-003, DEC-003 |
| 13 | **Human git authorship** | Only humans author/merge their own commits | `git shortlog -sn` at the release gate + hand-off list | NFR-015, D-09 |
| 14 | **Headless agent has no pairing code** | `AGENT_HEADLESS=1` creates no renderer window, so the code exists nowhere a display-less harness can read it (pairing E2E needs a visible window / `xvfb-run`) | A test-only state file or IPC channel, or accept the visible-window requirement | KI-009 |

**Phase-8 checklist status at writing:** T-100 ⛔, T-101 🟡 (the real-driver hide/restore core of M1/M2 has
automated evidence; browser-untouched, permissions, sleep/resume, installer and tray/notification parts
remain ⛔), T-102 ⛔. Source: `docs/PLATFORMS.md` §7.

---

## 6. Defects ledger

21 issues are tracked in `docs/KNOWN_ISSUES.md` (KI-001…KI-021). Severity scale (AGENTS §15):
Critical = data loss / focus stuck / protected app touched / security hole; High = P0 broken; then
Medium, Low. **Critical/High block release.**

### 6.1 Rollup

| Status | Count | IDs |
|---|---|---|
| **Closed — fixed & verified** | **5** | KI-010 (High), KI-015, KI-016, KI-017, KI-020 (Medium/Medium/Medium/Low) |
| Mitigated (workaround documented; root cause environmental) | 5 | KI-001, KI-006, KI-007, KI-008, KI-014 |
| Accepted limitation / documented by design | 6 | KI-002, KI-004, KI-011, KI-012, KI-013, KI-019 |
| **Open** | **5** | KI-003 (Med), KI-005 (High, NEEDS-HUMAN), KI-009 (Med), KI-018 (Low), KI-021 (Low) |

Open severity split: **0 Critical · 1 High · 2 Medium · 2 Low**. The single open High is **KI-005**, an
**evidence gap on Windows/Linux real desktops**, not a known code defect: the drivers are implemented,
contract-tested and CI-built, but real window manipulation has never been observed. It gates any public
claim of Windows/Linux support (it does **not** gate the macOS P0 scope of DEC-008); the macOS Phase-8
visual/permission items are tracked separately as 🟡/⛔ in §5.

### 6.2 Closed defects (fixed and verified)

| ID | Severity | Defect | Fix / evidence |
|---|---|---|---|
| KI-010 | **High** | FR-004: dashboard badge did not refresh after pair/unpair without a page reload | Agent re-sends `hello`+challenge to unauth sockets and closes authed sockets with `1008` on revoke; client bounded re-handshake. Real probe: `badge after pairing, NO reload: Connected`; unpair → `Disconnected`. `e2e/pairing.spec.ts` now asserts the live transitions (W4) |
| KI-015 | Medium | F-01 malformed ObjectId → 500 | Fixed `439792b`; four routes now 404; regression test (see §4.3) |
| KI-016 | Medium | F-02 deep-JSON stack overflow → 500 | Fixed `439792b`; iterative walk; 4k–20k deep → 400 |
| KI-017 | Medium | F-03 deactivation did not revoke devices or stop the scheduler | Fixed `439792b`; four behaviours regression-tested |
| KI-020 | Low | F-06 no rate limiter on `/agent/enroll/poll` | Behind `createPublicRateLimiter('agent-poll')`; limiter headers asserted |

### 6.3 Open defects

| ID | Severity | Defect | Owner | Next step |
|---|---|---|---|---|
| KI-003 | Medium | Original exam PDF absent; blueprint authoritative | A1/A0 | Human supplies the PDF for a final delta check |
| KI-005 | **High (pending)** | Windows/Linux X11 real window management unverified | A7/H | Execute T-100/T-102 on real desktops, record evidence in §5 |
| KI-009 | Medium | `AGENT_HEADLESS=1` creates no renderer window, so no display-less pairing E2E | A7 | Offscreen test window or test-only state file/IPC; Linux CI uses `xvfb-run` meanwhile |
| KI-018 | Low | F-04 enroll-poll state oracle (410 vs 404 after consumption) | A5 | Return 404 on mismatched secret even after consumption |
| KI-021 | Low | F-07 `.gitleaks.toml` allowlists `*.md` | A10/A0 | Narrow the allowlist to the docs that intentionally quote examples (W7 in progress) |

KI-019 (F-05, stateless tokens) is counted under **accepted** rather than open: it is a documented design
choice with a stated optional hardening path, not an untriaged defect.

---

## 7. How to reproduce (exact commands)

All commands run from the repository root unless stated. On a normal machine **no environment variables
are needed**; the four `export`s at the end exist only for the sandboxed dev box described in §1.3.

### 7.1 Install, configure, seed

```bash
# 1. install from the committed lockfile
npm ci                     # or `npm install` on a dev box (sandbox: npm_config_cache=$PWD/.npmcache)
npm run build -w @focus-mode/shared     # one-time; also run by pretest/predev

# 2. environment files (gitignored)
cp server/.env.example server/.env
cp client/.env.example client/.env
cp agent/.env.example agent/.env

# 3. real secrets — placeholders are public and must be replaced
openssl rand -base64 48                  # JWT_SECRET (run again for PAIR_PEPPER)
openssl genpkey -algorithm ED25519 -out attest-private.pem
openssl pkey -in attest-private.pem -pubout -out attest-public.pem
# paste ATTEST_PRIVATE_KEY / ATTEST_PUBLIC_KEY as one double-quoted line with literal \n

# 4. seed the DEC-013 demo data (idempotent; refuses production without --force)
npm run seed

# 5. run the whole stack: API :5000, dashboard :5173, Electron agent
npm run dev
```

### 7.2 Static gates and unit/integration tests

```bash
npm run lint
npm run format:check
npm run typecheck
npm run build
npm test                                   # 1204 tests at the W6 gate
```

### 7.3 Coverage (per workspace — v8 provider, no thresholds)

```bash
cd shared && npx vitest run --coverage && cd ..
cd server && npx vitest run --coverage && cd ..
cd client && npx vitest run --coverage && cd ..
cd agent  && npx vitest run --coverage && cd ..
```

### 7.4 End-to-end (real dashboard + real API + real Electron agent)

```bash
npm run build -w @focus-mode/shared
npm run build -w @focus-mode/agent
npx playwright install chromium

# normal machine / CI
npx playwright test

# sandboxed dev machine (KI-007): browsers + cache inside the workspace
PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test

# one spec, verbose
PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test e2e/perf.spec.ts --reporter=list
```

Expected: **47 passed, 0 skipped** (W6 gate). On a checkout missing W3/W5 feature files the self-gating
`test.fixme` fallbacks activate and report the exact missing piece (KI-012) — that is a signal, not a pass.

### 7.5 Agent smoke (the same check the release workflow runs)

```bash
node scripts/smoke/launch.mjs
# PASS = SMOKE_READY line + hello.paired=false + getState IDLE + self-exit 0 within 20 s
```

### 7.6 Real macOS focus verification (FOCUS-1 / FOCUS-2)

```bash
npx tsx scripts/verify/macos-focus-smoke.ts
# exit 0 → "PASS darwin/arm64" (hides + restores its own TextEdit, verified from a separate process)
```

### 7.7 Release build (installers, fuses, per-OS smoke)

```bash
# dry-run dispatch: builds + smoke, creates NO release (tag-only guard)
gh workflow run release.yml --ref main
gh run list --workflow release.yml --limit 1

# local unsigned macOS package + independent fuse/asar inspection
cd agent
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --publish never
npx @electron/fuses read --app "release/mac-arm64/Focus Mode Agent.app"
node build/flip-fuses.mjs release/mac-arm64
npx @electron/asar list "release/mac-arm64/Focus Mode Agent.app/Contents/Resources/app.asar"
```

### 7.8 Contract consistency check

```bash
node /tmp/a2-contracts/check.mjs       # 35/35 checks PASS (script lives in /tmp, NOT committed)
```

Honest caveat: that script is **not** in the repository, so this check is not reproducible from a fresh
clone; the recorded output is `docs/INTEGRATION_CONTRACTS.md` §11 (46/46 endpoints, 16/16 local + 6/6
cloud messages, 48/48 JSON examples). Making it a committed script is a W7/W9 tooling improvement.

### 7.9 Sandbox-only environment variables (KI-001/006/007/008)

```bash
export npm_config_cache=$PWD/.npmcache
export MONGOMS_DOWNLOAD_DIR=$PWD/node_modules/.cache/mongodb-memory-server
export PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers
export RATE_LIMIT_AGENT_REGISTER_MAX=50   # validated knob; production default stays 5/min/IP (DEC-025)
```

---

## 8. Verdict & readiness

### 8.1 Verdict

| Gate | Result | Basis |
|---|---|---|
| **W0–W6 wave gates** | **PASS** (recorded) | `docs/AGENT_STATUS.md` §5 — each with command + output evidence |
| **W7 quality** | **IN PROGRESS — not claimed** | coverage gaps, client bundle split, real-browser axe, CI/gitleaks history, two-run stability — no committed W7 evidence at `63c06d3`; uncommitted working-tree work observed at handoff |
| **W8 installers + Phase-8 sign-off** | **PARTIAL** | 4/4 targets built + 4/4 smoke green; Phase-8 human checklist **not signed** |
| **W9 submission / QA gate** | **PASS on the software scope; human-gated items remain** | no Open Critical; 1 Open High is an evidence gap on non-macOS desktops; 4 P2 features deliberately not built |
| **Release readiness** | **Not release-ready as a public multi-OS signed release** | unsigned artifacts, no tag, no live deployment |

### 8.2 What is genuinely ready for handoff

1. **The macOS P0 product path is real and proven**: login → pair a real Electron agent → live badge
   without reload → start focus with consent → countdown → protected apps hidden by the real OS driver →
   end/restore → session persisted, including crash recovery and scheduled starts.
2. **Test evidence is broad and current**: **1204** unit/integration tests, **47** E2E scenarios across
   **14** files (0 skipped), real-OS macOS probe, **148** adversarial security checks, **35/35** contract
   consistency checks, 4 CI targets with per-OS smoke.
3. **Security posture is defensible**: 0 Critical/High; the 3 Mediums fixed and regression-tested; 7 of 7
   hardened Electron fuses verified on packaged artifacts; accepted risks documented with citations.
4. **Measured quality targets are met**: NFR-011 p95 **7.22 ms** vs 300 ms; coverage **≥ 80 % lines in all
   four packages** (90–100 % on the three target scopes); a11y axe **0 violations** on 11 routes.
5. **Docs package is complete enough to hand over**: requirements traceability, contracts (46 endpoints,
   22 messages, C-1…C-26), decisions DEC-001…DEC-025, platforms matrix, deployment runbook, demo script,
   viva notes draft, known-issues register.

### 8.3 What is explicitly **not** ready — do not claim it

- **Windows and Linux support** — code + mocks + CI builds exist; real hide/restore has never been
  observed (KI-005, T-100/T-102).
- **The installed application** — no dmg/exe/AppImage was installed and launched; CI proves the packaged
  code boots, not the installer.
- **Signed/notarised distribution** — all artifacts unsigned; no public download link; no tag release.
- **A live deployment** — NFR-017 is local-only; deployed latency, TLS, CORS, real-IP rate limiting and
  Safari/LNA behaviour are unmeasured.
- **Native tray/notification/consent visuals** — machine-readable contracts are asserted; the pixels are
  not.
- **"1204 tests prove the product works"** — they prove the enumerated behaviours on this machine and in
  CI; they do not prove unexercised OS interactions, and the focus E2E intentionally runs the FakeDriver.
- **4 P2 bonus requirements (FR-015…FR-018)** were not built.
- **The PDF was never available**, so requirement fidelity is against the blueprint (KI-003).

### 8.4 Honest residual risk after handoff

The product is strongest where it was tested and weakest exactly where the exam's own constraints put the
boundary: one real OS (macOS), one browser engine (Chromium), one host (loopback). A reviewer should treat
the macOS arm64 demo path as demonstrated, the Windows/Linux paths as *implemented and contract-tested but
unobserved*, and anything about signing, installation or hosting as *not done*. None of those gaps hides a
known failure: every one is registered in §5/§6 with the evidence that would close it.

### 8.5 Sign-off block

| Field | Value |
|---|---|
| Prepared by | **A9 — QA & Security Engineer** |
| Task | `task-52` (W9-QA-Report) |
| Tree head reviewed | `63c06d3` on `main` |
| Branch for this deliverable | `feat/a9-w9-qa` |
| Commit subject | `docs(qa): add comprehensive QA report` |
| Files written | `docs/QA_REPORT.md` (this file) only — no source, config or test edits |
| Suites re-run for this task | **None** (parallel W7 workers own the tree); all figures are quoted from recorded evidence |
| Status | Handoff draft — pending the human Phase-8 checklist (T-100/T-101/T-102) and W7 close-out |

---

## Appendix A — Number provenance (every figure in this report)

| Figure | Value | Source |
|---|---|---|
| Unit/integration tests | **1204** = 175 shared + 345 server + 171 client + 513 agent (92 files) | `docs/QA_NOTES.md` §3 + §6; `docs/AGENT_STATUS.md` W6 gate |
| Coverage lines | shared 100.00 · server 89.44 · client 80.70 · agent 88.63 | `docs/QA_NOTES.md` §3/§6 (v8 provider) |
| Target scopes | `shared` 100 · `server/services` 91.87 · `agent/focus` 90.88 (vs 80 % target) | `docs/QA_NOTES.md` §3 |
| E2E | **47/47 passed, 0 skipped, 14 files, 4.7 min** | `docs/AGENT_STATUS.md` W6 gate row |
| E2E per-file counts | admin 3, api-sessions 4, focus 1, insights 2, notifications 2, pairing 1, perf 1, reconnect 1, schedule 2, security 8, session-reporting 1, settings 3, smoke 8, viewport 10 | counted from the 14 `e2e/*.spec.ts` files committed at `63c06d3` (`viewport` generates 10 from 3 looped groups × 3 viewports + 1); the W7 `e2e/a11y.spec.ts` is untracked and not counted |
| NFR-011 | worst p95 **7.22 ms** (`GET /insights?range=7d`), 10 endpoints × **200** requests | `docs/QA_NOTES.md` §1 (`e2e/perf.spec.ts`) |
| Bundle | 987.8 KiB JS / 284.8 KiB gzip; total 1018.8 / 291.6 KiB | `docs/QA_NOTES.md` §2 |
| Security checks | **148** = 132 PASS / 16 FAIL at snapshot; **0 Critical / 0 High** | `docs/SECURITY_REVIEW.md` §2 + Appendix A |
| Findings | F-01…F-07; F-01/02/03/06 fixed (`439792b`), F-04/07 open Low, F-05 accepted | `docs/SECURITY_REVIEW.md` §4/§8 |
| Fuses | **7** required states, verified on packaged artifacts; macOS/Windows CI gate, asar gate all OSes | `docs/RELEASING.md` §11.1–11.3 |
| Release runs | `42858934575` (first installers) · `42873654284` (fuses/asar gates) — 4/4 builds + 4/4 smoke, 0 releases | `docs/AGENT_STATUS.md` W4/W6; `docs/PLATFORMS.md` §6 |
| Requirements | **55** rows = 30 FR + 17 NFR + 8 REC → 39 ✅ / 12 🟡 / 4 📋 | `docs/REQUIREMENT_TRACEABILITY.md` §18 (+ W6 upgrades marked above) |
| Contracts | **46** endpoints, 16 local + 6 cloud = **22** messages, 9 collections, 13 error codes, C-1…C-26, **35/35** checks | `docs/INTEGRATION_CONTRACTS.md` §10/§11/§12 |
| Decisions | DEC-001 … DEC-025 (25 ADRs) | `docs/DECISIONS.md` |
| Known issues | **21** (KI-001…KI-021): 5 fixed, 5 mitigated, 6 accepted, 5 open | `docs/KNOWN_ISSUES.md` |
| CI | validate on **3** OSes (Node 22); release on **4** native targets + **4** smoke jobs | `.github/workflows/ci.yml`, `release.yml` |
| macOS real OS | **`PASS darwin/arm64`** (FOCUS-1/FOCUS-2, exit 0) | `docs/PLATFORMS.md` §2/§8, DEC-020 |
| a11y | axe **0 violations** across **11** routes | `docs/AGENT_STATUS.md` W6 gate; DEC-025 |

## Appendix B — Source documents read for this report

`docs/AGENT_STATUS.md` (wave gates W0–W6, §0 environment, evidence rows) · `docs/QA_NOTES.md` (NFR-011,
bundle, coverage, E2E) · `docs/SECURITY_REVIEW.md` (independent review, §8 re-verification) ·
`docs/KNOWN_ISSUES.md` (KI-001…KI-021) · `docs/REQUIREMENT_TRACEABILITY.md` §18 (55 requirement rows) ·
`docs/INTEGRATION_CONTRACTS.md` (endpoints, messages, C-1…C-26, §11 checks) · `docs/PLATFORMS.md`
(per-OS + installer matrix + Phase-8) · `docs/DECISIONS.md` (DEC-001…DEC-025) · `docs/RELEASING.md`
(§11 fuses/asar, §2 dispatch) · `.github/workflows/ci.yml` + `release.yml` · `package.json` manifests ·
`e2e/*.spec.ts` · `scripts/smoke/launch.mjs` · `scripts/verify/macos-focus-smoke.ts` ·
`git log --oneline --no-merges` (60 commits, feature branches, no AI trailers).
