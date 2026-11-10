# DEMO_SCRIPT.md — 3–5 minute demo video script `[PDF §19]`

> **Owner:** A1 (script) · **Task:** T-126 (recording is **H** = human) · **Status:** **DRAFT for W9**; not yet recorded.
> **Exam requirement `[PDF §19]`:** the demo must show **pairing**, **start**, the **visible focus state**, and **end restoring normal use**. Submission window: 3–5 minutes.
> **Target runtime:** 4:30 (hard ceiling 5:00). Two variants: **A — real macOS desktop (preferred, proof of FOCUS-1/2)** and **B — FakeDriver fallback (clearly labelled, no OS control claimed)**.
> **Related:** [`README.md`](../README.md) (setup/credentials), [`docs/PLATFORMS.md`](PLATFORMS.md) (what is verified per OS), [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) (hosted variant), [`docs/RELEASING.md`](RELEASING.md) (installers).

## 1. What the video must prove

| Requirement | Segment in this script | Proof the viewer sees |
|---|---|---|
| Pairing (`[PDF §8/§10]`) | S3 | a real 6-digit code in the **agent** window → typed into `/devices` → **Connected** badge, no reload |
| Start focus (`[PDF §8]`) | S5 | consent modal read and confirmed → agent window/tray switches to FOCUSING |
| Visible focus state (`[PDF §8/§14]`) | S5–S6 | real windows step aside, browser stays; dashboard countdown ring; global focus indicator on other routes |
| End restores normal use (`[PDF §8/§13]`) | S7 | windows return; session recorded once in history; insights update |
| Reversibility / honesty | S2, S8–S10 | "the web page never touches the OS"; protected apps locked; limitations stated on camera |

## 2. Choose the variant

| | **A — Real desktop (macOS, preferred)** | **B — FakeDriver fallback** |
|---|---|---|
| OS control | Real `DarwinDriver` hides/minimises other apps | **No OS control** — state machine only |
| What it proves | FOCUS-1/FOCUS-2 for real on the demo OS (DEC-020) | dashboard/agent/API wiring, pairing, sessions, insights |
| Window aside/restore | Real (TextEdit/Notes/Calculator) | Simulated; must be labelled on screen |
| Tray/notification visuals | Real (still NEEDS-HUMAN to verify, KI-013) | Not shown |
| When to use | Default for the exam video | desktop unavailable/broken, or a CI-like dry run |

**Rule:** if you record variant B, display an on-screen label (e.g. a text overlay or a chapter title) saying **"FakeDriver — windows are not moved; production uses the real OS driver"**, and say it out loud. Never imply OS control from FakeDriver footage.

## 3. Pre-flight checklist (do this before pressing record)

```sh
# 0. from the repository root, fresh dependencies and build
npm install
npm run build -w @focus-mode/shared

# 1. environment files (first time only) — see README §5
cp server/.env.example server/.env
cp client/.env.example client/.env
cp agent/.env.example agent/.env
#    fill server/.env: MONGO_URI, JWT_SECRET, PAIR_PEPPER, ATTEST_PRIVATE_KEY/PUBLIC_KEY

# 2. idempotent demo data (admin + Kabir + ≥30 days of sessions/schedules/presets)
npm run seed

# 3. clean agent profile so the recording starts unpaired with a fresh 6-digit code
#    (journals/consent/device token live under this directory — never touch your real profile)
mkdir -p .tmp/demo-agent

# 4. start the stack (API :5000, dashboard :5173, agent with an isolated profile)
AGENT_USER_DATA_DIR="$PWD/.tmp/demo-agent" npm run dev
```

Recording hygiene:

- Use **Chrome / Edge / Firefox** (not Safari: it cannot open `ws://127.0.0.1` from an HTTPS dashboard — irrelevant locally, but do not risk it). Local dev is `http://localhost:5173`, so no local-network prompt appears.
- 1920×1080 (or 2560×1440 scaled to 1080p), cursor highlight on, system notifications **off**, personal windows closed.
- Never show `.env` files, terminal history with secrets, or a private browser profile. The agent never reads window titles, but the **screen recording** shows whatever is open — keep it clean.
- Log in as the demo **USER** in the main window (`kabir@demo.com / Kabir@123`). Pre-open a second tab/window logged in as the demo **ADMIN** (`admin@demo.com / Admin@123`) for the S9 glimpse, so you do not switch accounts on camera.
- Open the Focus Agent window once and position it beside the browser; its 6-digit code is the only place the code exists (DEC-003/A-03).
- Optional: pre-open the repository's `README.md` in an editor tab for the closing shot.

## 4. Timeline — Variant A (real macOS desktop), 4:30

| Time | Segment | Screen | What to say (narration beats) | Needs real desktop |
|---|---|---|---|---|
| 0:00–0:20 | **S1 Hook + landing** | `/` landing page | "Focus Mode — a MERN dashboard plus a local Focus Agent. The web page never touches the OS; the agent on your machine does. Everything is consented, visible and reversible." | no |
| 0:20–0:50 | **S2 Login → dashboard** | `/login` → `/dashboard` | "Log in as the demo user. The dashboard shows today's focus time, the next schedule, recent sessions — and the agent badge says *Not paired*. Start Focus is disabled with a reason: no device connected." | no |
| 0:50–1:25 | **S3 Pair the agent** | Focus Agent window → `/devices` → Pair dialog | "The agent window shows a 6-digit code. That code never travels over the browser or the local channel — it exists only in the agent UI. Type it here, confirm… and the badge flips to **Connected** without refreshing, authenticated by a short-lived EdDSA attestation." | no |
| 1:25–1:50 | **S4 Protected allow-list** | `/allowlist` | "Browsers, the Focus Agent itself and OS-critical apps are locked — they can never be removed or moved aside. User apps can be added; admin presets can be applied, and they can never touch the protected rows." | no |
| 1:50–2:35 | **S5 Start a 1-minute focus** | `/dashboard` Start card → consent modal → **Confirm** | Open a couple of harmless apps first (TextEdit/Notes + Calculator) and keep the browser in front. Read the modal: "Start a 1-minute focus session? These stay open: browsers, the Focus Agent, system essentials, allow-listed apps. These will step aside — minimised or hidden, **not closed**. You can end any time." Click **Confirm — start focus**. "Other apps move aside now; the browser stays." First run also shows the agent's native consent dialog (**Allow and continue**, REC-004/§5.1). | **YES — window movement** |
| 2:35–3:10 | **S6 Visible focus state** | `/focus` countdown ring → another route (e.g. `/insights`) | "The dashboard counts down from the agent's absolute end time — not a local timer — and a global focus indicator stays visible on every authenticated page. The agent window/tray shows FOCUSING and its own End focus control." | partly (tray click is NEEDS-HUMAN) |
| 3:10–3:40 | **S7 End → restore** | `/focus` **End Focus** → desktop → `/dashboard` recent | "End it from the dashboard. The agent restores exactly the windows it changed; windows I had already minimised stay minimised. The session is finalised once and appears in history. Ending early records it as cancelled; letting the timer hit 0:00 records it completed." | **YES — restore** |
| 3:40–4:05 | **S8 Schedule glimpse** | `/schedules` | "A weekday schedule, interpreted in my timezone. When it's due, a running agent first shows a cancellable ≥10-second heads-up and starts focus as a scheduled session; if the agent is offline the run is recorded as missed with a notification — the cloud can never force focus." | no (heads-up pop is NEEDS-HUMAN on camera) |
| 4:05–4:25 | **S9 Insights + admin glimpse** | `/insights` → admin tab `/admin` | "Insights: focused time, completion, streaks, best hours — computed from finished sessions only, in my timezone. Admin sees aggregate counts only, never anyone's session detail." | no |
| 4:25–4:35 | **S10 Close** | README tab | "Safety recap: no telemetry, protected apps never touched, quit always restores, the cloud cannot command focus. Architecture, decisions and known limitations are in the repo docs." | no |

**Budget check:** 4:35 total → trim S8 to ~15 s if needed. Keep S5–S7 uncut: they are the graded flow.

## 5. Click-by-click detail (what exactly to click)

**S2** — `/login`: fields `Email`, `Password` → **Log in**; land on `/dashboard`; hover the **Not paired** badge (icon + text) and the disabled **Start Focus** button showing its reason.

**S3** — Focus Agent window (opened by `npm run dev`): note state `UNPAIRED` + the 6-digit code. Browser: `/devices` → **Pair a device** → type the 6 digits → **Pair** (confirm dialog). Wait for the agent window to show `PAIRED` and the badge **Connected**. Do **not** refresh the page.

**S4** — `/allowlist`: scroll the locked rows (browsers / Focus Agent / system essentials, lock icon); optionally add one harmless app via the picker (e.g. TextEdit/Notes) and **Save**; show a preset card.

**S5** — open TextEdit (or Notes) and Calculator, keep the browser in front. `/dashboard` → duration chips → **Custom** → `1` → **Start Focus** → consent modal → read the four sections → **Confirm — start focus**. If the agent's native first-run dialog appears, click **Allow and continue** (say: "the page cannot answer this — the agent asks locally").

**S6** — `/focus`: countdown ring + **End Focus**; then `/insights` (indicator still visible) and back.

**S7** — **End Focus** → switch to the desktop: windows back. `/dashboard`: recent sessions shows the finished session; `/insights` updates. (Optional extra proof: re-open the agent window — state back to `PAIRED`.)

**S8** — `/schedules`: show an existing schedule (seeded: weekday 09:00 and similar), open the form, show days/time/duration/timezone; save. (Do not wait for a real due minute on camera unless you have planned the 2-minute scheduling trick from the deployment smoke test — optional.)

**S9** — `/insights` (totals, chart, streak, completion, best hours) → switch to the pre-logged-in ADMIN tab → `/admin`: users table, presets, agent links, **aggregate stats** card; say "no per-user session rows".

## 6. Variant B — FakeDriver fallback (3:10, clearly labelled)

Use when no real desktop is available for the recording. **Put the label on screen for the whole recording** (title card + a corner text), e.g. „FakeDriver demo — windows are not moved; the real OS driver is verified separately“.

```sh
# same pre-flight as §3, but start the stack with the fake driver:
AGENT_FOCUS_DRIVER=fake AGENT_USER_DATA_DIR="$PWD/.tmp/demo-agent" npm run dev
```

Timeline: S1 0:00–0:20 · S2 0:20–0:45 · S3 pairing 0:45–1:15 · S4 allowlist 1:15–1:35 · S5 consent + start (say clearly: "the driver here is simulated; on a real desktop these windows would be minimised") 1:35–2:05 · S6 countdown/indicator 2:05–2:30 · S7 end + session/insights 2:30–2:55 · S8 schedules + S9 admin/insights 2:55–3:10.

Variant B proves: the full dashboard ↔ agent ↔ API wiring, attested pairing, consent, session lifecycle and analytics. It does **not** prove OS window control — say so, and cite the real macOS evidence instead: `npx tsx scripts/verify/macos-focus-smoke.ts` → `PASS darwin/arm64` (DEC-020), plus the Phase-8 manual checklist status in `docs/PLATFORMS.md` §7.

## 7. Contingencies (rehearse these)

| Problem | Fix on camera (or cut) |
|---|---|
| Badge stays "Not paired" after pairing | Wrong port/agent not running: check `AGENT_PORT`/`VITE_AGENT_PORT` match; restart agent; verify dashboard shows no local-network error. Do not fake the badge. |
| Agent window shows no code | Agent already paired with the isolated profile: stop it, delete `.tmp/demo-agent`, restart. |
| Start disabled | No connected device, allow-list still loading, or `capabilities.focus === "unsupported"` (Wayland) — this is honest product behaviour; show the reason instead of overriding. |
| Windows do not move (Variant A) | Read `capabilities.reasons` in the agent window; macOS should be `focus:"full"`. If it failed, switch to Variant B **with the label**, or re-record. |
| Windows do not restore | The tray/window **End focus** always works (INV-5); click it, verify the journal cleared and app state returns to `PAIRED`. Never edit the journal live. |
| Timer not ended at exactly 0:00 | The dashboard derives the countdown from the agent's `endsAt`; the agent ends on its own. Wait 1 s and continue. |
| Scheduler minute missed | Free-tier/idle API (§4.2 of DEPLOYMENT.md): wake the API and skip the live heads-up on camera; show the schedules page instead. |

## 8. Post-record verification (evidence for `docs/QA_REPORT.md`)

```sh
# the session you recorded really exists exactly once, and insights reflect it
curl -sS http://localhost:5000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"kabir@demo.com","password":"Kabir@123"}'            # copy accessToken
curl -sS http://localhost:5000/api/v1/sessions -H "authorization: Bearer <token>"
curl -sS "http://localhost:5000/api/v1/insights?range=7d" -H "authorization: Bearer <token>"

# the agent journal is cleared after restore (no stuck focus) — the file must be absent
ls "$PWD/.tmp/demo-agent" | grep -i journal || echo "no journal — clean restore"
```

Record in `docs/QA_REPORT.md`: date, variant (A/B), OS + version, agent build, duration, what was shown, and the command output summary. If any graded segment (pairing/start/visible focus/restore) is missing or faked, the video is invalid — re-record.

## 9. NEEDS-HUMAN register for the demo

| Item | Why human |
|---|---|
| Recording, narration, editing | Only a person can record and publish the video (`T-126` is marked **H**) |
| Real window hide/restore footage (Variant A) | Needs a physical desktop; macOS is verified locally, Windows/Linux real behaviour is NEEDS-HUMAN (`docs/PLATFORMS.md` §7) |
| Tray-menu click + OS notification visuals | Native menus/notifications cannot be driven/read by Playwright (KI-013) — show them manually or narrate over the agent window |
| Publishing the video | Hosting/upload decision at W9 |
