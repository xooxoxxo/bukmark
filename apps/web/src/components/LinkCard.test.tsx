import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import type { LinkDto } from '../api/types';
import { useSelection } from '../state/selection';
import { makeWrapper } from '../test/utils';
import { LinkCard } from './LinkCard';

vi.mock('../api/client');

const base: LinkDto = {
  id: 'c1',
  url: 'https://example.com/card',
  title: 'Card link',
  note: '',
  status: 'active',
  relevance: 4,
  dupeCount: 1,
  hubIds: ['h1'],
  imageUrl: 'https://cdn.example.com/card.png',
  firstSeen: '2026-07-21T00:00:00.000Z',
};

function renderCard(link: LinkDto) {
  vi.mocked(client.fetchHubs).mockResolvedValue({
    items: [{ id: 'h1', name: 'AI', description: '', status: 'active', linkCount: 1 }],
  });
  return render(<LinkCard link={link} />, { wrapper: makeWrapper() });
}

describe('LinkCard', () => {
  beforeEach(() => {
    useSelection.getState().clear();
  });

  it('renders image, title link, badge and hub chips', async () => {
    renderCard(base);
    expect(screen.getByRole('presentation')).toHaveAttribute('src', 'https://cdn.example.com/card.png');
    expect(screen.getByRole('link', { name: 'Card link' })).toHaveAttribute('href', 'https://example.com/card');
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(await screen.findByText('AI')).toBeInTheDocument();
  });

  it('shows placeholder when imageUrl null or image errors', () => {
    const { unmount } = renderCard({ ...base, imageUrl: null });
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
    unmount();
    renderCard(base);
    fireEvent.error(screen.getByRole('presentation'));
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
  });

  it('checkbox toggles selection', async () => {
    renderCard(base);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(useSelection.getState().selected.has('c1')).toBe(true);
  });
});
