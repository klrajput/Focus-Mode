# RELEASE_NOTES.md — Focus Mode 0.1.0 (DRAFT)

> **STATUS: DRAFT — maintainer edits this file before pushing the `v0.1.0` tag.** No tag has been pushed and **no GitHub Release exists**; there are no public download URLs yet. Every number below is traceable to a command/run recorded in this repo (sources per section). The maintainer must re-run the final checks, choose the release date, and only then tag.
>
> **Version:** `0.1.0` (workspace packages `@focus-mode/shared|server|client` and the Focus Agent app) · **Protocol:** `focus.v1`, contracts frozen at tag `contracts-v1` · **Draft prepared:** at the W6 gate (`docs/AGENT_STATUS.md`).

## 1. Highlights

Focus Mode is a MERN dashboard plus a locally installed Electron **Focus Agent**: a user pairs their own computer, starts a timed focus session, and the agent moves other foreground apps aside while browsers and allow-listed apps stay usable — then restores everything. The dashboard never touches the OS; the cloud cannot command focus.

`0.1.0` is the **exam release candidate**: all P0/P1 features are implemented and verified, the W6 hardening gate passed (security review with no Critical/High, accessibility, performance, coverage, Electron fuses), and the remaining work before tagging is **human verification on real desktops** (Phase-8 checklists) plus signing/deployment decisions. P2 bonus items are **not** part of this release.

## 2. What is included (by wave)

| Wave | Delivered | Verification at the gate |
|---|---|---|
| **W0** | Monorepo (npm workspaces, TS 5.9.3, ESLint 10, Prettier); frozen `shared` contracts (protocol, zod schemas, error codes, protected set); integration contracts; `.env.example` files; UX spec; traceability doc | contracts tag `contracts-v1`; shared 175 tests; lint/typecheck/build green |
| **W1** | Server skeleton + auth (bcrypt 12, HS256 JWT, roles, rate limits); 9 Mongoose models + idempotent seed; client shell + all routes/role guards + API transport; Electron agent skeleton, loopback link server, atomic journal, protected matcher, FakeDriver | server 77 → models/seed tests; 353 tests total; real headless Electron smoke |
| **W2** | Code pairing (DEC-014 two-stage digest, TTL, attempt latch, device tokens), EdDSA attestation (DEC-016), cloud `/agent-link` hub (heartbeat/45 s timeout), agent cloud client (`safeStorage`, reconnect), client `AgentLink` + live badge + `/devices` UI | real E2E: real Electron agent → real code → CONNECTED badge; 507 tests |
| **W3** | Real `FocusController` (journal-first, idempotent restore, sleep/crash recovery, enforcement loop), native consent (REC-004), Win32/macOS/Linux-X11 drivers, agent window/tray controls, client start/consent/countdown/global indicator, sessions/allow-list/schedules APIs, F-01 copy fixes, KI-010 refresh fix | **real macOS hide/restore `PASS darwin/arm64`**; focus E2E; 844 tests |
| **W4** | Timezone/DST scheduler + schedule runs + reaper + notifications; dashboard-closed session reporting (FR-027); dashboard/allow-list/schedules pages; packaging (NSIS/dmg/AppImage/deb) + release workflow + first real installers | real-scheduler E2E; release run `42858934575` 4/4 builds + 4/4 smoke; 1015 tests |
| **W5** | Insights (fixtures, timezone, streaks), notifications bell, settings/profile/password/unpair-all, admin (users/presets/agent-links/aggregate-only stats), landing | 27/27 E2E, 0 skipped; 1128 tests; missed-run E2E un-gated |
| **W6** | Security hardening (A9 adversarial review, 3 Mediums fixed, C-26 nonce replay cache); agent reconnect/auth-race hardening + Electron fuses; a11y fixes (axe 0 violations); viewport/a11y/security/perf E2E specs; NFR-011 measurement; coverage measurement; real-artifact fuses/asar gates | **1204 tests · 47/47 E2E · 0 Critical/High · coverage ≥80 % lines everywhere · p95 7.22 ms · fuses verified on artifacts** |
| W7 (next) | Quality only: coverage gaps, client route-level bundle split, flake hardening, full-history secret scan | not part of 0.1.0 feature scope |
| W8–W9 | Phase-8 human evidence, signing/tag/release, live deployment, `QA_REPORT`, final `PROMPTS.md`/viva/demo | **NEEDS-HUMAN — see §6** |

## 3. Requirements coverage (honest summary)

Full traceability: [`docs/REQUIREMENT_TRACEABILITY.md`](docs/REQUIREMENT_TRACEABILITY.md) §18 (18 PDF IDs → 30 FR / 17 NFR / 8 REC → tasks → evidence).

- ✅ **Verified:** every P0/P1 feature, including AUTH-1, PAIR-1, LINK-1, FOCUS-1/2/3, SAFE-1/2, SESS-1, SCHED-1, ANALYTICS-1, RECONN-1, X-PLAT-1 (macOS real; Windows/Linux code + contract/CI only), plus the W5 pages and the W6 security/a11y/perf targets.
- 🟡 **Partially verified (NEEDS-HUMAN part named):** AGENT-1/FR-002/FR-022 (native tray/notification *visuals*, KI-013), REC-004/REC-008 (native dialog/tray toggle visuals, KI-011/KI-013), FR-011 Windows/Linux **runtime** window control (KI-005), NFR-017 (live deployment), NFR-015 (every human in git history).
- 📋 **Not included (P2, post-release):** BLOCK-1, POMO-1, MULTI-1, GAMIFY-1 (W10, only after W9 is green).

## 4. Packages and artifacts

### 4.1 Code

- `shared/` — frozen `focus.v1` protocol + zod schemas + error codes + protected set (single contract for all packages).
- `server/` — Express 5 API `/api/v1` (46 operations) + `/agent-link` WebSocket hub + scheduler/reaper.
- `client/` — React dashboard (13 routes, role guards, live agent status).
- `agent/` — Electron Focus Agent 45 (`productName: "Focus Mode Agent"`, `appId: com.focusmode.agent`), per-OS `FocusDriver`, hardened fuses.

### 4.2 Installers produced by CI (real, unsigned)

CI release workflow **dispatch run `42873654284`** (recorded at the W6 gate): **4/4 build jobs + 4/4 `AGENT_SMOKE` jobs green**, **fuses/asar gates PASS**, `publish draft GitHub release` **skipped → 0 GitHub Releases**. The files below are **workflow artifacts**, not published assets; download links will exist only after a maintainer pushes the tag (see §6).

| OS | File | Bytes | sha256 |
|---|---|---|---|
| Windows x64 | `focus-mode-agent-0.1.0-win-setup.exe` | 122,374,953 | `0f117d118b9c0fb8376eaa8aa4cd773377c3cd8147faada20de4f0204e930c44` |
| Windows x64 | `focus-mode-agent-0.1.0-win-portable.exe` | 111,031,005 | `81e1dc34b5c0b250a4a9b1426bd224248ca892daf063e7a446f8e7b2494f66cf` |
| macOS arm64 | `focus-mode-agent-0.1.0-mac-arm64.dmg` | 121,218,816 | `74b99cb2a0c4d011105bf6257358b6c714a074ae0f7e9e62b67b15cf46b9d211` |
| macOS arm64 | `focus-mode-agent-0.1.0-mac-arm64.zip` | 117,687,115 | `475ca59d3a60188314460784e4ed0e79be61f0016e6f0cfda3c2a5741111ca2a` |
| macOS x64 | `focus-mode-agent-0.1.0-mac-x64.dmg` | 128,118,216 | `35e76a7fb926d2d663cbc557e2a36db852508b409d6d49acc18d47edc06e0a76` |
| macOS x64 | `focus-mode-agent-0.1.0-mac-x64.zip` | 124,581,952 | `bd43cb8ba7276bee1cb86e4ae0c92588174423ec903fe4f481e401058317137f` |
| Linux x64 | `focus-mode-agent-0.1.0-linux-x86_64.AppImage` | 127,553,346 | `32f1a1b220b52d19f833b3e8240aa3d8a4d135d0b8e3a454afe056f2a4737449` |
| Linux x64 | `focus-mode-agent-0.1.0-linux-amd64.deb` | 101,889,864 | `b22027f06c90e50abd22d6787becba34fa1a505ebeaa40c5f4a44767cdc45456` |

Verify before installing: Windows `Get-FileHash .\focus-mode-agent-0.1.0-win-setup.exe -Algorithm SHA256`; macOS `shasum -a 256 …`; Linux `sha256sum …`. Install steps (including the unsigned SmartScreen/Gatekeeper paths) are in [`docs/RELEASING.md`](docs/RELEASING.md) §6 and the executable checklists in [`docs/QA_CHECKLISTS.md`](docs/QA_CHECKLISTS.md) §2.

## 5. Verification evidence

| Evidence | Command / document | Result |
|---|---|---|
| Unit + API integration | `npm test` | **1204/1204** — shared 175 · server 345 · client 171 · agent 513 |
| E2E (real dashboard + API + Electron agent) | `PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test` | **47/47 passed, 0 skipped** |
| Coverage (80 % lines target) | `npx vitest run --coverage` per workspace | shared 100 % · server 89.44 % · client 80.70 % · agent 88.63 % |
| API latency (NFR-011) | `npx playwright test e2e/perf.spec.ts` | worst p95 **7.22 ms** vs 300 ms (loopback) |
| Security (SEC-1…SEC-10, INV-2/3/6) | [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md) | **0 Critical / 0 High**; 3 Medium fixed & regression-tested; 2 Low + 1 accepted documented |
| Accessibility (NFR-008) | `e2e/a11y.spec.ts` | axe **0 violations across 11 routes** |
| Real-OS focus core (macOS) | `npx tsx scripts/verify/macos-focus-smoke.ts` | `PASS darwin/arm64` (hide → separate-process verify → journal clear → idempotent exit → restore) |
| Electron hardening (SEC-8) | CI fuses/asar gates + `node scripts/verify/verify-fuses.mjs "<artifact>"` | fuses hardened on the real CI artifacts |
| Measurements detail | [`docs/QA_NOTES.md`](docs/QA_NOTES.md) | commands, per-endpoint table, caveats |

Test credentials for the demo (seeded by `npm run seed`): `admin@demo.com / Admin@123` (ADMIN) and `kabir@demo.com / Kabir@123` (USER). **Rotate these before exposing the app on a public URL.**

## 6. Known limitations (documented, not hidden)

| Limitation | Detail / tracking |
|---|---|
| Windows + Linux **runtime** window control | Implemented behind the frozen `FocusDriver` and covered by mocked-native contract suites + CI builds, but real hide/restore on those desktops is **NEEDS-HUMAN** (KI-005). macOS arm64 is the verified real OS. |
| Native tray menus, consent dialog, scheduled heads-up visuals | Native surfaces cannot be driven/read by Playwright (KI-011, KI-013); the controller path and machine-readable frames are E2E-covered. Human checklists: [`docs/QA_CHECKLISTS.md`](docs/QA_CHECKLISTS.md). |
| Unsigned installers | SmartScreen/Gatekeeper warnings until signing certificates are supplied; signed path is optional and not exercised (`docs/RELEASING.md` §5–§6). |
| Installer-level launch not verified | CI proves the packaged code + Electron boot headless and fuse/asar integrity, not that the installed dmg/exe/AppImage launches. Needs Phase-8. |
| Safari + HTTPS dashboard | Safari blocks `ws://127.0.0.1` from an HTTPS page; use Chrome/Edge/Firefox (which may show a one-time local-network prompt). |
| Linux Wayland | Unsupported: `capabilities.focus = "unsupported"`, dashboard blocks Start with the reason. X11 needs `wmctrl`/`xdotool`. |
| Windows elevated windows | UIPI prevents moving elevated windows from a non-elevated agent; they are skipped and reported in capabilities. |
| Free-tier hosting | An idle free API can sleep and silently skip a scheduler minute; use an always-on tier or a keep-alive ping for demos (`docs/DEPLOYMENT.md` §4.2). |
| Open Low/accepted issues | KI-018 (enroll-poll state oracle, Low), KI-019 (stateless 30-min access token not invalidated by logout/password change — accepted), KI-021 (gitleaks `*.md` allowlist, Low). No Open Critical/High. |
| Client bundle size | One ~1 MB JS chunk (Recharts/motion/router), no NFR threshold; route-level code splitting is a W7 quality item (`docs/QA_NOTES.md` §2). |

## 7. NEEDS-HUMAN before tagging (release gate)

1. **Phase-8 manual verification** on real desktops — execute [`docs/QA_CHECKLISTS.md`](docs/QA_CHECKLISTS.md) T-100 (Windows), T-101 (macOS), T-102 (Linux X11), capture evidence, compile `docs/QA_REPORT.md` (A9).
2. **Signing decision + certificates** (optional but recommended): Apple Developer ID/notarisation and a Windows code-signing cert; otherwise ship unsigned with the documented steps.
3. **Tag + publish**: maintainer edits this file (date, final numbers, known issues), pushes `v0.1.0`; the release job creates a **draft** GitHub Release — review assets and `SHA256SUMS.txt` before publishing.
4. **Deployment (optional):** provide the accounts/Atlas URI and run [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md); or present the documented local fallback, which `[PDF §19]` permits.
5. **Demo + submission docs:** record the video per [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md); finalise `PROMPTS.md`, viva notes and README links once tags/URLs exist.
6. **Authorship:** every human team member must appear in the commit history from their own account (`git shortlog -sn`) — no AI/bot identities, no trailers.

## 8. How to verify this release candidate yourself

```sh
git checkout main                     # release-candidate commit (maintainer specifies)
npm install
npm run build -w @focus-mode/shared
npm test                              # expect 1204/1204
npm run build
PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test   # expect 47/47, 0 skipped
npx tsx scripts/verify/macos-focus-smoke.ts    # macOS only: expect PASS darwin/arm64
node scripts/smoke/launch.mjs                  # headless AGENT_SMOKE boot: expect PASS
```

Then follow [`docs/QA_CHECKLISTS.md`](docs/QA_CHECKLISTS.md) for the real-desktop checks and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) if deploying.

## 9. Upgrade, uninstall and compatibility

- **Version compatibility:** dashboard, API and Focus Agent are released together as `0.1.0`; protocol `focus.v1` is frozen. A newer agent against an older API (or vice versa) is not supported within this draft.
- **Auto-update:** not implemented in `0.1.0` (`electron-updater` was optional/P2 in the blueprint).
- **App data:** the journal, consent, settings and the stored device token live in the OS app-data directory. Uninstall **keeps** app data by design (`deleteAppDataOnUninstall: false`); remove it manually for a full reset (`%APPDATA%\Focus Mode Agent`, `~/Library/Application Support/Focus Mode Agent`, `~/.config/Focus Mode Agent`).
- **Rollback:** never rewrite a published tag — fix forward with a new patch tag; see [`docs/RELEASING.md`](docs/RELEASING.md) §7.

## 10. What's next after 0.1.0

- **W7 (in progress):** close coverage gaps (e.g. `server/src/utils/jwt-eddsa.ts`, a few client pages at 0 %), route-level client bundle split, flake hardening, full-history secret scan.
- **W8:** execute the Phase-8 checklists and file the evidence (moves Windows/Linux runtime + native visuals from 🟡 to ✅ where proven).
- **W9:** final release (signing, tag, GitHub Release, deployment), `QA_REPORT`, demo recording, viva/PROMPTS finalisation.
- **W10 (post-0.1.0):** P2 bonus — browser block-list (MV3), Pomodoro, multi-device, gamification.

---

**Draft checklist for the maintainer before tagging**

- [ ] Final `npm test` + E2E + coverage + macOS smoke re-run on the exact release commit (paste results here)
- [ ] `docs/QA_REPORT.md` compiled from the Phase-8 evidence; no open Critical/High
- [ ] `docs/SECURITY_REVIEW.md` §8 still accurate for the release commit
- [ ] Signing decision recorded; `RELEASING.md` verification-status table updated
- [ ] Release date added above; version bumped if needed (`0.1.0` → final)
- [ ] This file's draft banner removed; no invented URLs — GitHub Release URL added after publishing
- [ ] README + docs links updated if the repo/tag URLs or deployment URL become real
