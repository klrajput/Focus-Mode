// Vite config for the Focus Mode dashboard (React 19 + Tailwind 4).
// The API base URL is NOT configured here: it comes from `VITE_API_BASE_URL` (DEC-013 — the full
// base including `/api/v1`) and is read by `src/api/config.ts`. Unit tests use `vitest.config.ts`.

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
  },
});
