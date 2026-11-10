/*
 * `/login` — react-hook-form + the frozen shared `loginSchema` (T-021, NFR-001).
 * Validation lives in `@focus-mode/shared`, so the browser and the API reject the same inputs.
 * Behaviour: inline field errors (including server `details[]`), a declared banner for 401/403
 * ACCOUNT_DISABLED/409/429, a real loading state, a success toast and a redirect to the attempted
 * route (or /dashboard). Rate limiting disables submit for 60 s (UX_SPEC §6.2 `RATE_LIMITED`).
 *
 * Seeded demo identities for reviewers (DEC-013 / INTEGRATION_CONTRACTS §1.8):
 *   admin@demo.com / Admin@123  (ADMIN)
 *   kabir@demo.com / Kabir@123  (USER)
 */

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Diamond } from 'lucide-react';
import { loginSchema, type LoginInput } from '@focus-mode/shared';

import { isApiError } from '../api/errors';
import { useAuth } from '../auth/auth-context';
import { EMAIL_TAKEN_COPY, LOGIN_LOADING_LABEL, LOGIN_TITLE, SIGNED_IN_TOAST } from '../copy/auth';
import { ERROR_MESSAGES, LOGIN_REJECTED_COPY, copyForCode } from '../copy/errors';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useDocumentTitle } from '../hooks/use-document-title';
import { useRateLimit } from '../hooks/use-rate-limit';
import { fromRouteState } from '../lib/route-state';

export function LoginPage() {
  useDocumentTitle(LOGIN_TITLE);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [banner, setBanner] = useState<string | null>(null);
  const rateLimit = useRateLimit();

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
  });

  const { errors, isSubmitting } = form.formState;

  const rateLimitSeconds = rateLimit.secondsRemaining;
  const submitDisabled = rateLimit.isLimited;

  async function onSubmit(values: LoginInput): Promise<void> {
    setBanner(null);

    try {
      await login(values);
      toast.success(SIGNED_IN_TOAST);
      // Only same-origin paths from RequireAuth are honoured (no open redirect).
      navigate(fromRouteState(location.state) ?? '/dashboard', { replace: true });
    } catch (error) {
      if (!isApiError(error)) {
        setBanner(ERROR_MESSAGES.INTERNAL);
        return;
      }

      if (error.details.length > 0) {
        for (const issue of error.details) {
          if (issue.path === 'email' || issue.path === 'password') {
            form.setError(issue.path, { type: 'server', message: issue.message });
          }
        }
        setBanner(ERROR_MESSAGES.VALIDATION_ERROR);
        return;
      }

      switch (error.code) {
        case 'RATE_LIMITED':
          rateLimit.start();
          setBanner(ERROR_MESSAGES.RATE_LIMITED);
          break;
        case 'UNAUTHENTICATED':
          setBanner(LOGIN_REJECTED_COPY);
          break;
        case 'ACCOUNT_DISABLED':
          setBanner(ERROR_MESSAGES.ACCOUNT_DISABLED);
          break;
        case 'CONFLICT':
          setBanner(EMAIL_TAKEN_COPY);
          break;
        default:
          setBanner(copyForCode(error.code));
      }
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-[var(--fm-page-pad-x)] py-10">
      <div className="w-full max-w-[400px]">
        <Link
          to="/"
          className="mb-6 flex items-center justify-center gap-2 rounded-[var(--radius-control)] py-2 text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
        >
          <Diamond aria-hidden="true" className="h-5 w-5 text-focus-strong" />
          <span className="text-[15px] font-semibold tracking-tight">Focus Mode</span>
        </Link>

        <div className="rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-card)]">
          <h1 className="text-[28px] leading-[1.2] font-semibold text-ink">{LOGIN_TITLE}</h1>

          {banner === null ? null : (
            <div
              role="alert"
              className="mt-4 rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-[13px] leading-[1.45] font-medium text-danger-text"
            >
              {banner}
            </div>
          )}

          <form className="mt-5 space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              autoFocus
              requiredText
              placeholder="you@example.com"
              error={errors.email?.message}
              {...form.register('email')}
            />

            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              requiredText
              placeholder="Your password"
              error={errors.password?.message}
              {...form.register('password')}
            />

            <Button
              type="submit"
              className="w-full"
              loading={isSubmitting}
              loadingLabel={LOGIN_LOADING_LABEL}
              disabled={submitDisabled}
            >
              Log in
            </Button>

            {rateLimitSeconds > 0 ? (
              <p className="text-[13px] text-muted">
                Try again in {rateLimitSeconds} second{rateLimitSeconds === 1 ? '' : 's'}.
              </p>
            ) : null}
          </form>

          <p className="mt-5 text-[15px] text-muted">
            New here?{' '}
            <Link
              to="/signup"
              className="font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
            >
              Sign up →
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
