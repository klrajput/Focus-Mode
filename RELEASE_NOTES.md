# RELEASE_NOTES.md — Focus Mode 0.1.0 (DRAFT)

> **STATUS: DRAFT — maintainer edits this file before pushing the `v0.1.0` tag.** No tag has been pushed and **no GitHub Release exists**; there are no public download URLs yet. Every number below is traceable to a command/run recorded in this repo (sources per section). The maintainer must re-run the final checks, choose the release date, and only then tag.
>
> **Version:** `0.1.0` (workspace packages `@focus-mode/shared|server|client` and the Focus Agent app) · **Protocol:** `focus.v1`, contracts frozen at tag `contracts-v1` · **Draft prepared:** at the **W7 gate** (`docs/AGENT_STATUS.md`), refreshed in the W9 documentation pass.

## 1. Highlights

Focus Mode is a MERN dashboard plus a locally installed Electron **Focus Agent**: a user pairs their own computer, starts a timed focus session, and the agent moves other foreground apps aside while browsers and allow-listed apps stay usable — then restores everything. The dashboard never touches the OS; the cloud cannot command focus.

`0.1.0` is the **exam release candidate**: all P0/P1 features are implemented and verified, the **W6 hardening gate** and the **W7 quality gate** both passed (security review with no Critical/High, real-browser accessibility, performance, coverage ≥80 % lines in every package, route-level bundle split, full-history secret scan, packaged-artifact smoke), and the remaining work before tagging is **human verification on real desktops** (Phase-8 checklists) plus the signing/tag/deployment decisions — a maintainer-only runbook is in [`docs/RELEASE_HANDOFF.md`](docs/RELEASE_HANDOFF.md). P2 bonus items are **not** part of this release: W10 delivered **T-133 as a partial** (achievement badges + a device-local weekly goal on `/insights`; **no leaderboard**) and **descoped T-130/T-131/T-132** with recorded reasons ([`docs/DECISIONS.md`](docs/DECISIONS.md) DEC-027).

## 2. What is included (by wave)

| Wave             | Delivered                                                                                                                                                                                                                                                                                                                                                                                                              | Verification at the gate                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W0**           | Monorepo (npm workspaces, TS 5.9.3, ESLint 10, Prettier); frozen `shared` contracts (protocol, zod schemas, error codes, protected set); integration contracts; `.env.example` files; UX spec; traceability doc                                                                                                                                                                                                        | contracts tag `contracts-v1`; shared 175 tests; lint/typecheck/build green                                                                                                                                |
| **W1**           | Server skeleton + auth (bcrypt 12, HS256 JWT, roles, rate limits); 9 Mongoose models + idempotent seed; client shell + all routes/role guards + API transport; Electron agent skeleton, loopback link server, atomic journal, protected matcher, FakeDriver                                                                                                                                                            | server 77 → models/seed tests; 353 tests total; real headless Electron smoke                                                                                                                              |
| **W2**           | Code pairing (DEC-014 two-stage digest, TTL, attempt latch, device tokens), EdDSA attestation (DEC-016), cloud `/agent-link` hub (heartbeat/45 s timeout), agent cloud client (`safeStorage`, reconnect), client `AgentLink` + live badge + `/devices` UI                                                                                                                                                              | real E2E: real Electron agent → real code → CONNECTED badge; 507 tests                                                                                                                                    |
| **W3**           | Real `FocusController` (journal-first, idempotent restore, sleep/crash recovery, enforcement loop), native consent (REC-004), Win32/macOS/Linux-X11 drivers, agent window/tray controls, client start/consent/countdown/global indicator, sessions/allow-list/schedules APIs, F-01 copy fixes, KI-010 refresh fix                                                                                                      | **real macOS hide/restore `PASS darwin/arm64`**; focus E2E; 844 tests                                                                                                                                     |
| **W4**           | Timezone/DST scheduler + schedule runs + reaper + notifications; dashboard-closed session reporting (FR-027); dashboard/allow-list/schedules pages; packaging (NSIS/dmg/AppImage/deb) + release workflow + first real installers                                                                                                                                                                                       | real-scheduler E2E; release run `42858934575` 4/4 builds + 4/4 smoke; 1015 tests                                                                                                                          |
| **W5**           | Insights (fixtures, timezone, streaks), notifications bell, settings/profile/password/unpair-all, admin (users/presets/agent-links/aggregate-only stats), landing                                                                                                                                                                                                                                                      | 27/27 E2E, 0 skipped; 1128 tests; missed-run E2E un-gated                                                                                                                                                 |
| **W6**           | Security hardening (A9 adversarial review, 3 Mediums fixed, C-26 nonce replay cache); agent reconnect/auth-race hardening + Electron fuses; a11y fixes (axe 0 violations); viewport/a11y/security/perf E2E specs; NFR-011 measurement; coverage measurement; real-artifact fuses/asar gates                                                                                                                            | **1204 tests · 47/47 E2E · 0 Critical/High · coverage ≥80 % lines everywhere · p95 7.22 ms · fuses verified on artifacts**                                                                                |
| **W7**           | Quality gate (no product/wire change): +217 behaviour tests closing the coverage gaps; real-browser axe spec; route-level `React.lazy` + vendor chunks (8 lazy routes, accessible Suspense fallback); flake determinism fixes; full-history secret scan with the blanket Markdown exemption removed (KI-021); packaged-artifact smoke in the release workflow; `QA_REPORT`/`QA_CHECKLISTS`/README/traceability refresh | **1421 tests · 50/50 E2E twice (retries 0) · coverage ≥80 % lines everywhere (94.31/87.45/93.13) · axe 0/14 routes · entry −83.6 % · gitleaks 140/104 no leaks · packaged smoke 4/4 (run `42977816541`)** |
| W8–W9            | Submission items — **human-gated**: Phase-8 real-desktop evidence (`docs/QA_CHECKLISTS.md`), signing decision, first `v*` tag + draft release, live deployment, demo recording                                                                                                                                                                                                                                         | **NEEDS-HUMAN — see §7 and [`docs/RELEASE_HANDOFF.md`](docs/RELEASE_HANDOFF.md)**                                                                                                                         |
| W10 (post-0.1.0) | P2 per **DEC-027**: **T-133 partial** — achievement badges + device-local weekly goal on `/insights` (no leaderboard); **T-130/T-131/T-132 descoped**                                                                                                                                                                                                                                                                  | not part of the 0.1.0 feature scope; descope reasons in [`docs/DECISIONS.md`](docs/DECISIONS.md) DEC-027                                                                                                  |

## 3. Requirements coverage (honest summary)

Full traceability: [`docs/REQUIREMENT_TRACEABILITY.md`](docs/REQUIREMENT_TRACEABILITY.md) §18 (18 PDF IDs → 30 FR / 17 NFR / 8 REC → tasks → evidence).

- ✅ **Verified:** every P0/P1 feature, including AUTH-1, PAIR-1, LINK-1, FOCUS-1/2/3, SAFE-1/2, SESS-1, SCHED-1, ANALYTICS-1, RECONN-1, X-PLAT-1 (macOS real; Windows/Linux code + contract/CI only), plus the W5 pages and the W6 security/a11y/perf targets.
- 🟡 **Partially verified (NEEDS-HUMAN part named):** AGENT-1/FR-002/FR-022 (native tray/notification _visuals_, KI-013), REC-004/REC-008 (native dialog/tray toggle visuals, KI-011/KI-013), FR-011 Windows/Linux **runtime** window control (KI-005), NFR-017 (live deployment), NFR-015 (every human in git history).
- 📋 **Not included (P2, post-release):** BLOCK-1, POMO-1, MULTI-1 are **descoped** (DEC-027) and **not claimed**; GAMIFY-1 is a **partial** delivery — badges + a device-local weekly goal, **no leaderboard** (DEC-027, traceability §18 FR-018). No P2 item is part of the 0.1.0 feature scope.

## 4. Packages and artifacts

### 4.1 Code

- `shared/` — frozen `focus.v1` protocol + zod schemas + error codes + protected set (single contract for all packages).
- `server/` — Express 5 API `/api/v1` (46 operations) + `/agent-link` WebSocket hub + scheduler/reaper.
- `client/` — React dashboard (13 routes, role guards, live agent status).
- `agent/` — Electron Focus Agent 45 (`productName: "Focus Mode Agent"`, `appId: com.focusmode.agent`), per-OS `FocusDriver`, hardened fuses.

### 4.2 Installers produced by CI (real, unsigned)

CI release workflow **dispatch run `42977816541`** (the W7-gate dry run): **4/4 build jobs green**, **fuses/asar gates PASS**, **4/4 `AGENT_SMOKE`**, **4/4 packaged-artifact smoke** (the packaged app itself booted and served `hello`/`state` on macOS arm64/x64 `.app`, Linux `squashfs-root` and Windows `win-unpacked`), `publish draft GitHub release` **skipped → 0 GitHub Releases**. The files below are **workflow artifacts**, not published assets; download links will exist only after a maintainer pushes the tag (see §7 and [`docs/RELEASE_HANDOFF.md`](docs/RELEASE_HANDOFF.md) §4–§5).

| OS          | File                                           | Bytes       | sha256                                                             |
| ----------- | ---------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| Windows x64 | `focus-mode-agent-0.1.0-win-setup.exe`         | 122,376,423 | `62b132c46f5922dd18f142929ff5a2aa79e43636d2a3785743b9843b3ee8c7ee` |
| Windows x64 | `focus-mode-agent-0.1.0-win-portable.exe`      | 111,031,696 | `625624bada9ddd36e545ca5ebbff024d159ac7b9e8bac782b6d0493e9373ec2e` |
| macOS arm64 | `focus-mode-agent-0.1.0-mac-arm64.dmg`         | 121,227,810 | `803a19540b1f41def8fb8f479e23ca0a88c093aca65f5b60c898c46263ec564d` |
| macOS arm64 | `focus-mode-agent-0.1.0-mac-arm64.zip`         | 117,688,896 | `b4aa3bcedb986343cdc84a717d637903d31142100d6eb5a484fa046cd08514d1` |
| macOS x64   | `focus-mode-agent-0.1.0-mac-x64.dmg`           | 128,119,814 | `ed5b38f2d72efecef631666a8e830a37412c4485058ec554ccb05ba3657730ee` |
| macOS x64   | `focus-mode-agent-0.1.0-mac-x64.zip`           | 124,583,735 | `dcb683c040d051f4becacf3674b8354db9349ff46bec1b3a32b7c49d788ea8eb` |
| Linux x64   | `focus-mode-agent-0.1.0-linux-x86_64.AppImage` | 127,553,381 | `6ba501ae7b05bf563fe45aa75c56b095da297382a58c74e9a943675696fd058a` |
| Linux x64   | `focus-mode-agent-0.1.0-linux-amd64.deb`       | 101,891,560 | `9db95680ca884aeecb00349b2347e290a5a47e95f72090a0a72f00009960e3dc` |

These sizes/hashes are **reproducible from the dry run only** (`docs/RELEASE_HANDOFF.md` §4 records them from the run's own CI verification step): a real `v0.1.0` tag **rebuilds** the installers with the final version, so the maintainer must re-read sizes and sha256 from the tagged run before publishing. Verify before installing: Windows `Get-FileHash .\focus-mode-agent-0.1.0-win-setup.exe -Algorithm SHA256`; macOS `shasum -a 256 …`; Linux `sha256sum …`. Install steps (including the unsigned SmartScreen/Gatekeeper paths) are in [`docs/RELEASING.md`](docs/RELEASING.md) §6 and the executable checklists in [`docs/QA_CHECKLISTS.md`](docs/QA_CHECKLISTS.md) §2.

## 5. Verification evidence

| Evidence                                    | Command / document                                                                   | Result                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Unit + API integration                      | `npm test`                                                                           | **1421/1421** — shared 175 · server 450 · client 251 · agent 545                                                        |
| E2E (real dashboard + API + Electron agent) | `PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test`             | **50/50 passed, twice back-to-back, retries 0** (7.6 m / 7.0 m, 15 files)                                               |
| Coverage (80 % lines target)                | `npx vitest run --coverage` per workspace                                            | shared 100 % · server 94.31 % · client 87.45 % · agent 93.13 % lines (branch 95.45/85.07/79.09/81.70)                   |
| API latency (NFR-011)                       | `npx playwright test e2e/perf.spec.ts`                                               | worst p95 **7.22 ms** vs 300 ms (loopback); agent idle CPU/RAM remains a Phase-8 OS measurement                         |
| Security (SEC-1…SEC-10, INV-2/3/6)          | [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md)                                 | **0 Critical / 0 High**; 3 Medium fixed & regression-tested; 2 Low + 1 accepted documented                              |
| Supply chain (secret scan)                  | CI `gitleaks git` over the **full reachable history**                                | **140 commits reachable / 104 scanned / 3.75 MB / no leaks**; blanket `*.md` exemption removed (KI-021 fixed)           |
| Accessibility (NFR-008)                     | `e2e/a11y.spec.ts` (real Chromium, colour contrast on)                               | axe **0 serious/critical and 0 other violations across 14 routes**                                                      |
| Client bundle                               | `npm run build -w @focus-mode/client`                                                | entry **1,013.13 → 165.90 KiB raw (−83.6 %)**, eager **557.38 KiB / ~172 KiB gzip (−45 % / −41.6 %)**, no chunk >500 kB |
| Real-OS focus core (macOS)                  | `npx tsx scripts/verify/macos-focus-smoke.ts`                                        | `PASS darwin/arm64` (hide → separate-process verify → journal clear → idempotent exit → restore)                        |
| Electron hardening (SEC-8)                  | CI fuses/asar gates + `node scripts/verify/verify-fuses.mjs "<artifact>"`            | fuses hardened on the real CI artifacts of run `42977816541`                                                            |
| Packaged artifact boot                      | `node scripts/verify/smoke-packaged.mjs "<packaged app>"` (CI)                       | **4/4 PASS** — macOS `.app`, Linux `squashfs-root`, Windows `win-unpacked` (run `42977816541`)                          |
| Measurements detail                         | [`docs/QA_NOTES.md`](docs/QA_NOTES.md) §9 + [`docs/QA_REPORT.md`](docs/QA_REPORT.md) | commands, per-endpoint table, coverage/bundle caveats, two-run E2E evidence                                             |

Test credentials for the demo (seeded by `npm run seed`): `admin@demo.com / Admin@123` (ADMIN) and `kabir@demo.com / Kabir@123` (USER). **Rotate these before exposing the app on a public URL.**

## 6. Known limitations (documented, not hidden)

| Limitation                                                    | Detail / tracking                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows + Linux **runtime** window control                    | Implemented behind the frozen `FocusDriver` and covered by mocked-native contract suites + CI builds, but real hide/restore on those desktops is **NEEDS-HUMAN** (KI-005). macOS arm64 is the verified real OS.                                                |
| Native tray menus, consent dialog, scheduled heads-up visuals | Native surfaces cannot be driven/read by Playwright (KI-011, KI-013); the controller path and machine-readable frames are E2E-covered. Human checklists: [`docs/QA_CHECKLISTS.md`](docs/QA_CHECKLISTS.md).                                                     |
| Unsigned installers                                           | SmartScreen/Gatekeeper warnings until signing certificates are supplied; signed path is optional and not exercised (`docs/RELEASING.md` §5–§6).                                                                                                                |
| Installer-level launch not verified                           | W7 CI now proves the **packaged payload boots** (4/4 packaged-artifact smoke on `42977816541`: macOS `.app`, Linux `squashfs-root`, Windows `win-unpacked`), but not that the installed dmg/exe/AppImage launches from a desktop. Needs Phase-8.               |
| Safari + HTTPS dashboard                                      | Safari blocks `ws://127.0.0.1` from an HTTPS page; use Chrome/Edge/Firefox (which may show a one-time local-network prompt).                                                                                                                                   |
| Linux Wayland                                                 | Unsupported: `capabilities.focus = "unsupported"`, dashboard blocks Start with the reason. X11 needs `wmctrl`/`xdotool`.                                                                                                                                       |
| Windows elevated windows                                      | UIPI prevents moving elevated windows from a non-elevated agent; they are skipped and reported in capabilities.                                                                                                                                                |
| Free-tier hosting                                             | An idle free API can sleep and silently skip a scheduler minute; use an always-on tier or a keep-alive ping for demos (`docs/DEPLOYMENT.md` §4.2).                                                                                                             |
| Open Low/accepted issues                                      | KI-018 (enroll-poll state oracle, Low), KI-019 (stateless 30-min access token not invalidated by logout/password change — accepted). KI-021 (gitleaks `*.md` allowlist, Low) is **fixed at the W7 gate** — full-history scan, no leaks. No Open Critical/High. |
| Client bundle size                                            | **Improved at W7, no NFR threshold:** route-level split — entry 1,013.13 → 165.90 KiB raw (−83.6 %), eager 557.38 KiB / ~172 KiB gzip, largest chunk 368.95 KiB (`charts`, `/insights` only), no chunk >500 kB (`docs/QA_NOTES.md` §9).                        |
| P2 gamification is partial                                    | `0.1.0` does **not** include P2 bonus features. W10 shipped T-133 partially (badges + a device-local weekly goal on `/insights`, stored in this browser); **no leaderboard and no cross-user comparison** exist (DEC-027).                                     |

## 7. NEEDS-HUMAN before tagging (release gate)

The maintainer runbook with the exact commands is [`docs/RELEASE_HANDOFF.md`](docs/RELEASE_HANDOFF.md); the summary:

1. **Phase-8 manual verification** on real desktops — execute [`docs/QA_CHECKLISTS.md`](docs/QA_CHECKLISTS.md) T-100 (Windows), T-101 (macOS), T-102 (Linux X11) and file the evidence in [`docs/QA_REPORT.md`](docs/QA_REPORT.md).
2. **Signing decision + certificates** (optional but recommended): Apple Developer ID/notarisation and a Windows code-signing cert; otherwise ship unsigned with the documented SmartScreen/Gatekeeper steps (`docs/RELEASING.md` §5–§6). **This is a human decision — no certificate exists in this repo.**
3. **Tag + publish** — once (and only once) the human decides the release is ready, from a clean, up-to-date `main` whose `agent/package.json` version is `0.1.0`:
   ```sh
   git tag -a v0.1.0 -m "Focus Mode 0.1.0" && git push origin v0.1.0
   ```
   The tag workflow rebuilds the 8 installers, runs the fuses/asar gates and the packaged smoke, and creates a **draft** GitHub Release — review assets + `SHA256SUMS.txt`, then publish. Tags are maintainer-pushed only; **AI workers never run git**.
4. **Deployment (optional):** provide the accounts/Atlas URI and follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md); or present the documented local fallback, which `[PDF §19]` permits.
5. **Demo + submission docs:** record the video per [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md); finalise `PROMPTS.md`, viva notes and README links once tags/URLs exist.
6. **Authorship:** every human team member must appear in the commit history from their own account (`git shortlog -sn`) — no AI/bot identities, no trailers.

## 8. How to verify this release candidate yourself

```sh
git checkout main                     # release-candidate commit (maintainer specifies)
npm install
npm run build -w @focus-mode/shared
npm test                              # expect 1421/1421 (shared 175 · server 450 · client 251 · agent 545)
npm run build
PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test   # expect 50/50, retries 0 — run it twice
PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test e2e/a11y.spec.ts  # expect 0 violations, 14 routes
npx tsx scripts/verify/macos-focus-smoke.ts    # macOS only: expect PASS darwin/arm64
node scripts/smoke/launch.mjs                  # headless AGENT_SMOKE boot: expect PASS
```

Coverage per package (target 80 % lines): `(cd shared && npx vitest run --coverage)` … `(cd agent && npx vitest run --coverage)` — W7 measured shared 100 / server 94.31 / client 87.45 / agent 93.13 %. For a gate-quality E2E number, follow the stability policy in [`docs/QA_NOTES.md`](docs/QA_NOTES.md) §7 (quiet tree, fresh fixtures, retries 0, two green runs).

## 9. Upgrade, uninstall and compatibility

- **Version compatibility:** dashboard, API and Focus Agent are released together as `0.1.0`; protocol `focus.v1` is frozen. A newer agent against an older API (or vice versa) is not supported within this draft.
- **Auto-update:** not implemented in `0.1.0` (`electron-updater` was optional/P2 in the blueprint).
- **App data:** the journal, consent, settings and the stored device token live in the OS app-data directory. Uninstall **keeps** app data by design (`deleteAppDataOnUninstall: false`); remove it manually for a full reset (`%APPDATA%\Focus Mode Agent`, `~/Library/Application Support/Focus Mode Agent`, `~/.config/Focus Mode Agent`).
- **Rollback:** never rewrite a published tag — fix forward with a new patch tag; see [`docs/RELEASING.md`](docs/RELEASING.md) §7.

## 10. What's next after 0.1.0

- **W7 — done (quality only):** coverage gaps closed (+217 tests, every package ≥80 % lines), route-level client bundle split, real-browser axe spec, flake determinism, full-history secret scan, packaged-artifact smoke. No product or wire-format change.
- **W8:** execute the Phase-8 checklists and file the evidence (moves Windows/Linux runtime + native visuals from 🟡 to ✅ where proven).
- **W9 (this handoff):** signing decision, tag, draft GitHub Release, optional live deployment, `QA_REPORT`, demo recording, viva/PROMPTS finalisation — the maintainer runbook is [`docs/RELEASE_HANDOFF.md`](docs/RELEASE_HANDOFF.md).
- **W10 (post-0.1.0), per [`docs/DECISIONS.md`](docs/DECISIONS.md) DEC-027:** **T-133 partial shipped** — achievement badges + a device-local weekly goal on `/insights`, **no leaderboard**. **Descoped, not delivered:** T-130 browser block-list (MV3), T-131 Pomodoro/ambient sounds, T-132 remote multi-device start. These are **not** in `0.1.0` and this file does not claim them.

---

**Draft checklist for the maintainer before tagging**

- [ ] Final `npm test` + two E2E runs + coverage + macOS smoke re-run on the exact release commit (paste results here)
- [ ] `docs/QA_REPORT.md` reflects the Phase-8 evidence; no open Critical/High
- [ ] `docs/SECURITY_REVIEW.md` §8 still accurate for the release commit
- [ ] **Signing decision recorded** (Apple Developer ID/notarisation + Windows cert, or an explicit "ship unsigned"); `RELEASING.md` verification-status table updated
- [ ] **Tag command run once from a clean `main` with `agent/package.json` = `0.1.0`** (`git tag -a v0.1.0 -m "Focus Mode 0.1.0" && git push origin v0.1.0`) — maintainer only
- [ ] Draft release reviewed (8 assets + `SHA256SUMS.txt`) and **published**; the 8 public asset URLs re-read from the published release
- [ ] Release date added above; version bumped if needed (`0.1.0` → final); sizes/sha256 in §4.2 replaced with the **tagged** run's values
- [ ] **Deployment** done (or the documented local fallback recorded as the chosen path) + admin agent download links published (RELEASE_HANDOFF §6)
- [ ] This file's draft banner removed; **no invented URLs/dates** — GitHub Release URL added only after publishing
- [ ] README + docs links updated if the repo/tag URLs or deployment URL become real
