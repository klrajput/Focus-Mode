# SPIKES.md — Phase 0 spikes (T-008)

> Owner: A7 (Desktop Agent Engineer). Executed here by A0 on the only real desktop in this session (macOS 15.7.7 arm64).
> Every spike must state **PASS/FAIL**, the OS/version, and the exact command. A FAIL changes TECHNICAL_DESIGN via `docs/DECISIONS.md`.
> Dates are IST. Spike scripts live in `.spikes/` (temporary; promoted to `scripts/spikes/` by A7 in W0 if still useful).

## Summary
| Spike | Question | Result | Blocks |
|---|---|---|---|
| S-1 | Windows: koffi EnumWindows / IsIconic / ShowWindow works and restores maximised windows | **NEEDS-HUMAN** (no Windows machine in session) | T-052, T-100 |
| S-2 | macOS: enumerate regular apps + `hide()`/`unhide()` via JXA ObjC bridge, and what permission it needs | **PASS with 2 design constraints** (below) | T-053, T-101 |
| S-3 | Detect the OS default browser so it can be added to the protected set | **PASS** | T-033, T-053 |
| S-4 | HTTPS dashboard page → `ws://127.0.0.1` in Chrome/Edge/Firefox/Safari incl. local-network prompt | **PENDING** (needs Playwright chromium + local TLS page; run in T-045) | T-045, T-056 |

---

## S-2 — macOS hide/unhide via JXA (PASS)
**Environment:** macOS 15.7.7 (24G720), arm64 T8122. Target app: `TextEdit` launched by the spike itself and killed afterwards (`com.apple.TextEdit`).
**Mechanism tested (the one TECHNICAL_DESIGN §7.5 proposes):** `osascript -l JavaScript` with `ObjC.import('AppKit')`, `NSWorkspace.sharedWorkspace.runningApplications`, `NSRunningApplication.hide` / `.unhide`.

### Evidence 1 — enumeration of regular GUI apps, no permission prompt
```
$ SPIKE_PHASE=list osascript -l JavaScript .spikes/s2-macos-hide.js
{"ok":true,"phase":"list","count":4,"apps":[
  {"pid":401,"name":"Finder","bundleId":"com.apple.finder","hidden":false,"terminated":false},
  {"pid":711,"name":"Google Chrome","bundleId":"com.google.Chrome","hidden":false,"terminated":false},
  {"pid":5492,"name":"DeepSeek Harness","bundleId":"com.deepseek.dsh","hidden":false,"terminated":false},
  {"pid":5655,"name":"Code","bundleId":"com.microsoft.VSCode","hidden":false,"terminated":false}]}
```
No Automation/Accessibility TCC prompt appeared. `activationPolicy == 0` cleanly separates Dock-visible apps (Filter is correct; Finder is protected elsewhere).

### Evidence 2 — hide then unhide, verified from a *separate* process
```
$ open -na TextEdit && sleep 2
$ SPIKE_PHASE=state  ...v2   → {"hidden":false}
$ SPIKE_PHASE=hide    ...v2  → {"phase":"hide","before":false,"ret":false,"callMs":0,"reached":false,
                                "timeline":[{"ms":"timeout","hidden":false}]}
$ SPIKE_PHASE=state  ...v2   → {"hidden":true}      ← separate process sees the hide
$ SPIKE_PHASE=unhide  ...v2  → {"phase":"unhide","before":true,"ret":false, ... "reached":false}
$ SPIKE_PHASE=state  ...v2   → {"hidden":false}     ← restored
$ killall TextEdit
```
**Findings:**
1. **`hide()`/`unhide()` work on macOS 15.7.7 arm64 and need no TCC grant** when invoked through the system `osascript` binary. Good: no first-run permission wall for the primary path.
2. **The JS `ret` BOOL is not reliable** (both calls returned `false` while the state did change) → the driver must not trust the return value.
3. **State read inside the same osascript process is stale** (v3 polled a fresh `runningApplications` enumeration every 100 ms for 3 s and never observed the change; the next process saw it immediately). Cause: `NSWorkspace`/`NSRunningApplication` refresh needs a process run loop (KVO notification delivery), and a one-shot JXA script has no run loop.
**Design constraints adopted (recorded as DEC-005):**
- One `osascript` invocation per driver operation; **verification is a separate follow-up invocation** (bounded retry), never a same-process read.
- Journal stores bundle ids (no titles, no PIDs) and restore = `unhide()` for journaled bundle ids that are still running and hidden.
- Electron integration must re-test whether a long-lived Electron main process (has a run loop) sees live state; if it does, the driver can poll in-process, otherwise keep one-shot calls.
4. **System Events fallback is not available by default:**
```
$ osascript -e 'tell application "System Events" to get name of every process whose background only is false'
execution error: System Events got an error: A privilege violation occurred. (-10004)
```
→ The TECHNICAL_DESIGN fallback (`set visible of process … to false`) requires the user to grant Automation permission; unsigned/unprompted it fails. **Primary path is JXA `hide()`; the fallback stays documented as a manual-permission fallback only.**

## S-3 — default browser detection (PASS)
```
$ osascript -l JavaScript -e 'ObjC.import("AppKit"); var u=$.NSURL.URLWithString("https://example.com");
  var a=$.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(u); console.log(ObjC.unwrap(a.path));'
/Applications/Google Chrome.app
```
`defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers` also shows `LSHandlerURLScheme = https → com.google.chrome`, but its structure is version-fragile.
**Design:** resolve the default browser at agent start via `NSWorkspace.URLForApplicationToOpenURL` (https then http), map the `.app` path to a bundle id via `NSBundle` `CFBundleIdentifier`, add it to the protected set. All hard-coded known browsers stay protected regardless (INV-3).

## S-1 — Windows Win32 driver (NEEDS-HUMAN)
No Windows machine is available in this session. Planned verification:
- Implement `drivers/win32.ts` with `koffi` in T-052 exactly as TECHNICAL_DESIGN §7.5 (EnumWindows → IsWindowVisible → IsIconic → GW_OWNER → GWL_EXSTYLE WS_EX_TOOLWINDOW → DwmGetWindowAttribute DWMWA_CLOAKED → process image name).
- `FocusDriver` contract suite runs on the GitHub `windows-latest` runner in CI (proves the API calls don't crash/build); **real restore behaviour is T-100 manual checklist** (human).
- Never `Win+D`; aside = `ShowWindow(hwnd, SW_SHOWMINNOACTIVE)`, restore = `ShowWindow(hwnd, SW_RESTORE)` for journaled handles that are still iconic.

## S-4 — HTTPS page ↔ `ws://127.0.0.1` (PENDING)
Needs: Playwright chromium (approved install pending), a local HTTPS test page (self-signed), and a local WS on 127.0.0.1 with Origin check. Chrome's Local Network Access prompt may require human visual confirmation (it is a browser UI dialog). Scheduled with T-045 (client `AgentLink` + help card). Expected: Chrome/Edge/Firefox work with a possible one-time prompt; Safari blocks (already documented in TECHNICAL_DESIGN §9).
