# PROMPTS.md — key prompts used to build Focus Mode

> Exam requirement [PDF §19]: keep the key prompts that produced the project, with a one-line
> outcome each. This is a curated log (10–20 entries, newest last); A0 curates it at T-124.
> Every entry is a prompt that was actually used in this session.

| # | Prompt (summarised) | Outcome |
|---|---|---|
| 1 | "Read the blueprint docs in order, then report your environment: tools, MCP, skills, sub-agents, Workflow, Agent Teams, shell/network/git, OS/Node versions — write it truthfully to `docs/AGENT_STATUS.md` and ask the blocking questions." | Capability report written; MCP limitation documented; 10 blockers raised (2026-11-10 18:11 IST). |
| 2 | "Prove it: launch two workers at once (one sub-agent, one teammate) and one Workflow script, and report their real outputs." | Sub-agent `ee2de422…` and teammate `probe-teammate` returned independently in one turn; Workflow `workflow-1` completed (node v26.11.1, git 2.53.0) — real parallelism confirmed. |
| 3 | "Spike S-2: does macOS `NSRunningApplication.hide()/unhide()` work through `osascript -l JavaScript` without TCC permission, and is the hidden state readable afterwards?" | PASS: hide/unhide work with no permission prompt; BOOL return unreliable; same-process state stale → design changed to one-shot calls + separate verification (DEC-005). |
| 4 | "Spike S-3: detect the OS default browser so it can be added to the protected set — no fragile plist parsing." | PASS: `NSWorkspace.URLForApplicationToOpenURL` → `/Applications/Google Chrome.app`; bundle id resolved at agent start (DEC-006). |
| 5 | "Verify every pinned dependency with `npm view <pkg> version` before pinning; TypeScript must be exactly 5.9.3; check the peer ranges." | 48 packages re-verified, all matching the blueprint; TS latest 7.0.2 rejected (typescript-eslint peer `<6.1.0`); `@types/node` pinned 22.20.5 (DEC-001/DEC-009). |
| 6 | "As A10 Release & CI Engineer, build the npm-workspaces scaffold (T-001) — exact pins, strict TS, ESLint 10 flat config, real minimal placeholders — and paste the real lint/typecheck/build output." | W0 scaffold task launched with shared board task `task-1`; outcome recorded in `docs/AGENT_STATUS.md`. |
| 7 | "As A1 Requirements Analyst, validate requirement traceability (T-003) programme­tically: every PDF ID → task, no dangling task IDs — paste the command output." | W0 traceability task launched (`task-2`); outcome recorded in `docs/AGENT_STATUS.md`. |
| 8 | "As A3 UI/UX Designer, write the UX spec (T-007) with a *computed* WCAG contrast table (no estimated numbers), wireframes, consent-modal copy and the full copy deck." | W0 UX spec task launched (`task-3`); outcome recorded in `docs/AGENT_STATUS.md`. |
