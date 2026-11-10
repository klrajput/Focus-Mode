// Vitest setup for the dashboard tests (jsdom + Testing Library).
// jest-dom matchers are registered here; sessionStorage/token state is cleared between tests so a
// logged-in test can never leak into the next one. Network access is always stubbed per test.

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { clearAccessToken } from '../api/token-storage';

// Belt and braces with `test.env` in vitest.config.ts: the API base must be the FULL base
// including `/api/v1` (DEC-013) before any HTTP client module reads it.
vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:5000/api/v1');

afterEach(() => {
  cleanup();
  clearAccessToken();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
