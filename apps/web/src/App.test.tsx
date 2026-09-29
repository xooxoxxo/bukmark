import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import * as client from './api/client';
import { AppRoutes } from './App';
import { makeWrapper } from './test/utils';

vi.mock('./api/client');

describe('App shell', () => {
  it('renders title, contextual header, unassigned count and links view at /', async () => {
    vi.mocked(client.fetchAuthStatus).mockResolvedValue({
      setupComplete: true,
      authenticated: true,
    });
    vi.mocked(client.fetchHubs).mockResolvedValue({ items: [] });
    vi.mocked(client.fetchStats).mockResolvedValue({
      links: 1,
      active: 1,
      archived: 0,
      hubs: 0,
      unassigned: 1, broken: 0, unchecked: 0, quotes: 0,
    });
    vi.mocked(client.fetchLinks).mockResolvedValue({ items: [], total: 0 });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <MemoryRouter initialEntries={['/']}>
          <AppRoutes />
        </MemoryRouter>
      </Wrapper>,
    );
    expect(screen.getByRole('heading', { name: 'bukmark' })).toBeInTheDocument();
    expect(screen.getByRole('banner', { name: 'Application toolbar' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'All links' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for All links' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Unassigned 1' })).toBeInTheDocument();
    expect(screen.queryByText('1 links')).not.toBeInTheDocument();
    expect(await screen.findByText('0 results')).toBeInTheDocument();
  });

  it('opens the Quotes view at /quotes', async () => {
    vi.mocked(client.fetchAuthStatus).mockResolvedValue({ setupComplete: true, authenticated: true });
    vi.mocked(client.fetchHubs).mockResolvedValue({ items: [] });
    vi.mocked(client.fetchStats).mockResolvedValue({
      links: 0, active: 0, archived: 0, hubs: 0, unassigned: 0, broken: 0, unchecked: 0, quotes: 0,
    });
    vi.mocked(client.fetchQuotes).mockResolvedValue({ items: [], nextCursor: null });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <MemoryRouter initialEntries={['/quotes']}>
          <AppRoutes />
        </MemoryRouter>
      </Wrapper>,
    );
    expect(screen.getByRole('heading', { name: 'Quotes' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search quotes' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'No quotes yet' })).toBeInTheDocument();
  });
});
