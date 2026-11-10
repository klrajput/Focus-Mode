// T-001 placeholder — React entry point proving Vite 8 + React 19 + Tailwind 4 build.
// Owner A4 replaces this file with the router / AppShell / provider tree in W1.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';

function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#1E1B4B] p-8 text-center text-[#F8FAFC]">
      <h1 className="text-3xl font-semibold tracking-tight">Focus Mode — scaffold</h1>
      <p className="max-w-md text-sm text-slate-300">
        T-001 placeholder dashboard. The real pages, router and agent link provider land in W1.
      </p>
      <span className="rounded-full bg-[#0D9488] px-3 py-1 text-xs font-medium text-white">
        scaffold ok
      </span>
    </main>
  );
}

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Focus Mode scaffold: #root element is missing from index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
