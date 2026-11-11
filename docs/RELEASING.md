# RELEASING.md — Focus Agent build & release runbook

Owner: **A10 (Release & CI)** · Plan items: **T-110** (`agent/electron-builder.yml` + `agent/build/`),
**T-112** (`.github/workflows/release.yml`), **T-113** (per-OS AGENT_SMOKE job + first real installers),
**T-114** (signing/notarisation runbook), **T-115** (Dependabot + audit gating).
Last updated: 2026-11-10 (W4).

> **Hard rule:** tags are pushed **only by the human maintainer**. AI workers never run `git`
> (no branch, tag, commit or push commands) — they prepare the files and hand them to A0.
> Release artifacts are **unsigned by default**; every workflow path must pass without signing
> secrets. Signing/notarisation is optional and needs the secrets listed in §5.

---

## 1. Scope

This document covers packaging the **Focus Agent** (the Electron desktop app) and publishing its
installers. It does **not** cover the dashboard (Vercel) or API (Render/Railway) deployments — see
`docs/PLATFORMS.md` / the deployment section of the README once written.

Two files define the whole pipeline (plus the smoke launcher and dependency-update policy):

| File | What it does |
|---|---|
| `agent/electron-builder.yml` | Targets per OS, artifact names, NSIS/dmg/deb options, `asarUnpack` for `koffi`, draft-publish metadata, optional signing/entitlements. |
| `.github/workflows/release.yml` | Runs one native runner per OS, builds installers with `--publish never`, uploads workflow artifacts, runs the per-OS `AGENT_SMOKE` job, and creates a **draft** GitHub Release on tag pushes only. |
| `scripts/smoke/launch.mjs` | Launches the built agent with `AGENT_SMOKE=1`, drives the real loopback link (`hello` + `getState`) and exits 0 only when every assertion passed. Used locally and by the release smoke job. |
| `.github/dependabot.yml` | Weekly grouped npm + GitHub Actions PRs (no auto-merge) — §9. |

`electron-updater` is **not** installed and no update feed is consumed (auto-update is P2). The
GitHub `publish` block in `electron-builder.yml` exists only to declare the provider and
`releaseType: draft` — the workflow uploads with `gh release create`, never `electron-builder --publish`.

Two practical consequences of that block:

- `publish.owner` / `publish.repo` are **hard-coded** to the submission repository
  (`klrajput/Focus-Mode`) because electron-builder cannot infer them from `.git/config` in this
  npm-workspaces layout (`projectDir` is `agent/`); a `github` publish config without owner/repo
  resolves to `null` and crashes its update-info builder. Update both values if the repo is
  renamed/forked.
- With `--publish never` electron-builder still writes `latest*.yml` update-info files next to the
  installers and an `app-update.yml` inside `Contents/Resources/`. They are **not** uploaded (upload
  patterns are installer extensions only) and nothing reads them, because no updater ships.

---

## 2. What gets built (artifact matrix)

`${version}` comes from `agent/package.json` (currently `0.1.0`); `${arch}` is the runner arch.

| OS | Runner (GitHub Actions) | Targets | Artifact file pattern | Notes |
|---|---|---|---|---|
| Windows x64 | `windows-latest` | `nsis`, `portable` | `focus-mode-agent-<ver>-win-setup.exe`, `focus-mode-agent-<ver>-win-portable.exe` | Per-user install, **no admin** (`perMachine: false`, `allowElevation: false`), uninstaller included; app data (journal/settings) kept on uninstall (`deleteAppDataOnUninstall: false`). |
| macOS arm64 | `macos-latest` (Apple Silicon) | `dmg`, `zip` | `focus-mode-agent-<ver>-mac-arm64.dmg`, `…-mac-arm64.zip` | `NSAppleEventsUsageDescription` set for the JXA fallback. |
| macOS x64 | `macos-15-intel` | `dmg`, `zip` | `focus-mode-agent-<ver>-mac-x64.dmg`, `…-mac-x64.zip` | `macos-13` is retired — never use it. Intel runners are planned to retire fall 2027 (§8). |
| Linux x64 | `ubuntu-24.04` | `AppImage`, `deb` | `focus-mode-agent-<ver>-linux-x86_64.AppImage`, `…-linux-amd64.deb` | `rpm` is **optional and not built** (needs `rpm` tooling on the runner). |

Workflow artifact bundles are named `focus-agent-<name>` (`windows-x64`, `macos-arm64`,
`macos-x64`, `linux-x64`, retention 14 days), with the per-OS smoke logs as
`smoke-log-<name>`. The draft release receives the installers plus a generated `SHA256SUMS.txt`.

Bundle id / product name: `com.focusmode.agent` / **Focus Mode Agent**.

macOS architecture is chosen **per runner** in `release.yml` (`--arm64` on `macos-latest`, `--x64` on
`macos-15-intel`) and deliberately **not** pinned as an `arch` list in `electron-builder.yml`: an arch
list there makes electron-builder build both architectures on *every* macOS runner, duplicating the
artifacts (and breaking the draft release with duplicate asset names).

---

## 3. Release process (maintainer)

### 3.1 Pre-flight checklist

1. `main` CI green (`.github/workflows/ci.yml` matrix on 3 OSes, gitleaks, CodeQL).
2. Version bumped in `agent/package.json` (`0.1.0` → `0.1.1`, etc.). The git tag **must** match:
   `v<same version>`. Tag and package version drift makes artifact names misleading.
3. Release notes drafted (user-visible changes, known issues from `docs/KNOWN_ISSUES.md`).
4. Human OS checks for the version being shipped: T-100 (Windows) and/or T-101 (macOS) checklist
   evidence exists. **Compiling does not prove real window management works.**
5. A green **dry-run dispatch** of `release.yml` on `main` (all four build + all four smoke jobs
   green, no release created) — see §3.3.
6. Only then: create and push the annotated tag (maintainer, from a clean `main`):

   ```sh
   git checkout main
   git pull --ff-only
   git tag -a v0.1.1 -m "Focus Mode Agent v0.1.1"
   git push origin v0.1.1
   ```

### 3.2 What runs automatically

`push` of a `v*` tag starts `.github/workflows/release.yml`:

1. `build` — 4 jobs in parallel (one per OS/arch). Each: checkout → Node 22 (npm cache) →
   `npm ci` → build `shared` → build `agent` → `npx electron-builder <targets> --publish never` →
   upload installers as workflow artifacts (`focus-agent-<name>`).
2. `smoke` — 4 jobs in parallel (T-113), one per build job (`needs: build`). Each job
   (a) downloads that OS's installer artifact, asserts every expected extension is present, size
   > 1 MB, and prints its sha256; (b) runs `node scripts/smoke/launch.mjs`, which starts the agent
   with `AGENT_SMOKE=1`, waits for its single `SMOKE_READY port=<n>` line, connects a real `ws`
   client, asserts `hello.paired=false` + `hello.state=IDLE`, sends `getState`, asserts
   `state=IDLE` with no session, and requires the agent to exit 0 on its own (its 20 s failsafe
   exits 1; the launcher fails on any deviation). Linux runs it under `xvfb-run`. Each job uploads
   `smoke-log-<name>`. **HONEST LIMITATION:** launch.mjs resolves Electron from the checkout and
   drives the source-built `agent/dist`, so the smoke proves the packaged code + Electron boot
   headless — *not* that the installed dmg/exe/AppImage itself boots. Installer-level launch is the
   T-113 follow-up in §8, and the draft release stays draft until a human runs the real install
   checklist (§3.4).
3. `release` — tag pushes only and `needs: [build, smoke]`: downloads only the `focus-agent-*`
   installer artifacts (smoke logs excluded), generates `SHA256SUMS.txt`, creates a **draft**
   GitHub Release with `gh release create --draft`. `workflow_dispatch` runs skip this job
   (build + smoke only dry run).

### 3.3 Dry run without releasing (validated in W4)

Actions → **Release** → *Run workflow* (`workflow_dispatch`), or from a machine with `gh`:

```sh
gh workflow run release.yml --ref main
gh run list --workflow release.yml --limit 1     # get the run id
gh run watch <run-id> --exit-status              # wait for build + smoke
gh run view <run-id> --json conclusion,artifacts # real artifact names/sizes
```

The workflow file must already be on `main` for `gh workflow run … --ref main` to work. All four
build jobs and all four smoke jobs run; **the release job is skipped** because
`github.ref` is `refs/heads/main`. Artifacts produced by a dry run are `focus-agent-<name>`
(installers) and `smoke-log-<name>` (per-OS AGENT_SMOKE log), retention 14 days. This is the
mandatory pre-flight check before tagging (§3.1) and produces the canonical first real installers
for manual install verification (§6).

### 3.4 Publish

1. Open the draft release, check assets + `SHA256SUMS.txt` against the local downloads.
2. Run the manual launch checklist (install, pair window opens, quit works) on real hardware.
3. Edit notes if needed, then **Publish release**.
4. Never move/re-push a published tag: ship a new patch version instead.
5. `docs/AGENT_STATUS.md` / wave gate: record the release URL, artifact hashes and OS verification
   status (`NEEDS-HUMAN` until T-102 evidence exists).

---

## 4. Local packaging (developer dry run)

Always build `shared` first — the agent imports `@focus-mode/shared`, whose `dist/` must exist:

```sh
npm run build --workspace shared
npm run build --workspace agent
```

Then, from `agent/`:

```sh
npx electron-builder --mac --dir --publish never      # macOS .app directory, no installers
npx electron-builder --mac --arm64 --publish never    # dmg + zip
npx electron-builder --win --x64 --publish never      # NSIS + portable (needs Windows for full fidelity)
npx electron-builder --linux --x64 --publish never    # AppImage + deb (needs Linux for full fidelity)
```

Notes for this shared sandbox machine:

- `ELECTRON_BUILDER_CACHE=$PWD/.npmcache/electron-builder-cache` keeps electron-builder's cache inside
  the workspace (`~/Library/Caches` is not writable under the file sandbox).
- `CSC_IDENTITY_AUTO_DISCOVERY=false` avoids picking up stray local certificates for an unsigned test.
- `-c.electronDownload.cache=$PWD/../.npmcache/electron-cache` reuses the Electron zip already fetched
  by `node node_modules/electron/install.js` — without it the download stage tries to write
  `~/Library/Caches/electron` and fails with `EPERM` in this sandbox.
- `--dir` (app directory only) is the fastest packaging check. `hdiutil`-based `dmg` creation can be
  blocked by the sandbox (`hdiutil: create failed - Operation not permitted`) — that is an environment
  limit, not a config error; the macOS CI runner produces the dmg normally.
- Cross-OS builds are **not** equivalent to native builds; only the CI matrix produces the real
  Windows/Linux artifacts.

---

## 5. Signing & notarisation (optional)

Signing is entirely **secret-gated**: with no secrets the workflow passes and produces unsigned
artifacts. The same two variables work on Windows and macOS:

| Variable | Platform | Meaning |
|---|---|---|
| `CSC_LINK` | Windows + macOS | Base64 of the certificate file (`.pfx` for Windows, `.p12` for macOS), or a URL/path electron-builder accepts. |
| `CSC_KEY_PASSWORD` | Windows + macOS | Password of that certificate. |
| `APPLE_ID` | macOS only | Apple ID used by `@electron/notarize`. |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS only | App-specific password for that Apple ID. |
| `APPLE_TEAM_ID` | macOS only | Apple Developer team id. |

Add them under **Repo → Settings → Secrets and variables → Actions**. Never commit
certificates/keys; `.gitignore` covers `.env*`, and the PR gitleaks job catches accidental secrets.
The workflow passes them only as step env vars, so they do not leak into logs or artifacts.

- **Windows**: an OV/EV code-signing certificate is required to avoid SmartScreen "unknown publisher".
  Without it the NSIS/portable exes are unsigned (§6.1).
- **macOS**: signing needs a *Developer ID Application* certificate, notarisation additionally needs
  the three `APPLE_*` values. electron-builder runs `@electron/notarize` automatically when those are
  present (no `mac.notarize: false` override in the config). Set `CSC_*` and `APPLE_*` **together** or
  neither: with `APPLE_*` set but no signing identity, notarisation fails because the app is unsigned.
  Hardened runtime and the entitlements in `agent/build/entitlements.mac.plist` are applied **only
  when a signing identity exists** — an unsigned build skips codesign entirely.
- Verify a signed/notarised mac build:

  ```sh
  codesign --verify --deep --strict --verbose=2 "Focus Mode Agent.app"
  spctl --assess --type execute --verbose "Focus Mode Agent.app"
  xcrun stapler validate "focus-mode-agent-<ver>-mac-arm64.dmg"
  ```

- **Linux**: no signing required. Optional GPG signing of the AppImage is out of scope (P2).

Signing/notarisation itself is **NEEDS-HUMAN** in this environment: no certificates and no Apple
Developer account are available in the sandbox, so only the unsigned path is exercised.

---

## 6. Installing unsigned builds (user-facing)

Unsigned builds are a documented limitation (PROJECT.md C5, NFR-012), not hidden.

### 6.1 Windows (NSIS `.exe` / portable)

1. SmartScreen shows **"Windows protected your PC"** → *More info* → *Run anyway*
   (publisher appears as "Unknown publisher" until signing is enabled).
2. NSIS installs per-user (no admin prompt) and adds Start-menu/desktop shortcuts; the portable exe
   runs directly.
3. Uninstalling keeps app data (journal/settings) by design; delete
   `%APPDATA%\Focus Mode Agent` manually for a full reset.

### 6.2 macOS (`.dmg` / `.zip`)

1. Open the dmg, drag **Focus Mode Agent** to *Applications*.
2. First launch: **right-click the app → Open** (or try to open once, then *System Settings →
   Privacy & Security → Open Anyway*).
3. If the zip was downloaded and quarantined, you can clear the attribute explicitly:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/Focus Mode Agent.app"
   ```

4. The agent asks for **Automation / Apple Events** permission only if the JXA fallback is used
   (the explanation string ships in `NSAppleEventsUsageDescription`); denying it means the agent
   reports it cannot enforce focus rather than silently failing.
5. macOS arm64/x64 installers are produced on the CI matrix; **both need real-desktop verification**
   (T-101/T-102) before a release is called "verified".

### 6.3 Linux

- AppImage: `chmod +x focus-mode-agent-<ver>-linux-x86_64.AppImage && ./focus-mode-agent-<ver>-linux-x86_64.AppImage`
  (on systems without FUSE use `--appimage-extract` and run `squashfs-root/AppRun`).
- deb: `sudo apt install ./focus-mode-agent-<ver>-linux-amd64.deb` (apt resolves the Electron runtime deps;
  `dpkg -i` works but may leave dependencies unmet).
- Window-aside works on X11 only; Wayland reports `capabilities.focus = "unsupported"` (product
  limitation documented in `docs/PLATFORMS.md`).

---

## 7. Rollback / recovery

- A draft release can be deleted safely and the workflow re-run (same tag) after the fix.
- A **published** release should be fixed forward with a new patch tag; never rewrite a public tag.
- If a build job fails after uploads, artifacts remain attached to the workflow run for debugging
  (14-day retention); the draft release is only created when `release` runs.
- If signing secrets are wrong, remove/fix them and re-run the job — the pipeline still succeeds
  unsigned when secrets are absent, so a broken secret must be treated as a CI failure to fix, not
  worked around.

---

## 8. Known gaps / current limitations

| Item | Status | Notes |
|---|---|---|
| `AGENT_SMOKE=1` launch hook + per-OS smoke job (T-113) | **DONE (W4)** | `agent/src/main.ts` has the hook; `scripts/smoke/launch.mjs` proven locally and the `smoke` job now runs on every OS (`needs: build`) and gates the draft release (`release.needs: [build, smoke]`). Asserts installers exist + sha256, `SMOKE_READY`, `hello.paired=false`, `getState.state=IDLE`, self exit 0 within 20 s. Linux under Xvfb. |
| Installer-level launch from the artifact (T-113 follow-up) | **DONE (W7)** | The smoke job now boots the packaged app from the **uploaded artifact** (macOS zip → `.app`; Windows `windows-x64-unpacked` payload — the installer UI is not run in CI; Linux `AppImage --appimage-extract` → `squashfs-root`) and boots it with `AGENT_SMOKE=1` via `scripts/verify/smoke-packaged.mjs` using the **real** focus driver (packaged builds reject `AGENT_FOCUS_DRIVER=fake` by design) and no focus applied (state must stay `IDLE`). The source-built `agent/dist` smoke is retained as an extra signal. This exercises the real asar layout + flipped fuses (see §11.3). |
| Auto-update | Not implemented (P2) | No `electron-updater`, no `latest.yml`/blockmap feed. |
| `rpm` | Not built | Optional; would need `rpm` tools on the Ubuntu runner. |
| macOS Intel runner | Deprecated eventually | `macos-15-intel` retires fall 2027 (TD §16) — plan universal build or drop x64 via an ADR before then. |
| Signing / notarisation | NEEDS-HUMAN | No certificates in this environment; unsigned path only is CI-exercised. |
| Real install/launch smoke on each OS | NEEDS-HUMAN (T-113/T-102) | Draft release stays draft until a human runs the launch checklist. |
| `author` missing in `agent/package.json` | Warning only | electron-builder logs `author is missed in the package.json`. macOS/Windows targets are unaffected; `deb` uses `linux.maintainer`. Adding `author` is A7's file (`agent/package.json`) — cosmetic. |
| `@focus-mode/shared` `.map`/`.d.ts` inside asar | Low | electron-builder ships the dependency's whole `dist/` (maps/declarations included, a few KB). Harmless; can be trimmed later with an `onNodeModuleFile` hook. |
| Linux Wayland window-aside | Product limitation | X11 works; Wayland reports unsupported capability. |

---

## 9. Dependency updates (Dependabot) & audit gating

Policy: **every dependency bump is a human-reviewed PR — no auto-merge** (AGENTS.md §6 + DEC-009).
`.github/dependabot.yml` opens grouped PRs weekly (Mondays 04:00 UTC):

- **npm** (root workspace lockfile): one grouped PR for all minor/patch updates; major bumps stay
  individual. `typescript` and `@types/node` major updates are ignored on purpose (TypeScript is
  hard-pinned 5.9.3 because `typescript-eslint@8.x` peer-requires `<6.1.0`; `@types/node` 22.x maps
  to the Node 22 API surface per DEC-001).
- **GitHub Actions**: one grouped PR per week; Dependabot updates the pinned SHA + the `# vX.Y.Z`
  comment together.

### Audit gating decision (T-115, 2026-11-10)

`npm audit --omit=dev` currently reports:

```
found 0 vulnerabilities
```

The only findings in the tree are `14 moderate` **dev-only** transients in the
`typescript-eslint@8.72.2` dependency chain (`@typescript-eslint/*`), which are not shipped in any
artifact and are excluded by `--omit=dev`. Decision: the CI step **flipped from report-only to
blocking** at `--audit-level=critical` (`ci.yml` → *Audit production dependencies (blocking on
critical)*). With zero production advisories today this cannot false-fail the tree, and a future
*critical* production advisory now fails the PR instead of scrolling past. Moderate/high production
findings still do not fail CI — they are triaged at wave gates (`npm audit` output recorded in
`docs/AGENT_STATUS.md`/`docs/QA_REPORT.md`).

If the blocking audit ever fails: fix or upgrade in the same PR; if no fix exists, do **not** delete
the step — get A0 approval, record the advisory in `docs/KNOWN_ISSUES.md` with severity and a
re-review date, and only then add a narrowly documented ignore (`npm audit fix` / advisory-id
allowlist), never `--force` in CI.

---

## 10. Ownership & change control

- `agent/electron-builder.yml`, `.github/workflows/release.yml`, `agent/build/**`, `docs/RELEASING.md`
  are A10-owned; review with A7 for agent-runtime impact and A0 for release policy.
- Changing `appId`, `productName`, targets or artifact naming is a release-visible change: document it
  in the commit and, when it affects users (e.g. appId changes userData path), log an ADR in
  `docs/DECISIONS.md`.
- The `publish` block must stay `releaseType: draft`; auto-publishing on tag push is not allowed.

---

## 11. Security of artifacts (Electron fuses + asar contents)

Two independent defences are enforced on every packaged Focus Agent (SEC-8, task T-080/T-113):

### 11.1 Electron fuses

The `afterPack` hook in `agent/electron-builder.yml` calls `agent/build/flip-fuses.mjs` **after
packaging and before signing**. electron-builder imports that module and calls its exported
`afterPack(context)` (it does *not* spawn `node … <dir>`); the same file also supports manual CLI use:
`node agent/build/flip-fuses.mjs <appOutDir>`.

| Fuse | Required state | Why |
|---|---|---|
| `RunAsNode` | **Disabled** | `ELECTRON_RUN_AS_NODE` cannot turn the shipped app into a plain Node interpreter (arbitrary code execution gadget). |
| `EnableNodeOptionsEnvironmentVariable` | **Disabled** | `NODE_OPTIONS` injection into the packaged app is refused. |
| `EnableNodeCliInspectArguments` | **Disabled** | `--inspect`/`--inspect-brk` cannot attach a debugger to the packaged app. |
| `OnlyLoadAppFromAsar` | **Enabled** | Electron loads the app only from `app.asar` (no `app/` directory or next-to-asar shadowing). |
| `EnableEmbeddedAsarIntegrityValidation` | **Enabled** (macOS only — Electron does not implement it elsewhere) | asar Integrity is validated at launch. |
| `GrantFileProtocolExtraPrivileges` | **Disabled** | `file://` renders without extra privileges. |
| `EnableCookieEncryption` | **Enabled** | any accidental cookie store is OS-encrypted (the agent renderer has no cookies). |

The hook is **self-verifying**: it reads the fuse wire before and after the flip and fails the build if
the final state is not exactly the table above. On Apple Silicon the hook passes
`resetAdHocDarwinSignature: true`, so the unsigned arm64 build still launches after the binary is
modified.

Real before/after evidence (macOS arm64):

```
# Released artifact from release run 42858934575 (built BEFORE the hook existed) — insecure defaults:
  RunAsNode is Enabled
  EnableNodeOptionsEnvironmentVariable is Enabled
  EnableNodeCliInspectArguments is Enabled
  EnableEmbeddedAsarIntegrityValidation is Disabled
  OnlyLoadAppFromAsar is Disabled

# Same app after a local `electron-builder --mac --dir` build with the hook:
  RunAsNode is Disabled
  EnableCookieEncryption is Enabled
  EnableNodeOptionsEnvironmentVariable is Disabled
  EnableNodeCliInspectArguments is Disabled
  EnableEmbeddedAsarIntegrityValidation is Enabled
  OnlyLoadAppFromAsar is Enabled
  GrantFileProtocolExtraPrivileges is Disabled
```

CI gate: the release build job runs **“Verify Electron fuses (macOS/Windows)”** (`if: runner.os !=
'Linux'`) which executes `node_modules/.bin/electron-fuses read --app <packaged app>` and fails unless
`RunAsNode` / `EnableNodeOptionsEnvironmentVariable` / `EnableNodeCliInspectArguments` are Disabled,
`OnlyLoadAppFromAsar` is Enabled, `GrantFileProtocolExtraPrivileges` is Disabled, and (macOS)
`EnableEmbeddedAsarIntegrityValidation` is Enabled.

**Linux caveat:** the AppImage/deb payload has no standalone `.app`/`.exe` bundle the fuses CLI can read
in CI, so the fuses assertion is macOS/Windows only. The hook still runs on `linux-unpacked` before the
AppImage/deb are produced, and the asar-contents guard below still runs on Linux.

### 11.2 asar contents invariant

The shipped `app.asar` contains **only** our compiled app code + production dependencies. Required
entries: `/dist/main.js`, `/dist/ui/index.html`, `/dist/ui/preload.cjs`, `/package.json`. Forbidden
anywhere in the archive: `.env` files, any certificate/private-key material
(`.pem`, `.key`, `.p12`, `.pfx`, `.cer`, `.mobileprovision`, `.jks`, `.keystore`), our TypeScript
`src/`, and our own `dist/**/*.map` / test files. Dependency internals (e.g.
`node_modules/@focus-mode/shared/dist/*.map`, the published payload of a workspace dependency) are
expected and allowed — they are not secrets and not our sources.

CI gate: **“Verify packaged app.asar contents (no secrets/certs/sources)”** runs on every OS in the
release build job, lists the archive with `@electron/asar` and fails on a missing required entry or a
forbidden one.

### 11.3 Installer-level packaged smoke (from the uploaded artifact)

The release `smoke` job (W7) does not stop at the source-built app: it extracts the **packaged app
from the uploaded installer artifact** and boots it through the same `AGENT_SMOKE` contract:

| OS | Extraction | Launcher |
|---|---|---|
| macOS | `unzip` the produced `.zip` → `Focus Mode Agent.app` | `node scripts/verify/smoke-packaged.mjs "<…>.app"` |
| Windows | build job uploads `windows-x64-unpacked` (the exact payload the NSIS installer installs) → installer is **not executed** in CI because its UI hangs in a non-interactive runner session | `node scripts/verify/smoke-packaged.mjs "<win-unpacked>.exe"` |
| Linux | `AppImage --appimage-extract` (no FUSE needed) → `squashfs-root/focus-mode-agent` | `xvfb-run -a node scripts/verify/smoke-packaged.mjs "<binary>"` |

The packaged run uses `AGENT_FOCUS_DRIVER=real` (packaged builds deliberately reject `fake`) and the
`AGENT_SMOKE` hook never applies focus — the assertion requires `state === 'IDLE'` with no session, then
a self-exit 0 within 20 s. It therefore proves the installed app boots with the real asar layout and
the flipped fuses (`OnlyLoadAppFromAsar`/asar-integrity would fail here if broken), while still not
touching the user's other applications. Logs are uploaded as `smoke-log-<name>` (`packaged-smoke.log`).

### 11.4 Secret scanning (gitleaks, full history)

KI-021 (W7) fixed the last blanket exemption in `.gitleaks.toml`: **no `*.md` / `^docs/` path is
exempt any more** — a credential pasted into any Markdown file is caught. Path exemptions are limited
to the two files that intentionally contain example/template values, each listed with its own
comment:

| Exempt path | Why it is safe |
|---|---|
| `(^|/)\.env\.example$` | committed env **templates** only, values are `CHANGE_ME_*` placeholders |
| `^docs/INTEGRATION_CONTRACTS\.md$` | documentation whose JSON examples deliberately contain fake JWTs / fake HMAC / a fake public key |

The exam-mandated public demo identities (`Admin@123`, `Kabir@123`, `(admin|kabir)@demo.com`) are
allowlisted **by value** (not by file) because PDF §19 requires them to be public — they are the only
credential-shaped strings accepted anywhere in the repo. Test fixtures remain covered by their own
narrow path/regex allowlists (see the file comments).

CI scope (`ci.yml` → **secret scan (gitleaks)**): runs on **every pull request and every push to
`main`**; checkout uses `fetch-depth: 0` and the pinned gitleaks CLI (v8.30.1, checksum-verified) runs
`gitleaks git --config .gitleaks.toml --redact --no-banner --verbose`. `gitleaks git` walks the
commit history reachable from the checked-out ref (`git log -p`), i.e. **full history, not only the
current tree and not only the PR diff**; a job step prints `git rev-list --count HEAD` so the scanned
commit count is visible in the log. The job is blocking.

Reproduce locally:

```sh
gitleaks git --config .gitleaks.toml --redact --verbose   # scans full reachable history
```

If the scan flags something: **do not allowlist blindly**. Rotate the credential if real; if it is fake
test/example data, add the narrowest possible exception (a specific path, or a value regex) with a
comment explaining why it is safe, reviewed by A0 — and re-run the scan. Anything only removable by
rewriting history is a human+ADR decision, never a silent allowlist.

### 11.5 Verify locally

```sh
# 1. package the app (fuses are flipped by afterPack; the hook prints before/after)
cd agent && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --publish never
# 2. read the fuse wire independently
npx @electron/fuses read --app "release/mac-arm64/Focus Mode Agent.app"
# 3. manual re-flip / self-verification (idempotent, prints PASS)
node build/flip-fuses.mjs release/mac-arm64
 # 4. asar listing
npx @electron/asar list "release/mac-arm64/Focus Mode Agent.app/Contents/Resources/app.asar"
# 5. boot the PACKAGED app through the AGENT_SMOKE contract (real driver, no focus applied)
node scripts/verify/smoke-packaged.mjs "release/mac-arm64/Focus Mode Agent.app"
```

**Unsigned-build caveat:** fuses harden the runtime, they are **not** a substitute for code signing.
Unsigned artifacts are still subject to SmartScreen / Gatekeeper warnings (§6) and unsigned arm64
macOS builds stay un-notarised. **Secrets:** the fuse verification steps need **no** signing secrets;
certificates are only ever provided through the optional secret-gated env (§5) and must never be
committed or placed under `agent/build/`.

If a fuse/asar assertion fails in CI, the build is red and must not be released. Do **not** silently
weaken the fuse set: get A0 approval, record the deviation in `docs/KNOWN_ISSUES.md` (severity + reason)
and update this section in the same change.
