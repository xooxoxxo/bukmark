import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import * as client from './api/client';
import { AppRoutes } from './App';
import { makeWrapper } from './test/utils';

vi.mock('./api/client');

describe('App shell', () => {
  it('renders title, stats and links view at /', async () => {
    vi.mocked(client.fetchHubs).mockResolvedValue({ items: [] });
    vi.mocked(client.fetchStats).mockResolvedValue({
      links: 1,
      active: 1,
      archived: 0,
      hubs: 0,
      unassigned: 1,
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <MemoryRouter initialEntries={['/']}>
          <AppRoutes />
        </MemoryRouter>
      </Wrapper>,
    );
    expect(screen.getByRole('heading', { name: 'bookmarkt' })).toBeInTheDocument();
    expect(await screen.findByText('1 links')).toBeInTheDocument();
    expect(screen.getByText('links view')).toBeInTheDocument();
  });
});
