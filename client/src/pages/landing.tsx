/*
 * Landing page — PUBLIC marketing page (UX_SPEC §4.1, FR-029).
 * It describes what Focus Mode does in the approved wording, offers the install → pair → focus
 * steps, the consent/privacy promises and the real installer links from the public GET /agent-links
 * endpoint. No fake download button, version or metric is ever rendered: when an admin has not
 * published an OS build, the §6.1 empty sentence appears instead.
 */

import { Link } from 'react-router-dom';
import { ArrowRight, Diamond, ShieldCheck, Timer } from 'lucide-react';

import { DownloadLinks } from '../components/settings/download-links';
import { useDocumentTitle } from '../hooks/use-document-title';

const STEPS = [
  {
    title: 'Download the Focus Agent',
    body: 'Pick the installer for your operating system. The Focus Agent is the small desktop companion that moves windows — never the cloud.',
  },
  {
    title: 'Open it — it shows a 6-digit code',
    body: 'The code is shown only in the Focus Agent window, never in this dashboard.',
  },
  {
    title: 'Enter that code on Devices, then focus',
    body: 'Choose a duration, review what stays open, and start when you are ready.',
  },
] as const;

const NAV_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#download', label: 'Download' },
  { href: '#privacy', label: 'Privacy' },
] as const;

export function LandingPage() {
  useDocumentTitle('Focus on one thing');

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-[var(--fm-content-max)] flex-wrap items-center gap-3 px-[var(--fm-page-pad-x)] py-3">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-[var(--radius-control)] px-1 py-2 text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
          >
            <Diamond aria-hidden="true" className="h-5 w-5 text-focus-strong" />
            <span className="text-[15px] font-semibold tracking-tight">Focus Mode</span>
          </Link>

          <nav
            aria-label="Landing navigation"
            className="ml-auto flex flex-wrap items-center gap-2"
          >
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="hidden min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-medium text-ink hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none sm:inline-flex"
              >
                {link.label}
              </a>
            ))}
            <Link
              to="/login"
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-medium text-primary hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
            >
              Log in
            </Link>
            <Link
              to="/signup"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none md:h-10"
            >
              Get started
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[var(--fm-content-max)] px-[var(--fm-page-pad-x)] py-10">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
          <section aria-labelledby="hero-heading" className="min-w-0">
            <p className="text-[13px] font-medium tracking-wide text-focus-strong uppercase">
              Distraction lockdown, visibly and reversibly
            </p>
            <h1
              id="hero-heading"
              className="mt-2 text-[40px] leading-[1.05] font-bold tracking-tight text-ink sm:text-[48px]"
            >
              Focus on one thing.
            </h1>
            <p className="mt-4 max-w-prose text-[15px] text-muted">
              Your browser stays open. Everything else steps aside — visibly, reversibly, only on
              your own computer.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                to="/signup"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-medium text-white transition-colors duration-[var(--fm-duration-fast)] ease-[var(--fm-ease-calm)] hover:bg-primary-hover active:bg-primary-active focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none md:h-10"
              >
                Get started — free
              </Link>
              <Link
                to="/login"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border-strong bg-card px-4 text-sm font-medium text-ink hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none md:h-10"
              >
                I already have a Focus Agent
              </Link>
            </div>
          </section>

          <section
            aria-labelledby="steps-heading"
            id="how-it-works"
            className="min-w-0 scroll-mt-6"
          >
            <h2 id="steps-heading" className="sr-only">
              How Focus Mode works
            </h2>
            <ol className="space-y-3">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="flex min-w-0 items-start gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-[var(--shadow-card)]"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-primary-subtle text-[13px] font-semibold text-primary-active"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-ink">{step.title}</p>
                    <p className="mt-1 text-[13px] leading-[1.45] text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section aria-labelledby="downloads-heading" id="download" className="mt-10 scroll-mt-6">
          <h2 id="downloads-heading" className="text-[20px] font-semibold text-ink">
            Download the Focus Agent
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            macOS, Windows and Linux installers are published by an admin.
          </p>
          <div className="mt-3">
            <DownloadLinks />
          </div>
        </section>

        <section aria-labelledby="promises-heading" id="privacy" className="mt-10 scroll-mt-6">
          <h2
            id="promises-heading"
            className="flex items-center gap-2 text-[13px] font-medium tracking-wide text-muted uppercase"
          >
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            The promise
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              'Consent before every start',
              'End any time — dashboard, tray or quit',
              'Nothing deleted or quit',
              'No window titles or URLs leave your machine',
            ].map((promise) => (
              <li
                key={promise}
                className="flex min-w-0 items-start gap-2 rounded-[var(--radius-card)] border border-border bg-card p-3 text-[13px] text-ink"
              >
                <ShieldCheck
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-focus-strong"
                />
                <span>{promise}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-prose text-[13px] leading-[1.45] text-muted">
            The Focus Agent runs on your computer and never moves a window without your consent. The
            dashboard only receives allowed app identifiers, session times and counts — never window
            titles or URLs.
          </p>
        </section>

        <p className="mt-8 flex items-center gap-2 text-[13px] text-muted">
          <Timer aria-hidden="true" className="h-4 w-4" />
          The countdown is the only moving number.
        </p>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex w-full max-w-[var(--fm-content-max)] flex-wrap items-center gap-3 px-[var(--fm-page-pad-x)] py-4 text-[13px] text-muted">
          <span>Focus Mode</span>
          <span aria-hidden="true">·</span>
          <Link to="/login" className="text-primary hover:underline">
            Log in
          </Link>
          <span aria-hidden="true">·</span>
          <Link to="/signup" className="text-primary hover:underline">
            Create account
          </Link>
        </div>
      </footer>
    </div>
  );
}
