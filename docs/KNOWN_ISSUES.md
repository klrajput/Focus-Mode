# KNOWN_ISSUES.md — defects and accepted limitations

> Owner: A8 (Integration Engineer) maintains this file; anyone may report through A0.
> Severity (AGENTS.md §15): **Critical** (data loss, focus stuck, protected app touched, security hole) · **High** (P0 feature broken) · **Medium** · **Low**.
> Critical/High block release. A flaky test is a bug: fix it or quarantine it here — never silently skip it.
> Format: `| id | severity | description | repro | owner | status |`.

| id | severity | description | repro | owner | status |
|---|---|---|---|---|---|
| KI-001 | Low | npm's default cache `~/.npm` is root-owned on this dev machine → `EPERM` on installs. Workaround: `npm_config_cache=<repo>/.npmcache` (DEC-002). CI unaffected. | run `npm install` without the env var | A0 | mitigated (permanent fix: `sudo chown -R 501:20 ~/.npm`) |
| KI-002 | Low | MCP servers (Playwright MCP, Context7, MongoDB MCP) cannot be registered from this session (no registration tool; profile config outside sandbox) → fallbacks used (DEC-004). | `list_agents`/tools show no MCP tool | A0 | accepted limitation |
| KI-003 | Medium | Original exam PDF absent → blueprint treated as authoritative (DEC-003). Any blueprint-vs-PDF delta is currently undetectable. | n/a | A1/A0 | open until human supplies PDF |
| KI-004 | Medium | Safari cannot open `ws://127.0.0.1` from an HTTPS dashboard (TECHNICAL_DESIGN §9). Documented as unsupported browser for the deployed dashboard; help card in UX spec (T-045/T-056). | open deployed dashboard in Safari | A4/A9 | accepted limitation, documented |
| KI-005 | High (pending) | Real window-management behaviour on Windows and Linux X11 cannot be verified in this session (no such desktops). macOS verified locally. Status stays NEEDS-HUMAN until T-100/T-102 evidence exists. | n/a | A7/H | NEEDS-HUMAN |
