# PLATFORMS.md — per-OS behaviour, browser support and manual verification status

> **Owner:** A1 (co-owned with A7) · **Task:** T-094 (Phase 7, feeds the W8 Phase-8 checklist) · **Last verified:** 2026-11-11 (W4 gate).
> **Purpose:** one honest page for "what works on which platform, what has actually been verified, and what a human still has to test". Nothing here is claimed from compilation alone — every row says *how* it is evidenced.
> **Related:** `docs/DECISIONS.md` (DEC-005 macOS driver model, DEC-006 default browser, DEC-008 primary OS, DEC-020 real-OS stance) · `docs/KNOWN_ISSUES.md` (KI-005, KI-009, KI-011, KI-013) · `docs/RELEASING.md` (build/sign/install) · `docs/AGENT_STATUS.md` (raw evidence).
>
> Legend — ✅ **verified** (evidence named below) · 🟡 **partial** (implementation + automated tests, real-desktop behaviour unverified) · ⛔ **NEEDS-HUMAN** (cannot be verified from this session; a person must run the checklist) · 📋 **not supported by design**.

## 1. Support summary

| OS | Focus-agent window control | Status in this repo | Real-desktop verification |
|---|---|---|---|
| **macOS 12+** (arm64 primary; x64 installers built) | JXA via one-shot `osascript -l JavaScript` (`NSRunningApplication.hide()/unhide()`), verified from a **separate** invocation (DEC-005) | ✅ implemented and tested (driver contract + 425 agent tests at the W3 gate) | ✅ **macOS arm64 verified locally** with `scripts/verify/macos-focus-smoke.ts` → `PASS darwin/arm64`; full Phase-8 checklist T-101 still ⛔ |
| **Windows 10/11 x64** | Win32 FFI via `koffi`: `EnumWindows`/`IsWindowVisible`/…, aside = `ShowWindow(SW_SHOWMINNOACTIVE)`, restore = `ShowWindow(SW_RESTORE)` | 🟡 implemented behind the frozen `FocusDriver`; mocked-native contract tests + CI on `windows-latest` | ⛔ NEEDS-HUMAN — no Windows desktop in this session (KI-005, T-100) |
| **Linux x64** (Ubuntu 22.04/24.04) | X11 only: `wmctrl`/`xdotool` (runtime dependency, detected at agent start) | 🟡 implemented + contract tests, CI build/smoke on `ubuntu-24.04` (Xvfb) | ⛔ NEEDS-HUMAN — no Linux desktop in this session (KI-005, T-102) |
| **Linux Wayland** | no generic way for an unprivileged app to minimise another app's window | 📋 **unsupported by design**: `capabilities.focus = "unsupported"` with a reason; the dashboard blocks Start and shows the reason | n/a (behaviour is the honest capability report) |

The dashboard never decides platform behaviour itself: the Focus Agent reports capabilities in the local-channel `hello` frame and the dashboard disables Start with the reported reason whenever `capabilities.focus !== 'full'`.

## 2. macOS

**Mechanism.** Every operation is a separate `osascript -l JavaScript` process; each state change is verified in *another* invocation with bounded retries. The JXA return value of `hide()/unhide()` is not trusted and same-process state is stale (spike S-2). Only `activationPolicy == 0` apps are enumerated and only `bundleIdentifier`/`localizedName` are read — no window titles, PIDs or URLs leave the driver (INV-6). The journal stores bundle ids only.

**Verification evidence.**
- `npx tsx scripts/verify/macos-focus-smoke.ts` runs the **real** `FocusController` + **real** `DarwinDriver` on this machine: it hides its own TextEdit instance, verifies the hide from a separate osascript process, clears the journal, proves a second `exitFocus` is a no-op, restores, and verifies the restore → `PASS darwin/arm64` (DEC-020). Exit 0 = FOCUS-1 + FOCUS-2 verified on this machine.
- The W3 focus E2E (`e2e/focus.spec.ts`) exercises Start → consent → `/focus` countdown → End → restore with the FakeDriver, and `e2e/pairing.spec.ts` drives the real Electron agent window + real Ed25519 attestation.
- Protected set on macOS resolves to **19 entries**: 9 browsers + the Focus Agent itself + 8 OS-critical (`Finder`, `Dock`, `SystemUIServer`, `loginwindow`, `Control Center`, `Notification Center`, `Spotlight`, `Activity Monitor`) + `System Settings`. The OS **default browser** is added to the protected set at agent start (DEC-006) even if it is none of the hard-coded browsers.

**Permissions.** The shipped hide/unhide path needs **no Accessibility/TCC grant** (spike S-2, DEC-005). The JXA fallback via System Events would need Automation permission — it is documented, not used by default; `NSAppleEventsUsageDescription` ships in the bundle so macOS can show the prompt if that path is ever taken, and denying it makes the agent report it cannot enforce focus instead of failing silently.

**Still ⛔ NEEDS-HUMAN (T-101):** M1 apps hide on Start while the browser stays · M2 End → unhidden · M3 permission prompts match these docs · M4 `kill -9` mid-focus → relaunch restores · M5 sleep/resume mid-session · M6 dmg install + documented Gatekeeper path · M7 Dock/Finder untouched. Also KI-013: the native tray menu and OS notification cannot be clicked/read by Playwright, so the physical tray/notification visuals are part of this manual checklist.

## 3. Windows

**Mechanism.** Win32 FFI through `koffi` (lazily required only on `win32`, never loaded on macOS/Linux): `EnumWindows` → `IsWindowVisible` → `IsIconic` → `GetWindow(GW_OWNER)` → `GetWindowLongPtr(GWL_EXSTYLE)` (skip `WS_EX_TOOLWINDOW`) → `DwmGetWindowAttribute(DWMWA_CLOAKED)` (skip cloaked UWP shells) → `GetWindowThreadProcessId` → `OpenProcess` + `QueryFullProcessImageNameW`. Identity is the executable basename; window titles are never read (INV-6). Aside = `ShowWindow(SW_SHOWMINNOACTIVE)`; restore = `ShowWindow(SW_RESTORE)` for journaled handles that are still iconic and whose executable still matches (handle-reuse guard). The "minimise everything" shortcut (Win+D) is deliberately **never** used — it would also minimise the protected browser.

**Elevated windows.** A non-elevated agent cannot manipulate elevated (admin) windows from a non-elevated process (UIPI). Those windows are **skipped and reported** in `capabilities.reasons` — they are never silently pretended to be moved.

**Verification evidence.** 🟡 implementation + mocked-native contract tests (`win32` driver suite) and CI builds/tests on `windows-latest`. **Real window manipulation is unverified** (no Windows machine available — KI-005).

**Still ⛔ NEEDS-HUMAN (T-100):** W1 Chrome + Notepad + Calculator open → Start → Notepad/Calc minimised, Chrome untouched · W2 End → restored, a window the user had already minimised stays minimised · W3 a maximised app restores maximised · W4 an elevated window is skipped without a crash and reported · W5 `taskkill /f` on the agent mid-focus → relaunch restores · W6 sleep/resume mid-session · W7 per-user install (no admin) / launch / uninstall · W8 the SmartScreen note in `docs/RELEASING.md` §6.1 is accurate.

## 4. Linux

**X11 (supported).** The agent detects `XDG_SESSION_TYPE` and requires an X11 `DISPLAY` plus `wmctrl` and `xdotool` on `PATH` (runtime dependencies, probed at start). Commands run through `execFile` with argument arrays — never a shell string. `wmctrl -l -p` is parsed for exactly two fields (window id and PID) and process identity comes from `/proc/<pid>/comm`; **window titles are never read or copied** (INV-6). Aside = `xdotool windowminimize <id>`; restore = `wmctrl -i -r <id> -b remove,hidden` with `xdotool windowmap` as fallback. Missing tooling → `capabilities.focus = "unsupported"` with the reason; the dashboard blocks Start.

**Wayland (unsupported by design).** `XDG_SESSION_TYPE=wayland` → `capabilities.focus = "unsupported"` with a reason and the dashboard refuses to start focus with an explanation. There is no generic Wayland API for one unprivileged app to minimise another app's window, and pretending otherwise would be dishonest.

**Verification evidence.** 🟡 implementation + contract tests for candidate filtering/restore/Wayland/missing-tool paths; CI builds and runs the agent smoke on `ubuntu-24.04` (under Xvfb). **Real X11 window manipulation is unverified** (no Linux desktop here — KI-005). Honest driver limitation: X11 has no dependency-free "is this minimised?" query, so a window is treated as changed when `xdotool windowminimize` exits 0 (documented in `agent/src/focus/drivers/linux-x11.ts`); Windows/macOS verify every operation against live state.

**Still ⛔ NEEDS-HUMAN (T-102):** L1 X11 start/end really minimises/restores windows · L2 on Wayland the dashboard reports `unsupported` and blocks Start with the message · L3 the AppImage runs and the `.deb` installs/uninstalls.

## 5. Browser support (dashboard)

The dashboard is a normal React SPA; the unusual requirement is that a browser must be allowed to open a **loopback WebSocket** (`ws://127.0.0.1:4545/link`) from the dashboard's origin.

| Browser | HTTPS-hosted dashboard | Notes |
|---|---|---|
| Chrome | ✅ supported | Loopback is treated as potentially trustworthy. Chrome's Local Network Access may show a **one-time permission prompt** for local requests — allow it. The dashboard shows a pre-prompt explainer and a help card if access is denied, and the link fails soft (retries). |
| Edge | ✅ supported | Chromium behaviour, same local-network prompt story as Chrome. |
| Firefox | ✅ supported | Loopback trusted; Firefox's own local-network prompt may appear — allow it. |
| Safari | ⛔ **unsupported for an HTTPS dashboard** | Safari does not provide the loopback exception: it blocks `ws://127.0.0.1` from an `https://` page. Works when the dashboard is itself served from `http://localhost` (dev). Documented as KI-004; use Chrome/Edge/Firefox for the deployed dashboard. |
| Chromium derivatives (Brave, Vivaldi, Arc, Opera) | 🟡 not in the tested matrix | They generally inherit Chrome's loopback behaviour, but they are not part of the verified E2E matrix — treat as best-effort. |

Browsers considered from the agent side are irrelevant here: all nine known browsers are *protected* (never moved), whichever one you use.

## 6. Installer / artifact matrix (real CI output)

The release workflow has produced **real unsigned installers** on native GitHub runners — dispatch run `42858934575` (2026-11-11): **4/4 build jobs + 4/4 `AGENT_SMOKE` smoke jobs green, and zero GitHub Releases created** (the release job only runs on a maintainer-pushed `v*` tag; the tag-only guard held).

| OS | Targets | Artifact file names (version `0.1.0` for this build) | Evidence |
|---|---|---|---|
| Windows x64 | `nsis`, `portable` | `focus-mode-agent-0.1.0-win-setup.exe`, `focus-mode-agent-0.1.0-win-portable.exe` | CI build + `AGENT_SMOKE` job green (sizes/sha256 in the run log) |
| macOS arm64 | `dmg`, `zip` | `focus-mode-agent-0.1.0-mac-arm64.dmg`, `…-mac-arm64.zip` | CI build + smoke green; local dev machine sandbox blocked `hdiutil` (NEEDS-HUMAN/CI) |
| macOS x64 | `dmg`, `zip` | `focus-mode-agent-0.1.0-mac-x64.dmg`, `…-mac-x64.zip` | CI build + smoke green (`macos-15-intel` runner) |
| Linux x64 | `AppImage`, `deb` | `focus-mode-agent-0.1.0-linux-x64.AppImage`, `focus-mode-agent-0.1.0-linux-x64.deb` | CI build + smoke green (Xvfb); `rpm` intentionally not built |

Important scope of this evidence, in plain language:

- The artifacts exist as **workflow artifacts**, not as a published GitHub Release. There are **no public download links yet**; releases are maintainer-tagged. `docs/RELEASING.md` is the source of truth for the release process.
- The per-OS `AGENT_SMOKE` job proves the **packaged code + Electron boot headless** and a real loopback `hello`/`getState` round-trip. It does **not** prove that the installed `.dmg`/`.exe`/AppImage itself launches — that is ⛔ NEEDS-HUMAN (installer-level launch, T-100/T-101/T-102).
- All builds are **unsigned** unless signing certificates are supplied; SmartScreen/Gatekeeper steps are documented in `docs/RELEASING.md` §6 and summarised in the README.

## 7. Phase-8 manual checklist status (T-100 / T-101 / T-102)

Every item below is **⛔ NEEDS-HUMAN** and may not be ticked without evidence (OS version, build id, screenshot/video in `docs/QA_REPORT.md`). macOS items marked ✅ have automated evidence from this session; the checklist row still needs a human for the physical/tray parts.

| ID | Platform | What must be tested | Status |
|---|---|---|---|
| T-100 | Windows 10/11 | W1–W8 as listed in §3 (real windows, restore, elevated skip, `taskkill`, sleep/resume, install/uninstall, SmartScreen note) | ⛔ NEEDS-HUMAN (KI-005) |
| T-101 | macOS arm64 (+ Intel if available) | M1–M7 as listed in §2 (real hide/restore, permissions, `kill -9`, sleep/resume, dmg install/Gatekeeper, Dock/Finder untouched, tray/notification visuals per KI-013) | 🟡 the real-driver **hide + restore** core of M1/M2 has automated evidence (`scripts/verify/macos-focus-smoke.ts` hides and restores TextEdit and verifies from a separate process); the "browser untouched", permission-prompt, sleep/resume, installer and tray/notification parts are ⛔ NEEDS-HUMAN |
| T-102 | Linux Ubuntu 24.04 | L1–L3 as listed in §4 (real X11 start/end, Wayland unsupported message + Start blocked, AppImage run / deb install-uninstall) | ⛔ NEEDS-HUMAN (KI-005) |

## 8. What "verified" means here

| Evidence class | Meaning |
|---|---|
| ✅ automated, this machine | A command in this repo ran here and exited 0 — e.g. the macOS smoke script (`PASS darwin/arm64`), `npm test` (unit + API integration), `npx playwright test` against the real dashboard + API + Electron agent |
| ✅ automated, CI | GitHub Actions matrix (Ubuntu, Windows, macOS) running lint, typecheck, build and tests; the release workflow building all four targets and running the per-OS smoke job |
| 🟡 partial | Implementation merged and covered by automated tests (including mocked-native contract suites), but the real OS behaviour has no evidence yet |
| ⛔ NEEDS-HUMAN | Only a human on that physical desktop can produce the evidence; the exact checklist is in §2–§4 and must be recorded in `docs/QA_REPORT.md` at W8/W9 |

Compiling is never treated as verification (AGENTS.md §10/§14). When a platform is unverifiable, the product degrades honestly: capabilities are reported, and the dashboard refuses to start focus instead of pretending.
