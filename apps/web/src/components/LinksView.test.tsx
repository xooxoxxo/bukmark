import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import type { LinkDto } from '../api/types';
import { useFilters } from '../state/filters';
import { useSelection } from '../state/selection';
import { makeWrapper } from '../test/utils';
import { LinksView } from './LinksView';

vi.mock('../api/client');

function link(id: string, title: string): LinkDto {
  return {
    id,
    url: `https://example.com/${id}`,
    title,
    note: '',
    status: 'active',
    relevance: 3,
    dupeCount: 1,
    hubIds: [],
    imageUrl: null,
    firstSeen: '2026-07-21T00:00:00.000Z',
  };
}

function renderView(hubId?: string) {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <MemoryRouter>
        <LinksView hubId={hubId} />
      </MemoryRouter>
    </Wrapper>,
  );
}

describe('LinksView', () => {
  beforeEach(() => {
    vi.mocked(client.fetchLinks).mockReset();
    vi.mocked(client.fetchHubs).mockResolvedValue({ items: [] });
    useFilters.getState().reset();
    useSelection.getState().clear();
  });

  it('renders fetched rows and total', async () => {
    vi.mocked(client.fetchLinks).mockResolvedValue({
      items: [link('a', 'First link'), link('b', 'Second link')],
      total: 2,
    });
    renderView();
    expect(await screen.findByText('First link')).toBeInTheDocument();
    expect(screen.getByText('Second link')).toBeInTheDocument();
    expect(screen.getByText('2 results')).toBeInTheDocument();
  });

  it('virtualizes: renders only a window of a large page', async () => {
    const many = Array.from({ length: 200 }, (_, i) => link(`l${i}`, `Link number ${i}`));
    vi.mocked(client.fetchLinks).mockResolvedValue({ items: many, total: 200 });
    renderView();
    expect(await screen.findByText('Link number 0')).toBeInTheDocument();
    // 768px viewport / 64px rows + overscan ≪ 200 rows
    expect(screen.getAllByRole('checkbox').length).toBeLessThan(60);
    expect(screen.queryByText('Link number 199')).not.toBeInTheDocument();
  });

  it('passes hubId and filter state to the API', async () => {
    vi.mocked(client.fetchLinks).mockResolvedValue({ items: [], total: 0 });
    renderView('h7');
    await waitFor(() => expect(client.fetchLinks).toHaveBeenCalled());
    expect(client.fetchLinks).toHaveBeenLastCalledWith(
      expect.objectContaining({ hub: 'h7', status: 'active', offset: 0 }),
    );

    await userEvent.click(screen.getByLabelText('Unassigned only'));
    await waitFor(() =>
      expect(client.fetchLinks).toHaveBeenLastCalledWith(
        expect.objectContaining({ unassigned: true }),
      ),
    );
  });

  it('status select switches to archived', async () => {
    vi.mocked(client.fetchLinks).mockResolvedValue({ items: [], total: 0 });
    renderView();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'archived');
    await waitFor(() =>
      expect(client.fetchLinks).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'archived' }),
      ),
    );
  });

  it('select-all-loaded selects every fetched row', async () => {
    vi.mocked(client.fetchLinks).mockResolvedValue({
      items: [link('a', 'First link'), link('b', 'Second link')],
      total: 2,
    });
    renderView();
    await screen.findByText('First link');
    await userEvent.click(screen.getByLabelText('Select all loaded'));
    expect(useSelection.getState().selected.has('a')).toBe(true);
    expect(useSelection.getState().selected.has('b')).toBe(true);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });
});
