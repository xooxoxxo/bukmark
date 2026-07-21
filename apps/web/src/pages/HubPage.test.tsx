import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
          <Route path="/" element={<p>home</p>} />
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

  it('renders hub header and links filtered by hub', async () => {
    renderHubPage();
    expect(await screen.findByRole('heading', { name: 'AI' })).toBeInTheDocument();
    expect(screen.getByText('ml stuff')).toBeInTheDocument();
    await waitFor(() =>
      expect(client.fetchLinks).toHaveBeenLastCalledWith(expect.objectContaining({ hub: 'h1' })),
    );
  });

  it('renames the hub', async () => {
    vi.mocked(client.patchHub).mockResolvedValue({ id: 'h1' });
    renderHubPage();
    await screen.findByRole('heading', { name: 'AI' });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Hub name');
    await userEvent.clear(input);
    await userEvent.type(input, 'AI & ML');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(client.patchHub).toHaveBeenCalledWith('h1', { name: 'AI & ML' });
  });

  it('archives the hub', async () => {
    vi.mocked(client.patchHub).mockResolvedValue({ id: 'h1' });
    renderHubPage();
    await screen.findByRole('heading', { name: 'AI' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive hub' }));
    expect(client.patchHub).toHaveBeenCalledWith('h1', { status: 'archived' });
  });

  it('deletes only after confirm click, then navigates home', async () => {
    vi.mocked(client.deleteHub).mockResolvedValue({ ok: true });
    renderHubPage();
    await screen.findByRole('heading', { name: 'AI' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(client.deleteHub).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Really delete?' }));
    expect(client.deleteHub).toHaveBeenCalledWith('h1');
    expect(await screen.findByText('home')).toBeInTheDocument();
  });
});
