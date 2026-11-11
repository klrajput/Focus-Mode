# QA_CHECKLISTS.md — Phase-8 manual verification (T-100 / T-101 / T-102)

> **Owner:** A1 (checklists) · executed by any team member with access to the real OS · evidence compiled by A9 into `docs/QA_REPORT.md` · **W8 deliverable.**
> **Status:** every item below is **NEEDS-HUMAN** — Playwright can prove the controller, the protocol and the packaged-code boot, but it cannot prove that windows on a physical desktop really move and restore (KI-005), that native tray menus/notifications work (KI-013), or that an installed unsigned app launches (installer-level launch).
> **Rule: nothing may be ticked without evidence** (OS version, build id, screenshot/log, installer sha256). A FAIL is recorded, not explained away; it becomes a `docs/KNOWN_ISSUES.md` entry. If C5 or C6 fails, **stop** — that is a Critical/High class failure (focus stuck / irreversible).
> **Sibling docs:** [`PLATFORMS.md`](PLATFORMS.md) (per-OS behaviour + status matrix), [`RELEASING.md`](RELEASING.md) (build/sign/install), [`RELEASE_HANDOFF.md`](RELEASE_HANDOFF.md) (maintainer's final release checklist, T-122 download links), [`QA_NOTES.md`](QA_NOTES.md) (automated measurements), [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md), [`DEPLOYMENT.md`](DEPLOYMENT.md).

## 0. What is already proven automatically — do not redo it manually

| Evidence | Command / where | Covers |
|---|---|---|
| 1204 unit/integration tests | `npm test` (W6 gate: shared 175 · server 345 · client 171 · agent 513) | logic across all packages |
| 47/47 E2E, 0 skipped | `PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test` | real dashboard + real API + real Electron agent with **FakeDriver**; pairing (no reload), focus flow, sessions, schedule (real scheduler), missed run, admin/insights/notifications/settings, reconnect (real SIGKILL), viewport, a11y, perf, security |
| Coverage ≥80 % lines | `npx vitest run --coverage` per workspace (W6: shared 100 / server 89.44 / client 80.70 / agent 88.63) | TECHNICAL_DESIGN §14 target |
| NFR-011 latency | `npx playwright test e2e/perf.spec.ts` → worst p95 **7.22 ms** vs 300 ms | API performance on loopback (see `QA_NOTES.md` §1 caveat) |
| Security: 0 Critical / 0 High | `docs/SECURITY_REVIEW.md` (148 adversarial checks; 3 Mediums fixed & regression-tested) | SEC-1…SEC-10, auth, IDOR, rate limits, injection, INV-2/3/6 |
| Fuses + asar on real artifacts | CI run `42873654284` smoke jobs (`fuses/asar gates`), locally re-checkable with §4 | SEC-8 |
| macOS real hide/restore | `npx tsx scripts/verify/macos-focus-smoke.ts` → `PASS darwin/arm64` | FOCUS-1/2 on the demo OS (DEC-020) |

## 1. Environment record (fill once per OS run)

| Field | Value |
|---|---|
| Tester / date | |
| OS + build (e.g. macOS 15.7.7 arm64, Windows 11 23H2, Ubuntu 24.04 X11) | |
| Installer used + sha256 (from §2 table) | |
| Focus Agent version | `0.1.0` |
| API + dashboard origin (local `http://localhost:5000` / `:5173`, or deployed) | |
| Browser (Chrome/Edge/Firefox — **not Safari** for an HTTPS dashboard) | |
| Evidence folder | `evidence/T-10x/<date>/` (screenshots + log excerpts) |

**Global preconditions**

```sh
# from the repo root: local stack (or use the deployed API/dashboard per docs/DEPLOYMENT.md)
npm install && npm run build -w @focus-mode/shared
cp server/.env.example server/.env      # fill MONGO_URI + generated secrets (README §5)
cp client/.env.example client/.env
cp agent/.env.example agent/.env         # dev runs only; packaged builds read process env (DEC-013)
npm run seed                             # demo admin + Kabir + ≥30 days of data
npm run dev                              # API :5000 + dashboard :5173 (+ dev agent)
```

Credentials: `kabir@demo.com / Kabir@123` (USER) · `admin@demo.com / Admin@123` (ADMIN).

**Packaged agent environment (required — a packaged build does NOT read `agent/.env`)**:

```
AGENT_API_BASE_URL=http://localhost:5000/api/v1     # or the deployed https URL incl. /api/v1
AGENT_ALLOWED_ORIGINS=http://localhost:5173         # or the deployed dashboard origin
AGENT_FOCUS_DRIVER=real                             # packaged builds reject `fake`
AGENT_LOG_LEVEL=info
```

**Reset to a clean agent profile before each run** (removes stale pairing/journal/consent):

| OS | Command |
|---|---|
| macOS | `rm -rf "$HOME/Library/Application Support/Focus Mode Agent"` |
| Windows | `Remove-Item -Recurse -Force "$env:APPDATA\Focus Mode Agent"` |
| Linux | `rm -rf "$HOME/.config/Focus Mode Agent"` |

## 2. Installers to verify (real CI run `42873654284`)

The W6 packaging run produced these **unsigned workflow artifacts** (not a GitHub Release — releases are maintainer-tagged). Verify the hash **before** installing; a mismatch = STOP.

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

Facts about the run (verified from its logs): **4/4 build jobs + 4/4 `AGENT_SMOKE` jobs green, fuses/asar gates PASS, `publish draft GitHub release` skipped → 0 GitHub Releases.**

---

## 3. Windows 10/11 x64 — T-100 (≈50 min, NEEDS-HUMAN)

Preflight: PowerShell **as the normal user** (no admin needed). Browser on the dashboard, agent launched with the §1 env vars.

**Every item in this table is NEEDS-HUMAN** — tick PASS only with the evidence named in the last column; any FAIL becomes a `docs/KNOWN_ISSUES.md` entry.

| ID | Item (NEEDS-HUMAN) | Exact steps | Expected observable | Proves | Result + evidence |
|---|---|---|---|---|---|
| W-01 | Install + launch | `Get-FileHash .\focus-mode-agent-0.1.0-win-setup.exe -Algorithm SHA256` → compare §2. Run the `.exe`: SmartScreen **"Windows protected your PC"** → *More info* → *Run anyway*. No UAC/admin prompt. | per-user install completes; Start-menu shortcut exists; agent window shows `UNPAIRED` + a 6-digit code | FR-002/NFR-012 (AGENT-1) | ☐ PASS ☐ FAIL · screenshot + hash output |
| W-02 | First-run consent (native) | Browser `/login` as Kabir → `/devices` → pair (see W-03). On the **first** focus attempt the agent shows *"Let Focus Mode move other apps aside?"* → **Allow and continue**. | native dialog appears in the agent, cannot be answered from the page; accepting stores consent; declining a later run → `CONSENT_REQUIRED` | FR-009/SAFE-2, REC-004 | ☐ PASS ☐ FAIL · screenshot of dialog |
| W-03 | Pairing, no reload | Agent window: note the 6-digit code. Browser `/devices` → **Pair a device** → type code → Pair. **Do not refresh.** | badge flips **Not paired → Connected** within a few seconds; device row appears; agent shows `PAIRED` | FR-003/FR-004 (PAIR-1/LINK-1) | ☐ PASS ☐ FAIL · screenshot before/after |
| W-04 | Protected lockdown | `/allowlist`: try to remove/alter a locked protected row (browsers, Focus Agent, system essentials). Optionally `PUT /api/v1/allowlist` removing a protected key via curl. | UI row not removable; API → `400 PROTECTED_ENTRY`; during focus Chrome/Edge stays visible and usable | FR-008 (SAFE-1), INV-3 | ☐ PASS ☐ FAIL · screenshot + curl response |
| W-05 | Start focus → windows step aside | Open **Chrome** (dashboard), **Notepad**, **Calculator**, then `/dashboard` → custom **1 min** → **Start Focus** → read consent modal → **Confirm**. Observe the desktop. | Notepad/Calculator minimise (`SW_SHOWMINNOACTIVE`); Chrome untouched; agent window shows `FOCUSING`; `/focus` countdown runs | FR-005/FR-007 (FOCUS-1/3) | ☐ PASS ☐ FAIL · screenshot of before/after desktop |
| W-06 | End → restore, journal cleared | Click **End Focus** on `/focus`. Then check the agent data dir: `Get-ChildItem "$env:APPDATA\Focus Mode Agent"`. Also re-run a session ending from the **tray** menu. | every window the agent changed is restored; a window that was already minimised stays minimised; `focus-journal.json` is **absent** after restore; session in `/dashboard` recent (CANCELLED) | FR-006 (FOCUS-2), INV-4/INV-5 | ☐ PASS ☐ FAIL · screenshot + `Get-ChildItem` output |
| W-07 | Maximised restore | Start focus with a **maximised** Notepad window; end focus. | it returns maximised (not normal-sized) | FR-006 | ☐ PASS ☐ FAIL · screenshot |
| W-08 | Elevated window skipped honestly | Start Notepad **as administrator** (right-click → Run as administrator), then start focus. | elevated window is **not** moved (UIPI); no crash; the agent reports the skip in `capabilities.reasons` | FR-011 (X-PLAT-1) | ☐ PASS ☐ FAIL · agent window/log snippet |
| W-09 | Crash recovery | Start a 5-min focus, then `taskkill /F /IM "Focus Mode Agent.exe"`. Windows stay minimised. Relaunch the agent from the Start menu (same env/userData). | on relaunch: restore executes **before** the UI shows focus; session ends reason `CRASH_RECOVERY`; history shows exactly one finalised session | FR-023 | ☐ PASS ☐ FAIL · screenshot before/after relaunch |
| W-10 | Sleep/wake + link loss | Start a 2-min focus, then Start → Power → **Sleep**; wake after >2 min. Separately, while focusing, quit the agent and watch the dashboard. | after wake the session is ended (reason `SLEEP`, windows restored) and the dashboard re-syncs; when the agent dies mid-session the dashboard shows the **lost-contact** banner and does not pretend focus continues | FR-014 (RECONN-1) | ☐ PASS ☐ FAIL · screenshots |
| W-11 | Scheduled heads-up — cancel | `/schedules` → new schedule: today, start = now+2 min, 1 min, enabled. Keep agent connected + dashboard open. **Cancel** at the native heads-up (≥10 s window). | native heads-up/notification appears; cancel → run `CANCELLED_BY_USER`, **no** focus session | FR-012/FR-025 (SCHED-1) | ☐ PASS ☐ FAIL · screenshot + `/schedules`/history |
| W-12 | Scheduled heads-up — accept | Second schedule due in ~2 min; **do not cancel**. | focus starts with source **SCHEDULE**; session persisted; run recorded STARTED | FR-012 | ☐ PASS ☐ FAIL · screenshot |
| W-13 | Scheduled — agent offline | Close the agent, let a schedule become due. | run recorded **MISSED** + bell notification; **no** focus started | FR-025 | ☐ PASS ☐ FAIL · screenshot of notification |
| W-14 | Tray End / Quit | Start focus, **close the browser tab**. Tray → **End focus** → windows restore. Start again → tray → **Quit**. | End works with the dashboard closed; Quit restores first and exits cleanly; on restart the agent shows `PAIRED` (token persisted) | FR-022/FR-027, INV-5 | ☐ PASS ☐ FAIL · screenshots |
| W-15 | Privacy spot-check (INV-6) | Create `FOCUS-CHECK-TITLE-<date>.txt` in Notepad, open it, start+end focus. Then: `Select-String -Path "$env:APPDATA\Focus Mode Agent\logs\main.log" -Pattern "FOCUS-CHECK-TITLE"`. | **no match** — the agent never reads/logs window titles (the OS taskbar may show it; the agent log must not) | NFR-013/INV-6 | ☐ PASS ☐ FAIL · search output |
| W-16 | Tray/notification visuals | Observe tray menu items: state label, **End focus**, **Start at login (OFF by default, explanatory text)**, Quit; and the scheduled heads-up banner. | all items exist and are readable; start-at-login is OFF by default and explains itself | FR-022, REC-008 | ☐ PASS ☐ FAIL · screenshot |
| W-17 | Uninstall / data | Settings → Apps → **Focus Mode Agent** → Uninstall. Check `%LOCALAPPDATA%\Programs` and `%APPDATA%\Focus Mode Agent`. | app removed; **app data (journal/settings/consent/token) is retained by design**; removing `%APPDATA%\Focus Mode Agent` manually completes a full reset; no background process remains | FR-002/NFR-012 (uninstaller) | ☐ PASS ☐ FAIL · screenshots |
| W-18 | Fuses on the packaged app (optional spot-check, already CI-proven) | From the repo: `node scripts/verify/verify-fuses.mjs "<install dir>\Focus Mode Agent.exe dir>"`; `node scripts/verify/smoke-packaged.mjs "<install dir>"`. | fuses hardened (`RunAsNode` disabled, Node CLI inspect disabled, `OnlyLoadAppFromAsar` enabled); packaged smoke prints PASS | SEC-8, NFR-012 | ☐ PASS ☐ FAIL · command output |

Windows sign-off: ☐ all PASS · FAIL items → KI: ______ · tester/date: ______

---

## 4. macOS 12+ arm64 (and Intel if available) — T-101 (≈40 min, NEEDS-HUMAN)

Preflight: terminal as the normal user; the agent must be launched from the app executable with the §1 env vars (`open` does not pass them — launch the binary directly, see below).

**Every item in this table is NEEDS-HUMAN** — tick PASS only with the evidence named in the last column; any FAIL becomes a `docs/KNOWN_ISSUES.md` entry.

```sh
shasum -a 256 ~/Downloads/focus-mode-agent-0.1.0-mac-arm64.dmg   # compare §2
open ~/Downloads/focus-mode-agent-0.1.0-mac-arm64.dmg            # drag to Applications
# Gatekeeper on first launch: right-click app → Open (or System Settings → Privacy & Security → Open Anyway)
# if a downloaded zip is quarantined:
#   xattr -dr com.apple.quarantine "/Applications/Focus Mode Agent.app"

export AGENT_API_BASE_URL="http://localhost:5000/api/v1"
export AGENT_ALLOWED_ORIGINS="http://localhost:5173"
export AGENT_FOCUS_DRIVER="real"
"/Applications/Focus Mode Agent.app/Contents/MacOS/Focus Mode Agent"
```

| ID | Item (NEEDS-HUMAN) | Exact steps | Expected observable | Proves | Result + evidence |
|---|---|---|---|---|---|
| M-01 | Install + launch | Verify sha256; dmg → Applications; first launch via right-click→Open. | app starts, agent window shows `UNPAIRED` + 6-digit code; no Accessibility/TCC prompt for the shipped path | FR-002/NFR-012 | ☐ PASS ☐ FAIL · screenshot + hash |
| M-02 | First-run consent (native) | As W-02: first focus attempt → agent dialog → **Allow and continue**. | dialog is agent-side only; consent stored; revocable from the agent window/tray | FR-009/SAFE-2, REC-004 | ☐ PASS ☐ FAIL · screenshot |
| M-03 | Pairing, no reload | As W-03 (code from the agent window → `/devices`). Do **not** refresh. | badge flips to **Connected** live; device row; agent `PAIRED` | FR-003/FR-004 | ☐ PASS ☐ FAIL · screenshots |
| M-04 | Protected lockdown | `/allowlist`: locked rows not removable; start focus with **Safari and Chrome** open. | both browsers stay visible/usable; protected rows rejected by API (`PROTECTED_ENTRY`) | FR-008, INV-3 | ☐ PASS ☐ FAIL · screenshot |
| M-05 | Start focus → real apps hide | Open **TextEdit**, **Notes**, **Calculator** + Safari/Chrome dashboard; start a 1-min custom focus; confirm consent. | TextEdit/Notes/Calculator hide (⌘H-equivalent, not quit); browser untouched; `/focus` countdown; agent `FOCUSING` | FR-005/FR-007 (FOCUS-1/3) | ☐ PASS ☐ FAIL · screen recording/screenshots |
| M-06 | End → restore, journal cleared | End Focus from `/focus`; then `ls "$HOME/Library/Application Support/Focus Mode Agent"`. Repeat ending from the **tray** menu. | all hidden apps unhide; already-minimised windows stay minimised; **no `focus-journal.json`** after restore; session finalised once | FR-006, INV-4/INV-5 | ☐ PASS ☐ FAIL · screenshot + `ls` |
| M-07 | Permission behaviour | Watch for any macOS permission prompt during M-05/M-06; note it. | shipped JXA path needs **no** TCC grant (DEC-005); if an Automation prompt ever appears, note it and confirm the agent degrades honestly instead of failing silently | FR-011 (X-PLAT-1) | ☐ PASS ☐ FAIL · screenshot |
| M-08 | Dock/Finder untouched | During focus, click Dock/Finder. | Dock, Finder and SystemUIServer never hidden/moved | FR-008, INV-3 | ☐ PASS ☐ FAIL · screenshot |
| M-09 | Crash recovery | Start 5-min focus; `pkill -9 -f "Focus Mode Agent"`; relaunch the app with the same env. | relaunch restores the journal **before** UI focus; session ends `CRASH_RECOVERY`; history finalised once | FR-023 | ☐ PASS ☐ FAIL · screenshots |
| M-10 | Sleep/wake + link loss | Start 2-min focus; `pmset sleepnow`; wake after >2 min. Separately quit the agent mid-session. | session ends reason `SLEEP` with windows restored; dashboard re-syncs; agent-gone → lost-contact banner (no fake continuation) | FR-014 | ☐ PASS ☐ FAIL · screenshots |
| M-11 | Scheduled heads-up — cancel | As W-11 (today, now+2 min, 1 min); **Cancel** at the heads-up. | native notification/tray heads-up ≥10 s; cancel → `CANCELLED_BY_USER`, no focus | FR-012/FR-025 | ☐ PASS ☐ FAIL · screenshot |
| M-12 | Scheduled heads-up — accept | Second schedule; let it start. | focus starts source `SCHEDULE`; run STARTED; session persisted | FR-012 | ☐ PASS ☐ FAIL · screenshot |
| M-13 | Scheduled — agent offline | Quit agent; let schedule become due. | `MISSED` run + bell notification; no focus | FR-025 | ☐ PASS ☐ FAIL · screenshot |
| M-14 | Tray End / Quit | Start focus; close the browser tab. Tray → **End focus**; then again → tray **Quit**. | End works with dashboard closed; Quit restores first; no stuck focus; restart shows `PAIRED` | FR-022/FR-027, INV-5 | ☐ PASS ☐ FAIL · screenshots |
| M-15 | Privacy spot-check (INV-6) | Create `/tmp/FOCUS-CHECK-TITLE-<date>.txt`, open in TextEdit, start+end focus, then `grep -n "FOCUS-CHECK-TITLE" "$HOME/Library/Logs/Focus Mode Agent/main.log"`. | **no match** in agent logs | NFR-013/INV-6 | ☐ PASS ☐ FAIL · grep output |
| M-16 | Tray/notification visuals | Inspect the native tray menu (state, End focus, Show window, Start at login OFF, consent status/revoke, Quit) and the scheduled banner. | items present/readable; start-at-login OFF by default with explanation; consent status visible/revocable | FR-022, REC-004/008 | ☐ PASS ☐ FAIL · screenshot |
| M-17 | Uninstall / data | Drag app to Trash; check `~/Library/Application Support/Focus Mode Agent`. | app removed; data retained by design; removing the data dir manually completes the reset; no login item/background agent remains | FR-002/NFR-012 | ☐ PASS ☐ FAIL · screenshots |
| M-18 | Fuses/asar on the installed app (optional, CI-proven) | `node scripts/verify/verify-fuses.mjs "/Applications/Focus Mode Agent.app"`; `node scripts/verify/smoke-packaged.mjs "/Applications/Focus Mode Agent.app"` — unsigned app may need the Gatekeeper open first. | hardened fuses verified; packaged smoke PASS | SEC-8 | ☐ PASS ☐ FAIL · command output |

macOS sign-off: ☐ all PASS · FAIL items → KI: ______ · tester/date: ______ · arm64 ☐ x64 ☐

---

## 5. Linux x64 (Ubuntu 22.04/24.04) — T-102 (≈45 min, NEEDS-HUMAN)

Preflight: X11 session (`echo $XDG_SESSION_TYPE` → `x11`); `sudo apt install wmctrl xdotool` if missing (both are runtime dependencies); AppImage needs FUSE (or `--appimage-extract`).

**Every item in this table is NEEDS-HUMAN** — tick PASS only with the evidence named in the last column; any FAIL becomes a `docs/KNOWN_ISSUES.md` entry.

```sh
sha256sum focus-mode-agent-0.1.0-linux-x86_64.AppImage focus-mode-agent-0.1.0-linux-amd64.deb   # compare §2
chmod +x focus-mode-agent-0.1.0-linux-x86_64.AppImage
AGENT_API_BASE_URL="http://localhost:5000/api/v1" AGENT_ALLOWED_ORIGINS="http://localhost:5173" \
  AGENT_FOCUS_DRIVER="real" ./focus-mode-agent-0.1.0-linux-x86_64.AppImage
# or: sudo apt install ./focus-mode-agent-0.1.0-linux-amd64.deb  → launch "Focus Mode Agent" from the app menu
```

| ID | Item (NEEDS-HUMAN) | Exact steps | Expected observable | Proves | Result + evidence |
|---|---|---|---|---|---|
| L-01 | Install + launch (AppImage) | Verify sha256; `chmod +x`; run the AppImage (FUSE fallback: `--appimage-extract` → `squashfs-root/AppRun`). | app starts on X11; agent window shows `UNPAIRED` + 6-digit code | FR-002/NFR-012 | ☐ PASS ☐ FAIL · screenshot + hash |
| L-02 | Install + launch (.deb) | `sudo apt install ./focus-mode-agent-0.1.0-linux-amd64.deb`; confirm package name via `dpkg -l 'focus*'`; launch from the app menu. | install succeeds, app launches, `.desktop` entry works | NFR-012 | ☐ PASS ☐ FAIL · screenshot + `dpkg` output |
| L-03 | First-run consent | As W-02 → agent dialog → Allow. | agent-side consent gate; declinable/revocable | FR-009/SAFE-2, REC-004 | ☐ PASS ☐ FAIL · screenshot |
| L-04 | Pairing, no reload | As W-03; do **not** refresh the dashboard. | badge flips to **Connected** live; agent `PAIRED` | FR-003/FR-004 | ☐ PASS ☐ FAIL · screenshots |
| L-05 | Protected lockdown | `/allowlist` locked rows; start focus with Firefox/Chrome open. | browsers stay up; `PROTECTED_ENTRY` on protected changes; GNOME/KDE shell classes never touched | FR-008, INV-3 | ☐ PASS ☐ FAIL · screenshot |
| L-06 | Start focus → X11 windows minimise | Open **gedit/GNOME Text Editor**, **Calculator**, **Files (Nautilus)** + the browser; start a 1-min focus; confirm. | eligible windows minimise via `xdotool windowminimize`; browser untouched; countdown runs | FR-005/FR-007 (FOCUS-1/3) | ☐ PASS ☐ FAIL · screenshots |
| L-07 | End → restore, journal cleared | End Focus from `/focus`; `ls "$HOME/.config/Focus Mode Agent"`. Repeat ending from the tray. | windows restore (`wmctrl … remove,hidden` / `xdotool windowmap`); no `focus-journal.json` after restore; session finalised once | FR-006, INV-4/INV-5 | ☐ PASS ☐ FAIL · screenshot + `ls` |
| L-08 | Crash recovery | Start 5-min focus; `pkill -9 -f focus-mode-agent`; relaunch with env. | restore on relaunch; session `CRASH_RECOVERY`; history finalised once | FR-023 | ☐ PASS ☐ FAIL · screenshots |
| L-09 | Sleep/wake + link loss | Start 2-min focus; `systemctl suspend`; wake after >2 min. Separately quit the agent mid-session. | session ends `SLEEP` and restores; dashboard re-syncs; agent-gone shows lost-contact banner | FR-014 | ☐ PASS ☐ FAIL · screenshots |
| L-10 | Scheduled heads-up — cancel / accept | As W-11/W-12 (today, now+2 min). | ≥10 s heads-up; cancel → `CANCELLED_BY_USER`; accept → `SCHEDULE` session | FR-012/FR-025 | ☐ PASS ☐ FAIL · screenshots |
| L-11 | Tray End / Quit | Close the browser tab; tray → End focus; then tray → Quit. | works with the dashboard closed; Quit restores first | FR-022/FR-027, INV-5 | ☐ PASS ☐ FAIL · screenshots |
| L-12 | Wayland honest unsupported | Log out → log in to a **Wayland** session; check `echo $XDG_SESSION_TYPE` → `wayland`; start the agent; open `/dashboard`. | agent reports `capabilities.focus = "unsupported"` with a reason; the dashboard **blocks Start** and shows the explanation (no fake focus) | FR-005/FR-011 | ☐ PASS ☐ FAIL · screenshot |
| L-13 | Privacy spot-check (INV-6) | Create `/tmp/FOCUS-CHECK-TITLE-<date>.txt`, open it, start+end focus; `grep -n "FOCUS-CHECK-TITLE" "$HOME/.config/Focus Mode Agent/logs/main.log"`. | no match (Linux driver parses only window id/PID; `/proc/<pid>/comm`) | NFR-013/INV-6 | ☐ PASS ☐ FAIL · grep output |
| L-14 | Uninstall | AppImage: delete the file. deb: `sudo apt remove <package>` (confirm name with `dpkg -l 'focus*'`). Check `~/.config/Focus Mode Agent`. | app removed; data retained by design; manual data-dir removal completes the reset; no background process | FR-002/NFR-012 | ☐ PASS ☐ FAIL · screenshots |

Linux sign-off: ☐ all PASS · FAIL items → KI: ______ · tester/date: ______ · release (22.04 ☐ 24.04 ☐) · session (X11 ☐ Wayland ☐)

---

## 6. Cross-OS acceptance matrix (fill from the tables above)

| Requirement | Windows | macOS | Linux | Notes |
|---|---|---|---|---|
| FR-002 (agent runs, tray, quit) | ☐ | ☐ | ☐ | visuals are manual (KI-013) |
| FR-003/FR-004 (pairing + live link, no reload) | ☐ | ☐ | ☐ | |
| FR-005/FR-006/FR-007 (start/aside/restore/countdown) | ☐ | ☐ | ☐ | **the graded core** |
| FR-008 (protected lockdown) | ☐ | ☐ | ☐ | |
| FR-009/SAFE-2 (consent + visible state) | ☐ | ☐ | ☐ | |
| FR-011 (cross-platform behind one interface) | ☐ | ☐ | ☐ | |
| FR-012/FR-025 (scheduled heads-up / missed) | ☐ | ☐ | ☐ | |
| FR-014 (reconnect/sleep/link loss) | ☐ | ☐ | ☐ | |
| FR-022/FR-027 (tray end, dashboard closed) | ☐ | ☐ | ☐ | |
| FR-023 (crash recovery) | ☐ | ☐ | ☐ | |
| NFR-012 (install/uninstall) | ☐ | ☐ | ☐ | unsigned steps documented |
| NFR-013/INV-6 (no titles in logs) | ☐ | ☐ | ☐ | spot-check |
| SEC-8 fuses (optional artifact check) | ☐ | ☐ | ☐ | CI-proven; spot-check |

**Overall Phase-8 verdict:** ☐ PASS — evidence complete and filed · ☐ FAIL — see KI list below.

## 7. Failure handling and sign-off

1. Record **expected vs actual** + timestamp + OS build + installer sha256; attach screenshots/log excerpt to `evidence/T-10x/<date>/`.
2. Open a `docs/KNOWN_ISSUES.md` entry with severity (**Critical** = data loss/focus stuck/protected app touched/security hole; **High** = P0 feature broken). Critical/High block the release.
3. A FAIL is re-tested after the fix with the same step; do not edit this file to make an item pass — append the evidence in `docs/QA_REPORT.md`.
4. A9/A0 sign the release gate only when the matrix above has no unchecked **graded core** cells (FR-005/006/007/008) on the demo OS, and every other FAIL is a documented, accepted limitation.

| Sign-off | Name | Date | OS/version | Verdict |
|---|---|---|---|---|
| Windows T-100 | | | | |
| macOS T-101 | | | | |
| Linux T-102 | | | | |
| Compiled by A9 → `docs/QA_REPORT.md` | | | | |
