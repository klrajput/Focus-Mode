/*
 * 404 page tests (UX_SPEC §4.11): the catch-all renders for signed-out visitors too (no providers),
 * sets a meaningful title and offers both ways out through the router.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { NotFoundPage } from './not-found';

function renderNotFound() {
  return render(
    <MemoryRouter initialEntries={['/no-such-page']}>
      <Routes>
        <Route path="/" element={<div>home destination</div>} />
        <Route path="/dashboard" element={<div>dashboard destination</div>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('NotFoundPage', () => {
  it('explains the 404 and sets the document title', () => {
    renderNotFound();

    expect(
      screen.getByRole('heading', { name: "404 — We couldn't find that page" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The link may be wrong or the page may have moved.'),
    ).toBeInTheDocument();
    expect(document.title).toBe('404 — Page not found — Focus Mode');
  });

  it('navigates back to the dashboard', async () => {
    const user = userEvent.setup();
    renderNotFound();

    await user.click(screen.getByRole('button', { name: 'Back to dashboard' }));

    expect(await screen.findByText('dashboard destination')).toBeInTheDocument();
  });

  it('navigates home', async () => {
    const user = userEvent.setup();
    renderNotFound();

    await user.click(screen.getByRole('button', { name: 'Go home' }));

    expect(await screen.findByText('home destination')).toBeInTheDocument();
  });
});
