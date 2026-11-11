// e2e/helpers/features.ts — on-disk feature probes for self-gating E2E specs (W3 gate, owner A8).
// Why: this shared checkout switches branches while six workers land W3 features (server APIs on
// `feat/a5-w3-sessions-allowlist`, client/agent work in the working tree). A spec that hard-fails
// because a feature branch is not merged yet is noise, and a skipped spec without a reason is a fake
// pass. Instead each spec asks these probes and calls `test.fixme(condition, '<precise reason>')`:
// the moment the feature is really present in the checkout under test, the spec runs for real.
// Invariants: probes inspect only the checkout on disk (never a branch name, never a commit) — they
// answer "can the running app do this now?", which is exactly what an E2E run needs.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

/** Concatenated text of every `.ts`/`.tsx` file under a workspace-relative directory (tests excluded). */
function readSourceTree(relativeDir: string): string {
  const absolute = path.join(REPO_ROOT, relativeDir);
  if (!existsSync(absolute)) return '';
  const chunks: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue;
      chunks.push(readFileSync(full, 'utf8'));
    }
  };
  walk(absolute);
  return chunks.join('\n');
}

/** A5 T-063: the per-minute scheduler + stale-run sweep exist and are started by the server. */
export function schedulerShipped(): boolean {
  const server = readIfExists('server/src/server.ts');
  const cronIndex = readIfExists('server/src/cron/index.ts');
  return (
    existsSync(path.join(REPO_ROOT, 'server/src/cron/scheduler.ts')) &&
    cronIndex.includes('startScheduler') &&
    server.includes('startCronJobs')
  );
}

/** A5 T-063/T-070: the missed-run notification API exists (FR-025). */
export function notificationsApiShipped(): boolean {
  return (
    existsSync(path.join(REPO_ROOT, 'server/src/routes/notifications.routes.ts')) &&
    readIfExists('server/src/routes/index.ts').includes('notifications.routes')
  );
}

/** A7 T-064: the agent handles `scheduleDue` with a cancellable heads-up and reports cancellations. */
export function agentScheduleFlowShipped(): boolean {
  const agent = readSourceTree('agent/src');
  return agent.includes('scheduleHeadsUp') && agent.includes('scheduleRunCancelled');
}

/** A5 (DEC-021 C-20): the device-token `GET /agent/allowlist` endpoint exists for scheduled starts. */
export function agentAllowlistEndpointShipped(): boolean {
  return readIfExists('server/src/routes/agent.routes.ts').includes('/allowlist');
}

/** A7 W4: the agent reports `session.started`/`session.ended` to the cloud (dashboard-closed path). */
export function agentCloudSessionReportingShipped(): boolean {
  const cloud = readSourceTree('agent/src/cloud');
  return cloud.includes('session.started') && cloud.includes('session.ended');
}

/** A5 W4: the cloud merges/finalises sessions reported by the agent (REC-006 idempotency). */
export function serverSessionReportingShipped(): boolean {
  const server = readSourceTree('server/src');
  // Real implementation signal: the hub validates/handles the cloud reporting messages
  // (imports the strict shared schemas / switches on the message types), or a dedicated service
  // exists. A passing comment mentioning "session.ended" is not enough (W4 branch check).
  return (
    server.includes('sessionStartedMessageSchema') ||
    server.includes('sessionEndedMessageSchema') ||
    server.includes("case 'session.started'")
  );
}

// ---------------------------------------------------------------------------------------------
// W5 probes (notifications bell, insights, admin, settings, public agent links).
// ---------------------------------------------------------------------------------------------

/** A5 W5: insights API router mounted (contract §3.1 #21). */
export function insightsApiShipped(): boolean {
  return (
    existsSync(path.join(REPO_ROOT, 'server/src/routes/insights.routes.ts')) &&
    readIfExists('server/src/routes/index.ts').includes('insights.routes')
  );
}

/** A4 W5: the dashboard renders the notifications bell with a real unread count (FR-025). */
export function notificationsBellUiShipped(): boolean {
  const client = readSourceTree('client/src');
  return (
    notificationsApiShipped() && client.includes('useNotifications') && client.includes('unread')
  );
}

/** A5 W5: public agent-links API mounted (contract §3.1 #25). */
export function agentLinksApiShipped(): boolean {
  const index = readIfExists('server/src/routes/index.ts');
  return (
    existsSync(path.join(REPO_ROOT, 'server/src/routes/agent-links.routes.ts')) &&
    index.includes('agent-links.routes')
  );
}

/** A5 W5: users self-service router (PATCH /users/me, POST /users/me/password — §3.1 #6/#7). */
export function usersSelfServiceApiShipped(): boolean {
  const routes = readIfExists('server/src/routes/users.routes.ts');
  return (
    routes.includes('/password') &&
    readIfExists('server/src/routes/index.ts').includes('users.routes')
  );
}

/** A5 W5: admin API routers mounted (contract §3.1 #26–#36). */
export function adminApiShipped(): boolean {
  return readIfExists('server/src/routes/index.ts').includes('admin');
}

/** A5 W5: unpair-all endpoint (W5 additive delta C-23, FR-029). */
export function unpairAllShipped(): boolean {
  return readIfExists('server/src/routes/devices.routes.ts').includes('unpair-all');
}

/** A4 W5: `/insights` page wired to the API with the §4.8 empty/success states. */
export function clientInsightsUiShipped(): boolean {
  const page = readIfExists('client/src/pages/insights.tsx');
  return page.includes('useInsights') && /No focus data|Daily focus|7 days/.test(page);
}

/** A4 W5: `/admin` page wired (users table + stats tabs). */
export function clientAdminUiShipped(): boolean {
  const page = readIfExists('client/src/pages/admin.tsx');
  return page.includes('useAdminUsers') && /Deactivate|Stats|No users match/.test(page);
}

/** A4 W5: `/settings` page wired (password change, unpair-all, download links). */
export function clientSettingsUiShipped(): boolean {
  const page = readIfExists('client/src/pages/settings.tsx');
  return /useChangePassword|Update password/.test(page) && /Unpair all|Download/.test(page);
}

// ---------------------------------------------------------------------------------------------
// W6 hardening probes (A5) — the security spec tightens its assertions when these land.
// ---------------------------------------------------------------------------------------------

/** A5 W6: global/per-resource rate-limit middleware now actually wraps the API routers. */
export function apiRateLimitMiddlewareShipped(): boolean {
  const app = readIfExists('server/src/app.ts');
  const routes = readIfExists('server/src/routes/index.ts');
  return app.includes('createApiRateLimiter') || routes.includes('createApiRateLimiter');
}

/** A5 W6: CORS no longer sends credentials (A0-announced change: `credentials: false`). */
export function corsCredentialsDisabledShipped(): boolean {
  return readIfExists('server/src/app.ts').includes('credentials: false');
}

/** A5 W6: malformed ObjectId path params are mapped to 404 NOT_FOUND (CastError/BSONError → 404). */
export function objectIdNotFoundShipped(): boolean {
  const errorMiddleware = readIfExists('server/src/middlewares/error.ts');
  const mongoErrors = readIfExists('server/src/utils/mongo-errors.ts');
  return (
    errorMiddleware.includes('isInvalidObjectIdError') &&
    mongoErrors.includes('export function isInvalidObjectIdError')
  );
}
