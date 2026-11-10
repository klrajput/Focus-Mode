// Vitest configuration for the dashboard (jsdom + Testing Library).
// Kept separate from `vite.config.ts` so the production build does not carry test-only options.
// `test.env` supplies the DEC-013 API base (full base including `/api/v1`) so the HTTP client can
// be exercised without a real server; `src/test/setup.ts` adds jest-dom matchers and cleanup.

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    clearMocks: true,
    css: false,
    env: {
      VITE_API_BASE_URL: 'http://localhost:5000/api/v1',
    },
  },
});
