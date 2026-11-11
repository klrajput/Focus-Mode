# RELEASE_HANDOFF.md — final release handoff (maintainer one-pager)

> **Owner:** A10 (Release & CI) · **Audience:** the human maintainer + A0 · **Tasks:** T-122
> (agent download links), T-114 (signing), T-128 (release), W8/W9 handoff.
> **Status: PRE-TAG / NEEDS-HUMAN.** Verified 2026-11-11: no GitHub Release exists
> (`gh api repos/klrajput/Focus-Mode/releases --jq length` → **0**), remote tags = `contracts-v1`
> only (no `v*` release tag yet), `agent/package.json` version = **0.1.0**.
> Every step below that needs a human is marked **[NEEDS-HUMAN]**; CI cannot tag or publish.

Sibling docs: [`RELEASING.md`](RELEASING.md) (full build/sign/install runbook), [`QA_CHECKLISTS.md`](QA_CHECKLISTS.md)
(phase-8 manual matrix), [`DEPLOYMENT.md`](DEPLOYMENT.md) (hosting/env), [`QA_REPORT.md`](QA_REPORT.md)
(W7 gate evidence).

---

## 0. What is already proven automatically (do not redo manually)

| Evidence | Where |
|---|---|
| Latest successful release dry-run **`42977816541`** (`main@44b756aa`, dispatch): **success** — 4/4 builds, 4/4 source `AGENT_SMOKE`, **4/4 packaged-artifact smoke**, fuses + asar gates PASS, publish job **skipped**, **0 releases** | <https://github.com/klrajput/Focus-Mode/actions/runs/42977816541> |
| Full-history secret scan (`gitleaks git`, 140 commits reachable / 104 scanned / 3.75 MB / no leaks) | CI run `42973587488`, job `secret scan (gitleaks)` |
| Unit/integration + E2E + coverage + perf evidence | [`QA_REPORT.md`](QA_REPORT.md), [`QA_NOTES.md`](QA_NOTES.md) |
| macOS real hide/restore | `npx tsx scripts/verify/macos-focus-smoke.ts` (DEC-020) |

**Still human-gated (cannot be proven by CI):** real-OS window move/restore on Windows (T-100) and
macOS install launch (T-101/T-102), tray/native visuals, signed/notarised builds (no certificates),
the first tag, publishing the draft release, and publishing admin download links (T-122).

---

## 1. Preconditions **[NEEDS-HUMAN]**

- [ ] `main` CI green (`.github/workflows/ci.yml`: lint, format, typecheck, build, 3-OS tests, audit,
      gitleaks full-history).
- [ ] W7 gate evidence recorded in `docs/AGENT_STATUS.md` / `docs/QA_REPORT.md`.
- [ ] **Version decision:** bump `agent/package.json` `version` (currently `0.1.0`) to the release
      version and choose the matching tag `v<version>` — names/URLs must agree (`0.1.1` ⇔ `v0.1.1`).
      The release workflow names assets from `agent/package.json`, **not** from the tag.
- [ ] **Signing decision:** unsigned (default, no secrets) **or** set the signing secrets before the
      tag (§5 of `RELEASING.md`; macOS Developer ID + notarisation and/or Windows Authenticode).
      Empty secrets = unsigned build; that path is CI-proven.
- [ ] Demo-credential decision for the public deployment: rotate `SEED_*` if the dashboard/API are
      publicly reachable (see `DEPLOYMENT.md` §10 — never expose a public admin with a known password).
- [ ] Human OS smoke plan confirmed: at minimum the demo OS (macOS arm64) install+launch+pair+quit.

## 2. Push the tag (maintainer only — AI workers never run git)

```sh
# from a clean, up-to-date main; tag MUST equal agent/package.json version
git checkout main && git pull --ff-only
git tag -a v0.1.1 -m "Focus Mode Agent v0.1.1"
git push origin v0.1.1
```

A pushed `v*` tag starts `.github/workflows/release.yml`. `workflow_dispatch` runs are dry runs and
**never** create a release.

## 3. What the tag workflow does

1. `build` — Windows x64 (NSIS + portable), macOS arm64 (dmg + zip), macOS x64 (dmg + zip,
   `macos-15-intel`), Linux x64 (AppImage + deb) on native runners; then the security gates:
   **Verify Electron fuses** (macOS/Windows) and **Verify packaged app.asar contents** (all OS).
2. `smoke` — per-OS source-build `AGENT_SMOKE` **and** the [W7] packaged-artifact smoke
   (`scripts/verify/smoke-packaged.mjs`; macOS `.app`, Linux `squashfs-root`, Windows the uploaded
   `win-unpacked` payload; real driver, no focus applied, `hello.paired=false`, IDLE, exit 0).
   Logs: `smoke-log-<name>` artifacts containing `smoke.log` + `packaged-smoke.log`.
3. `release` — **tag pushes only**, `needs: [build, smoke]`: downloads only `focus-agent-*`
   artifacts, writes `SHA256SUMS.txt`, and creates a **draft** GitHub Release with
   **9 assets = 8 installer files + `SHA256SUMS.txt`**.

Inspect it with:

```sh
gh run list --workflow release.yml --limit 1
gh run view <run-id> --json conclusion,jobs          # expect success; release job not skipped on a tag
gh release list --exclude-drafts | head              # draft is hidden here until published
gh release view v0.1.1 --json isDraft,assets         # isDraft=true, 9 assets
gh api repos/klrajput/Focus-Mode/actions/runs/<run-id>/artifacts \
  --jq '.artifacts[] | [.name, .size_in_bytes, .id] | @tsv'   # workflow artifacts, incl. smoke logs
```

## 4. Assets in the latest dry-run (`42977816541`) — dry-run baseline

Workflow artifacts (GitHub Actions, **not** release assets):

| Workflow artifact (dry-run) | Bytes | id |
|---|---:|---:|
| `focus-agent-windows-x64` | 233,420,768 | 13836217654 |
| `focus-agent-macos-arm64` | 238,320,248 | 13836695263 |
| `focus-agent-macos-x64` | 252,051,566 | 13836735625 |
| `focus-agent-linux-x64` | 228,868,599 | 13835913466 |

The 8 **installer files** those artifacts contain (from the CI size/sha256 verification step, version
`0.1.0`; a real tag rebuilds them with the new version) — these are the draft-release assets:

| Installer file | Bytes | sha256 |
|---|---:|---|
| `focus-mode-agent-0.1.0-win-setup.exe` | 122,376,423 | `62b132c46f5922dd18f142929ff5a2aa79e43636d2a3785743b9843b3ee8c7ee` |
| `focus-mode-agent-0.1.0-win-portable.exe` | 111,031,696 | `625624bada9ddd36e545ca5ebbff024d159ac7b9e8bac782b6d0493e9373ec2e` |
| `focus-mode-agent-0.1.0-mac-arm64.dmg` | 121,227,810 | `803a19540b1f41def8fb8f479e23ca0a88c093aca65f5b60c898c46263ec564d` |
| `focus-mode-agent-0.1.0-mac-arm64.zip` | 117,688,896 | `b4aa3bcedb986343cdc84a717d637903d31142100d6eb5a484fa046cd08514d1` |
| `focus-mode-agent-0.1.0-mac-x64.dmg` | 128,119,814 | `ed5b38f2d72efecef631666a8e830a37412c4485058ec554ccb05ba3657730ee` |
| `focus-mode-agent-0.1.0-mac-x64.zip` | 124,583,735 | `dcb683c040d051f4becacf3674b8354db9349ff46bec1b3a32b7c49d788ea8eb` |
| `focus-mode-agent-0.1.0-linux-x86_64.AppImage` | 127,553,381 | `6ba501ae7b05bf563fe45aa75c56b095da297382a58c74e9a943675696fd058a` |
| `focus-mode-agent-0.1.0-linux-amd64.deb` | 101,891,560 | `9db95680ca884aeecb00349b2347e290a5a47e95f72090a0a72f00009960e3dc` |

Packaged-smoke PASS lines from that run: macOS arm64/x64 `.app` and Linux `squashfs-root/focus-mode-agent`
and Windows `smoke-unpacked\Focus Mode Agent.exe` → all `[smoke-packaged] PASS packaged agent booted, served hello/state and exited 0`.

## 5. Publish the draft + get the real asset URLs **[NEEDS-HUMAN]**

```sh
# 1. review the draft (assets + notes), then publish it (UI "Publish release" or:)
gh release edit v0.1.1 --draft=false
gh release view v0.1.1 --json isDraft,assets --jq '{isDraft, assets: [.assets[].name]}'

# 2. the 8 public asset URLs (available only AFTER publishing; pattern:
#    https://github.com/klrajput/Focus-Mode/releases/download/v<version>/<file>)
gh api repos/klrajput/Focus-Mode/releases/tags/v0.1.1 \
  --jq '.assets[].browser_download_url' | sort
```

A draft release's asset URLs are **not** public links — publish first, then copy the eight URLs
(`*-win-setup.exe`, `*-win-portable.exe`, `*-mac-arm64.dmg`, `*-mac-arm64.zip`, `*-mac-x64.dmg`,
`*-mac-x64.zip`, `*-linux-x86_64.AppImage`, `*-linux-amd64.deb`).

## 6. T-122 — publish the admin agent download links **[NEEDS-HUMAN]**

The dashboard's Download buttons read the **public** `GET /api/v1/agent-links` list, published via the
**admin** API (`POST /api/v1/admin/agent-links`, contract: `docs/INTEGRATION_CONTRACTS.md` §3.1
#25/#33, response object `{id, os, arch, label, url, version, publishedAt}`). The four primary links
are one per OS/arch; the zip/portable/deb files are optional alternates.

```sh
API_BASE="https://<api-host>/api/v1"          # or http://localhost:5000/api/v1 when testing locally
VER="0.1.1"                                   # release version, no leading "v"
BASE="https://github.com/klrajput/Focus-Mode/releases/download/v${VER}"

# 1. admin token (rotate seeded passwords before any public deployment — DEPLOYMENT.md §10)
TOKEN=$(curl -sS -X POST "$API_BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.com","password":"Admin@123"}' | jq -r '.data.accessToken')

# 2. create the four primary links (os ∈ macOS|windows|linux, arch ∈ x64|arm64|universal)
post_link() {
  curl -sS -X POST "$API_BASE/admin/agent-links" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$1" | jq .
}
post_link '{"os":"macOS","arch":"arm64","label":"Focus Agent for macOS (Apple silicon)","url":"'"$BASE"'/focus-mode-agent-'"$VER"'-mac-arm64.dmg","version":"'"$VER"'"}'
post_link '{"os":"macOS","arch":"x64","label":"Focus Agent for macOS (Intel)","url":"'"$BASE"'/focus-mode-agent-'"$VER"'-mac-x64.dmg","version":"'"$VER"'"}'
post_link '{"os":"windows","arch":"x64","label":"Focus Agent for Windows (x64 installer)","url":"'"$BASE"'/focus-mode-agent-'"$VER"'-win-setup.exe","version":"'"$VER"'"}'
post_link '{"os":"linux","arch":"x64","label":"Focus Agent for Linux (AppImage)","url":"'"$BASE"'/focus-mode-agent-'"$VER"'-linux-x86_64.AppImage","version":"'"$VER"'"}'
```

Expected `201 Created` body:

```json
{"success":true,"data":{"id":"<mongo-id>","os":"macOS","arch":"arm64","label":"Focus Agent for macOS (Apple silicon)","url":"https://github.com/klrajput/Focus-Mode/releases/download/v0.1.1/focus-mode-agent-0.1.1-mac-arm64.dmg","version":"0.1.1","publishedAt":"2026-…"}}
```

Server-side validation (already shipped, C-25): `url` must be absolute **https** on `github.com` or
`objects.githubusercontent.com`, no credentials, ≤2048 chars; `label` 2–60 chars; `version` without a
leading `v`; unknown fields are rejected (`400 VALIDATION_ERROR`). Links are validated the same in the
admin dialog at `/admin` → *Agent links*.

Optional alternates (same endpoint, different labels): `…-win-portable.exe`,
`…-mac-arm64.zip` / `…-mac-x64.zip`, `…-linux-amd64.deb`.

Verify:

```sh
# public list (no auth) — should return exactly the published links, sorted os/arch
curl -sS "$API_BASE/agent-links" | jq '.data.items[] | {os,arch,label,url,version}'
# admin list
curl -sS "$API_BASE/admin/agent-links" -H "Authorization: Bearer $TOKEN" | jq '.data.total'
```

In the browser: open the dashboard `/` (landing) and `/settings` — the Download section must render
one link per OS/arch with the published labels (component: `client/src/components/settings/download-links.tsx`;
it only offers absolute HTTPS URLs and groups by OS). Click one: it must download the same filename
whose sha256 is in `SHA256SUMS.txt`.

Rollback if a URL is wrong **[NEEDS-HUMAN]**:

```sh
# fix the URL in place (preferred) …
curl -sS -X PATCH "$API_BASE/admin/agent-links/<id>" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"url":"https://github.com/klrajput/Focus-Mode/releases/download/v0.1.1/<correct-file>"}'
# … or delete the bad link entirely
curl -sS -X DELETE "$API_BASE/admin/agent-links/<id>" -H "Authorization: Bearer $TOKEN" | jq .
# then re-check the public GET /agent-links (the dashboard invalidates its cache on admin mutations)
```

If the **release assets** themselves are wrong: delete the draft (`gh release delete v0.1.1 --yes`) or
delete the bad asset (`gh release delete-asset v0.1.1 <file> --yes`) and re-upload; once a release is
**published**, never move/re-push the tag — ship a new patch version (§7 of `RELEASING.md`).

## 7. Post-release verification **[NEEDS-HUMAN]**

1. Download all 8 assets from the published release URLs; `shasum -a 256 -c SHA256SUMS.txt` → all OK.
2. Install on the demo OS: macOS `.dmg` (right-click → Open for unsigned; §6.2 of `RELEASING.md`),
   Windows `.exe` (SmartScreen → More info → Run anyway), Linux AppImage (`chmod +x`) / deb (`apt install ./…`).
3. Launch the agent, pair with the dashboard using the 6-digit code, start/end a short focus session,
   confirm restore/normal use, quit from the tray — fill in `docs/QA_CHECKLISTS.md`.
4. Confirm `/` and `/settings` download buttons still point at the published assets.
5. **If the build was signed** (secrets configured before the tag), verify the signatures too:
   ```sh
   # macOS (inside the installed .app)
   codesign -dv --verbose=4 "Focus Mode Agent.app"          # Authority=Developer ID Application, TeamIdentifier set
   spctl -a -vv "Focus Mode Agent.app"                      # accepted / Notarized Developer ID
   xcrun stapler validate "focus-mode-agent-<ver>-mac-arm64.dmg"
   # Windows
   signtool verify /pa /v "focus-mode-agent-<ver>-win-setup.exe"
   ```
   An unsigned build (the default) shows Electron's ad-hoc signature only — that is expected (§5.5/§6.2
   of `RELEASING.md`), and the human "right-click → Open" steps still apply.
6. Record OS/date/installer sha256 + screenshots in `docs/QA_CHECKLISTS.md`; update
   `docs/AGENT_STATUS.md`, `docs/QA_REPORT.md`, `RELEASE_NOTES.md`.

## 8. Remaining human-gated list

- [ ] Tag `v<version>` push (maintainer) — **[NEEDS-HUMAN]**
- [ ] Review + **publish** the draft release — **[NEEDS-HUMAN]**
- [ ] Signing/notarisation: macOS Developer ID + notarisation, Windows Authenticode (`RELEASING.md` §5) — **[NEEDS-HUMAN]**
- [ ] T-122 admin link publication + landing/settings check — **[NEEDS-HUMAN]**
- [ ] Real-OS runtime: Windows window-aside (T-100), macOS installed-app behaviour (T-101/T-102) — **[NEEDS-HUMAN]**
- [ ] Native visuals/tray verification, demo video (T-128) — **[NEEDS-HUMAN]**
- [ ] Live deployment of dashboard/API (T-120/T-121, `DEPLOYMENT.md`) — **[NEEDS-HUMAN]**
- [x] A1: `README.md` links this handoff and quotes run `42977816541` (W7 refresh, `787a75f`); the W6 run `42873654284` remains only as a historical packaging reference.
