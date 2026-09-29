import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import { useFilters } from '../state/filters';
import { makeWrapper } from '../test/utils';
import { Sidebar } from './Sidebar';

vi.mock('../api/client');

function renderSidebar() {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    </Wrapper>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    useFilters.getState().reset();
    vi.mocked(client.fetchStats).mockResolvedValue({
      links: 243,
      active: 201,
      archived: 42,
      hubs: 2,
      unassigned: 17, broken: 0, unchecked: 0, quotes: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists hubs with link counts and an All links entry', async () => {
    vi.mocked(client.fetchHubs).mockResolvedValue({
      items: [
        { id: 'h1', name: 'AI', description: '', status: 'active', linkCount: 120 },
        { id: 'h2', name: 'Rust', description: '', status: 'active', linkCount: 80 },
      ],
    });
    renderSidebar();
    expect(screen.getByRole('link', { name: 'All links' })).toHaveAttribute('href', '/');
    expect(await screen.findByRole('button', { name: 'Unassigned 17' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'AI 120' })).toHaveAttribute('href', '/hubs/h1');
    expect(screen.getByRole('link', { name: 'Rust 80' })).toHaveAttribute('href', '/hubs/h2');
  });

  it('creates a hub from the inline form and clears the input', async () => {
    vi.mocked(client.fetchHubs).mockResolvedValue({ items: [] });
    vi.mocked(client.createHub).mockResolvedValue({ id: 'h9', name: 'Reading' });
    renderSidebar();
    const input = screen.getByPlaceholderText('New hub…');
    await userEvent.type(input, 'Reading');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(client.createHub).toHaveBeenCalledWith({ name: 'Reading' });
    expect(input).toHaveValue('');
  });

  it('ignores submit with empty name', async () => {
    vi.mocked(client.fetchHubs).mockResolvedValue({ items: [] });
    renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(client.createHub).not.toHaveBeenCalled();
  });

  it('uses the Unassigned item as a filter and All links clears it', async () => {
    vi.mocked(client.fetchHubs).mockResolvedValue({ items: [] });
    renderSidebar();
    const unassigned = await screen.findByRole('button', { name: 'Unassigned 17' });

    await userEvent.click(unassigned);
    expect(useFilters.getState().unassigned).toBe(true);
    expect(unassigned).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('link', { name: 'All links' }));
    expect(useFilters.getState().unassigned).toBe(false);
  });

  it('offers Broken links only when there are some, as a filter that All links clears', async () => {
    vi.mocked(client.fetchHubs).mockResolvedValue({ items: [] });
    renderSidebar();
    await screen.findByRole('button', { name: 'Unassigned 17' });
    expect(screen.queryByRole('button', { name: /Broken links/ })).toBeNull();
  });

  it('filters to broken links, and All links or Unassigned leave that filter', async () => {
    vi.mocked(client.fetchStats).mockResolvedValue({
      links: 243, active: 201, archived: 42, hubs: 2, unassigned: 17, broken: 3, unchecked: 0, quotes: 0,
    });
    vi.mocked(client.fetchHubs).mockResolvedValue({ items: [] });
    renderSidebar();
    const broken = await screen.findByRole('button', { name: 'Broken links 3' });
    await userEvent.click(broken);
    expect(useFilters.getState().broken).toBe(true);
    expect(broken).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Unassigned 17' }));
    expect(useFilters.getState()).toMatchObject({ broken: false, unassigned: true });
    await userEvent.click(broken);
    await userEvent.click(screen.getByRole('link', { name: 'All links' }));
    expect(useFilters.getState()).toMatchObject({ broken: false, unassigned: false });
  });

  it('links to Quotes with the count from stats', async () => {
    vi.mocked(client.fetchStats).mockResolvedValue({
      links: 1, active: 1, archived: 0, hubs: 0, unassigned: 0, broken: 0, unchecked: 0, quotes: 5,
    });
    vi.mocked(client.fetchHubs).mockResolvedValue({ items: [] });
    renderSidebar();
    expect(await screen.findByRole('link', { name: 'Quotes 5' })).toHaveAttribute('href', '/quotes');
  });
});
