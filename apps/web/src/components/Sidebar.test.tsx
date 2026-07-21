import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
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
});
