import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import { useFilters } from '../state/filters';
import { useSelection } from '../state/selection';
import { makeWrapper } from '../test/utils';
import { HubPage } from './HubPage';

vi.mock('../api/client');

function renderHubPage() {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <MemoryRouter initialEntries={['/hubs/h1']}>
        <Routes>
          <Route path="/hubs/:hubId" element={<HubPage />} />
        </Routes>
      </MemoryRouter>
    </Wrapper>,
  );
}

describe('HubPage', () => {
  beforeEach(() => {
    useFilters.getState().reset();
    useSelection.getState().clear();
    vi.mocked(client.fetchLinks).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(client.fetchHubs).mockResolvedValue({
      items: [{ id: 'h1', name: 'AI', description: 'ml stuff', status: 'active', linkCount: 3 }],
    });
  });

  it('renders links filtered by the current hub without a duplicate page header', async () => {
    renderHubPage();
    expect(await screen.findByText('0 results')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AI' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(client.fetchLinks).toHaveBeenLastCalledWith(expect.objectContaining({ hub: 'h1' })),
    );
  });

  it('shows the not-found state when the route hub is missing', async () => {
    vi.mocked(client.fetchHubs).mockResolvedValue({ items: [] });
    renderHubPage();

    expect(await screen.findByRole('heading', { name: 'Hub not found' })).toBeInTheDocument();
    expect(screen.queryByText('0 results')).not.toBeInTheDocument();
  });
});
