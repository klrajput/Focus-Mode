// e2e/helpers/config.ts — the single source of the E2E harness' ports, URLs, demo identities and
// timeouts (T-047 prep, owner A8).
// Why: the Playwright config, the API runner and the specs must agree on the exact same origins — a
// mismatch shows up as a CORS 403 or a redirect loop rather than a failure that explains itself.
// Defaults are test-only localhost ports, deliberately different from the dev ports 5000/5173 so an
// E2E run can coexist with `npm run dev`. `E2E_*` env overrides let CI pick free ports.
// Invariants: the API base is the FULL base including `/api/v1` (DEC-013); `CLIENT_ORIGIN` is fed to
// the API as CLIENT_URL (CORS, SEC-3) and to the Focus Agent as AGENT_ALLOWED_ORIGINS (NFR-010) by
// the runner/agent helper, so the browser can never be blocked by a stale origin list.

/** Port of the throwaway API process started by `e2e/helpers/start-api.ts`. */
export const E2E_API_PORT = Number(process.env.E2E_API_PORT ?? 5099);
/** Port of the Vite dev server for the dashboard under test. */
export const E2E_CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT ?? 5273);
/** Loopback port the test Focus Agent listens on (the dev agent uses 4545). */
export const E2E_AGENT_PORT = Number(process.env.E2E_AGENT_PORT ?? 4645);

export const API_ORIGIN = `http://127.0.0.1:${E2E_API_PORT}`;
/** Base URL every dashboard/agent API call uses (INTEGRATION_CONTRACTS §1.1). */
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;
/** Root health probe (TECHNICAL_DESIGN §11); also served under `/api/v1/health`. */
export const API_HEALTH_URL = `${API_ORIGIN}/health`;
export const CLIENT_ORIGIN = `http://127.0.0.1:${E2E_CLIENT_PORT}`;

/** Demo identities seeded by the API runner (DEC-013 / INTEGRATION_CONTRACTS §1.8). */
export const DEMO_USER = { email: 'kabir@demo.com', password: 'Kabir@123' } as const;
export const DEMO_ADMIN = { email: 'admin@demo.com', password: 'Admin@123' } as const;

/** Shared, generous-but-bounded timeouts (a slow first boot must not flake a green suite). */
export const E2E_TIMEOUTS = {
  /** First API start includes mongod boot + seeding; CI cold start is slower than local. */
  webServerStartMs: 180_000,
  /** Per-assertion ceiling; the product's own status propagation target is 1–3 s (NFR-011). */
  expectMs: 10_000,
  electronLaunchMs: 90_000,
  firstWindowMs: 45_000,
} as const;

/** Email address that is unique per test run and still passes the shared `registerSchema`. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1_000_000)}@example.com`;
}
