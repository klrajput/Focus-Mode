/*
 * React entry point for the Focus Mode dashboard (T-020).
 * Mounts the provider/router tree from `app/app.tsx`; the only thing it owns is the #root lookup
 * and StrictMode. All configuration (API base, tokens) lives in modules under `src/api`.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { App } from './app/app';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Focus Mode: #root element is missing from index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
