// e2e/helpers/features.ts — on-disk feature probes for self-gating E2E specs (W3 gate, owner A8).
// Why: this shared checkout switches branches while six workers land W3 features (server APIs on
// `feat/a5-w3-sessions-allowlist`, client/agent work in the working tree). A spec that hard-fails
// because a feature branch is not merged yet is noise, and a skipped spec without a reason is a fake
// pass. Instead each spec asks these probes and calls `test.fixme(condition, '<precise reason>')`:
// the moment the feature is really present in the checkout under test, the spec runs for real.
// Invariants: probes inspect only the checkout on disk (never a branch name, never a commit) — they
// answer "can the running app do this now?", which is exactly what an E2E run needs.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file (`e2e/helpers/features.ts`). */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function readIfExists(relativePath: string): string {
  const absolute = path.join(REPO_ROOT, relativePath);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
}

/** A5 T-060/T-061: sessions + allow-list routers exist and are mounted on the API. */
export function sessionsAndAllowlistApiShipped(): boolean {
  const routesIndex = readIfExists('server/src/routes/index.ts');
  return (
    existsSync(path.join(REPO_ROOT, 'server/src/routes/sessions.routes.ts')) &&
    existsSync(path.join(REPO_ROOT, 'server/src/routes/allowlist.routes.ts')) &&
    routesIndex.includes('sessions.routes') &&
    routesIndex.includes('allowlist.routes')
  );
}

/** A4 T-056–T-058: the dashboard Start card and the live `/focus` page are wired. */
export function clientFocusUiShipped(): boolean {
  const dashboard = readIfExists('client/src/pages/dashboard.tsx');
  const focusPage = readIfExists('client/src/pages/focus.tsx');
  return (
    dashboard.includes('components/focus/start-focus-card') &&
    focusPage.includes('FocusRing') &&
    focusPage.includes('End Focus')
  );
}

/** A7 T-050/T-051: focus link handlers + native consent are wired into the agent main process. */
export function agentFocusLinkShipped(): boolean {
  const main = readIfExists('agent/src/main.ts');
  return (
    existsSync(path.join(REPO_ROOT, 'agent/src/link/handlers.ts')) &&
    existsSync(path.join(REPO_ROOT, 'agent/src/focus/consent.ts')) &&
    main.includes('FocusLinkHandlers')
  );
}
