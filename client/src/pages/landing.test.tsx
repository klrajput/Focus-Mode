/*
 * Landing page tests (T-034, FR-029, UX_SPEC §4.1): the public marketing page renders the approved
 * hero/steps/promise copy, real installer links from the public GET /agent-links endpoint, and the
 * loading/empty/error states for downloads. Fetch is stubbed at the transport boundary.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import type { AgentLink } from '../api/types';
import { createTestQueryClient } from '../test/test-utils';
import { LandingPage } from './landing';

const MAC_LINK: AgentLink = {
  id: '507f1f77bcf86cd799439021',
  os: 'macOS',
  arch: 'arm64',
  label: 'Focus Agent for macOS',
  url: 'https://downloads.example.com/focus-agent-arm64.dmg',
  version: '1.4.0',
  publishedAt: '2026-11-10T10:00:00.000Z',
};

const WINDOWS_LINK: AgentLink = {
  ...MAC_LINK,
  id: '507f1f77bcf86cd799439022',
  os: 'windows',
  arch: 'x64',
  label: 'Focus Agent for Windows',
  url: 'https://downloads.example.com/focus-agent-setup.exe',
};

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function pageOf(items: AgentLink[]): unknown {
  return {
    success: true,
    data: { items, page: 1, limit: 20, total: items.length, totalPages: 1 },
  };
}

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {})),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderLanding() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LandingPage', () => {
  it('renders the hero, how-it-works steps, promise strip and CTAs', () => {
    installFetch(() => fakeResponse(pageOf([])));
    renderLanding();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Focus on one thing.' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Download the Focus Agent')).toHaveLength(2);
    expect(screen.getByText('Open it — it shows a 6-digit code')).toBeInTheDocument();
    expect(screen.getByText('Enter that code on Devices, then focus')).toBeInTheDocument();

    expect(screen.getByText('Consent before every start')).toBeInTheDocument();
    expect(screen.getByText('Nothing deleted or quit')).toBeInTheDocument();
    expect(screen.getByText('No window titles or URLs leave your machine')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/signup');
    expect(screen.getAllByRole('link', { name: 'Log in' })[0]).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Get started — free' })).toHaveAttribute(
      'href',
      '/signup',
    );
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute(
      'href',
      '#how-it-works',
    );
  });

  it('renders only the real published download links', async () => {
    installFetch(() => fakeResponse(pageOf([MAC_LINK, WINDOWS_LINK])));
    renderLanding();

    const mac = await screen.findByRole('link', {
      name: 'Download Focus Agent for macOS — version 1.4.0',
    });
    expect(mac).toHaveAttribute('href', MAC_LINK.url);

    const windows = screen.getByRole('link', {
      name: 'Download Focus Agent for Windows — version 1.4.0',
    });
    expect(windows).toHaveAttribute('href', WINDOWS_LINK.url);

    expect(screen.getByText(/unsigned builds/i)).toBeInTheDocument();
    expect(screen.getByText('macOS')).toBeInTheDocument();
    expect(screen.getByText('Windows')).toBeInTheDocument();
  });

  it('shows the honest empty state when no installer is published', async () => {
    installFetch(() => fakeResponse(pageOf([])));
    renderLanding();

    expect(
      await screen.findByRole('heading', {
        name: 'Installer links are being published — check back soon.',
      }),
    ).toBeInTheDocument();
  });

  it('shows the downloads error and retries', async () => {
    const user = userEvent.setup();
    let first = true;
    installFetch(() => {
      if (first) {
        first = false;
        return fakeResponse(
          { success: false, error: { code: 'INTERNAL', message: 'Agent links unavailable' } },
          500,
        );
      }
      return fakeResponse(pageOf([MAC_LINK]));
    });

    renderLanding();

    expect(
      await screen.findByRole('heading', { name: "We couldn't load downloads." }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('link', {
        name: 'Download Focus Agent for macOS — version 1.4.0',
      }),
    ).toBeInTheDocument();
  });
});
