/*
 * `/signup` — react-hook-form + the frozen shared `registerSchema` (T-021, NFR-001, FR-001).
 * The server always creates role USER and ignores role fields (strict schema), so this page has no
 * role control. 409 CONFLICT means the email is already registered (UX_SPEC §4.2 copy); success
 * lands on `/dashboard?welcome=1` with the install → pair → focus checklist.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Diamond } from 'lucide-react';
import { registerSchema, type RegisterInput } from '@focus-mode/shared';

import { isApiError } from '../api/errors';
import { useAuth } from '../auth/auth-context';
import {
  EMAIL_TAKEN_COPY,
  PASSWORD_HINT,
  SIGNED_IN_TOAST,
  SIGNUP_LOADING_LABEL,
  SIGNUP_TITLE,
} from '../copy/auth';
import { ERROR_MESSAGES, copyForCode } from '../copy/errors';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useDocumentTitle } from '../hooks/use-document-title';
import { useRateLimit } from '../hooks/use-rate-limit';

type FieldPath = 'name' | 'email' | 'password';

function isFieldPath(value: string): value is FieldPath {
  return value === 'name' || value === 'email' || value === 'password';
}

export function SignupPage() {
  useDocumentTitle(SIGNUP_TITLE);
  const { register: registerAccount } = useAuth();
  const navigate = useNavigate();

  const [banner, setBanner] = useState<string | null>(null);
  const rateLimit = useRateLimit();

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
    mode: 'onSubmit',
  });

  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: RegisterInput): Promise<void> {
    setBanner(null);

    try {
      await registerAccount(values);
      toast.success(SIGNED_IN_TOAST);
      navigate('/dashboard?welcome=1', { replace: true });
    } catch (error) {
      if (!isApiError(error)) {
        setBanner(ERROR_MESSAGES.INTERNAL);
        return;
      }

      if (error.details.length > 0) {
        for (const issue of error.details) {
          if (isFieldPath(issue.path)) {
            form.setError(issue.path, { type: 'server', message: issue.message });
          }
        }
        setBanner(ERROR_MESSAGES.VALIDATION_ERROR);
        return;
      }

      switch (error.code) {
        case 'CONFLICT':
          setBanner(EMAIL_TAKEN_COPY);
          break;
        case 'RATE_LIMITED':
          rateLimit.start();
          setBanner(ERROR_MESSAGES.RATE_LIMITED);
          break;
        case 'ACCOUNT_DISABLED':
          setBanner(ERROR_MESSAGES.ACCOUNT_DISABLED);
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
          <h1 className="text-[28px] leading-[1.2] font-semibold text-ink">{SIGNUP_TITLE}</h1>

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
              label="Name"
              type="text"
              autoComplete="name"
              requiredText
              placeholder="Kabir"
              error={errors.name?.message}
              {...form.register('name')}
            />

            <Input
              label="Email"
              type="email"
              autoComplete="email"
              requiredText
              placeholder="you@example.com"
              error={errors.email?.message}
              {...form.register('email')}
            />

            <Input
              label="Password"
              type="password"
              autoComplete="new-password"
              requiredText
              hint={PASSWORD_HINT}
              placeholder="At least 8 characters"
              error={errors.password?.message}
              {...form.register('password')}
            />

            <Button
              type="submit"
              className="w-full"
              loading={isSubmitting}
              loadingLabel={SIGNUP_LOADING_LABEL}
              disabled={rateLimit.isLimited}
            >
              Create account
            </Button>

            {rateLimit.isLimited ? (
              <p className="text-[13px] text-muted">
                Try again in {rateLimit.secondsRemaining} second
                {rateLimit.secondsRemaining === 1 ? '' : 's'}.
              </p>
            ) : null}
          </form>

          <p className="mt-5 text-[15px] text-muted">
            Already have an account?{' '}
            <Link
              to="/login"
              className="font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
            >
              Log in →
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
