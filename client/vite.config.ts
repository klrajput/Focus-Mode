// T-001 placeholder — Vite config for the dashboard (React plugin + Tailwind 4 plugin).
// Owner A4 extends this in W1 (aliases, API proxy, test project); values stay in env modules.

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
});
