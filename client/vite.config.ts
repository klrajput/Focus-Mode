// Vite config for the Focus Mode dashboard (React 19 + Tailwind 4).
// The API base URL is NOT configured here: it comes from `VITE_API_BASE_URL` (DEC-013 — the full
// base including `/api/v1`) and is read by `src/api/config.ts`. Unit tests use `vitest.config.ts`.
//
// W7 / task-48 — vendor chunking. Route pages are split with `React.lazy` in `src/app/app-routes.tsx`;
// this file additionally pins the big third-party families to named, cacheable chunks. Rolldown
// (Vite 8) replaced `manualChunks` with `output.codeSplitting.groups`; each group has its own
// priority so a module can only belong to one chunk (no shared-chunk cycle between groups):
//   · react   — react / react-dom / scheduler
//   · router  — react-router / react-router-dom
//   · charts  — Recharts + its Redux/victory-vendor(d3) dependency tree (only reached via /insights)
//   · motion  — motion / framer-motion (declared dependency; currently not imported by any page, so
//               no chunk is emitted until a page imports it — the rule is here so it never lands
//               back in the entry chunk when it is used)
// Everything else (TanStack Query, react-hook-form, zod, lucide-react, toast) is required by the
// eager shell/dashboard/auth flow, so it stays in the eager entry/shared chunks — moving it behind
// a dynamic import would add a request waterfall without removing it from first load.
//
// The charts dependencies must be listed explicitly because a group captures only the modules its
// `test` matches — otherwise Recharts' deps (react-redux/@reduxjs/toolkit/victory-vendor/d3/…)
// fall back to automatic chunking and can land back in the eagerly loaded entry graph.

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const VENDOR_GROUPS = [
  {
    name: 'react',
    // `react` alone would not match `react-dom` because of the trailing separator.
    test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
    priority: 40,
  },
  {
    name: 'router',
    test: /node_modules[\\/](?:react-router|react-router-dom|@remix-run[\\/]router)[\\/]/,
    priority: 30,
  },
  {
    name: 'charts',
    test: /node_modules[\\/](?:recharts|victory-vendor|d3-[^\\/]+|internmap|react-redux|@reduxjs[\\/]toolkit|redux|redux-thunk|reselect|immer|decimal\.js-light|es-toolkit|eventemitter3|use-sync-external-store|tiny-invariant|clsx|react-is)[\\/]/,
    priority: 20,
  },
  {
    name: 'motion',
    test: /node_modules[\\/](?:motion|framer-motion|motion-dom|motion-utils)[\\/]/,
    priority: 10,
  },
] as const;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [...VENDOR_GROUPS],
        },
      },
    },
  },
});
