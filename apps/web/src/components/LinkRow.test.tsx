import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import type { LinkDto } from '../api/types';
import { useSelection } from '../state/selection';
import { makeWrapper } from '../test/utils';
import { LinkRow } from './LinkRow';

vi.mock('../api/client');

const base: LinkDto = {
  id: 'l1',
  url: 'https://example.com/post',
  title: 'Example post',
  note: 'why kept',
  status: 'active',
  relevance: 4,
  dupeCount: 3,
  hubIds: ['h1', 'h2'],
  firstSeen: '2026-07-21T00:00:00.000Z',
};

function renderRow(link: LinkDto) {
  vi.mocked(client.fetchHubs).mockResolvedValue({
    items: [
      { id: 'h1', name: 'AI', description: '', status: 'active', linkCount: 1 },
      { id: 'h2', name: 'Rust', description: '', status: 'active', linkCount: 1 },
    ],
  });
  return render(<LinkRow link={link} />, { wrapper: makeWrapper() });
}

describe('LinkRow', () => {
  beforeEach(() => {
    useSelection.getState().clear();
  });

  it('renders title link, relevance badge, note, dupe count and hub chips', async () => {
    renderRow(base);
    const anchor = screen.getByRole('link', { name: 'Example post' });
    expect(anchor).toHaveAttribute('href', 'https://example.com/post');
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('why kept')).toBeInTheDocument();
    expect(screen.getByText('×3')).toBeInTheDocument();
    expect(await screen.findByText('AI')).toBeInTheDocument();
    expect(screen.getByText('Rust')).toBeInTheDocument();
  });

  it('hides dupe marker when dupeCount is 1 and shows dash for null relevance', () => {
    renderRow({ ...base, dupeCount: 1, relevance: null, note: '', hubIds: [] });
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
    expect(screen.getByText('–')).toBeInTheDocument();
  });

  it('falls back to url as link text when title is empty', () => {
    renderRow({ ...base, title: '' });
    expect(screen.getByRole('link', { name: 'https://example.com/post' })).toHaveAttribute(
      'href',
      'https://example.com/post',
    );
  });

  it('checkbox toggles selection store', async () => {
    renderRow(base);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(useSelection.getState().selected.has('l1')).toBe(true);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(useSelection.getState().selected.has('l1')).toBe(false);
  });
});
