/*
 * Provider tree for the dashboard (T-020/T-022).
 * Order matters: the router wraps AuthProvider because the provider redirects on session expiry;
 * the QueryClient lives above it so auth and page queries share one cache; Toaster is last so
 * toasts sit above every route. Nothing is fetched until a page or the auth gate asks for it.
 */

import { useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';

import { AuthProvider } from '../auth/auth-provider';
import { createQueryClient } from '../hooks/query-client';
import { AppRoutes } from './app-routes';

export function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppRoutes />
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: 'var(--color-toast)',
                color: 'var(--color-card)',
                borderRadius: 'var(--radius-control)',
                fontSize: '14px',
              },
              success: {
                iconTheme: {
                  primary: 'var(--color-success-fill)',
                  secondary: 'var(--color-card)',
                },
              },
              error: {
                duration: Number.POSITIVE_INFINITY,
                iconTheme: {
                  primary: 'var(--color-danger)',
                  secondary: 'var(--color-card)',
                },
              },
            }}
          />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
