# SPEC.md — where the specification lives

This repository implements **Focus Mode — Distraction Lockdown Dashboard** (W3Grads Full Stack
Vibe Coding Examination, Problem Statement 03): a React dashboard + Express/MongoDB API + an
Electron **Focus Agent** (the only component that touches the OS).

## Ranked sources of truth
1. **`PS3_Focus_Mode_Lockdown_Dashboard.pdf`** — the exam paper. Not stored in this repository
   (the PDF is marked "For examination use only · Do not redistribute"; see DEC-010). Pending the
   human supplying it (blocker BL-01).
2. **`project-blueprint/`** — the machine-readable blueprint derived from the PDF
   (`PROJECT.md`, `REQUIREMENTS.md`, `TECHNICAL_DESIGN.md`, `IMPLEMENTATION_PLAN.md`,
   `AGENTS.md`, `PLUGINS_AND_TOOLS.md`, `docs/`). Untracked in git per DEC-010 until the human
   decides on repository visibility.
3. **This `docs/` directory** — the team's own living documents: `AGENT_STATUS.md` (system of
   record for status/evidence/gates), `DECISIONS.md` (ADRs), `INTEGRATION_CONTRACTS.md`
   (frozen REST/WS contracts), `KNOWN_ISSUES.md`, `REQUIREMENT_TRACEABILITY.md`, `UX_SPEC.md`,
   `SPIKES.md`, `PLATFORMS.md`, `QA_REPORT.md`, `SECURITY_REVIEW.md`, `VIVA_NOTES.md`,
   `RELEASING.md`, `DEMO_SCRIPT.md`.

## Tags used everywhere
- **[PDF §n]** stated in the exam PDF · **[REC]** recommendation added by the architects ·
  **[DEC]** a decision taken where the PDF is ambiguous (recorded in `docs/DECISIONS.md`).

## Terminology
- **Focus Agent** = the installed Electron desktop companion app (the PDF's "local agent").
- **AI worker** = a DeepSeek Harness sub-agent / teammate. Never abbreviated to "agent" alone in
  code comments, docs or commit messages.

## How to read the blueprint
`PROJECT.md` (overview, priorities, success criteria) → `REQUIREMENTS.md` (testable FR/NFR/REC) →
`TECHNICAL_DESIGN.md` (architecture, protocol, threat model) → `IMPLEMENTATION_PLAN.md` (phases,
tasks T-001…T-133, wave gates) → `AGENTS.md` (roster, file ownership, invariants, git rules).
