import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import { useFilters } from '../state/filters';
import { makeWrapper } from '../test/utils';
import { AppToolbar } from './AppToolbar';

vi.mock('../api/client');

function renderAt(path = '/') {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<AppToolbar />} />
          <Route path="/hubs/:hubId" element={<AppToolbar />} />
          <Route path="/settings/tokens" element={<AppToolbar />} />
        </Routes>
      </MemoryRouter>
    </Wrapper>,
  );
}

async function openActions(name: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }));
}

describe('AppToolbar', () => {
  beforeEach(() => {
    useFilters.getState().reset();
    vi.mocked(client.fetchHubs).mockReset();
    vi.mocked(client.fetchHubs).mockResolvedValue({
      items: [
        { id: 'h1', name: 'AI', description: 'ml stuff', status: 'active', linkCount: 3 },
      ],
    });
    vi.mocked(client.patchHub).mockReset();
    vi.mocked(client.patchHub).mockResolvedValue({ id: 'h1' });
    vi.mocked(client.deleteHub).mockReset();
    vi.mocked(client.deleteHub).mockResolvedValue({ ok: true });
  });

  it('shows the default section name and keeps export inside its context menu', async () => {
    renderAt();

    expect(await screen.findByRole('heading', { name: 'All links' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();

    await openActions('All links');
    const html = await screen.findByRole('menuitem', { name: 'Export HTML' });
    expect(html).toHaveAttribute('href', '/api/export?format=html&status=active');
    expect(html).toHaveAttribute('download');
    expect(screen.getByRole('menuitem', { name: 'Export JSON' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Export CSV' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Full backup (JSON)' })).toHaveAttribute(
      'href',
      '/api/export?format=json&status=all',
    );
  });

  it('names the unassigned context and carries that filter into exports', async () => {
    useFilters.getState().setUnassigned(true);
    useFilters.getState().setQ('rust');
    renderAt();

    expect(await screen.findByRole('heading', { name: 'Unassigned' })).toBeInTheDocument();
    await openActions('Unassigned');
    expect(screen.getByRole('menuitem', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      expect.stringContaining('unassigned=true'),
    );
    expect(screen.getByRole('menuitem', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      expect.stringContaining('q=rust'),
    );
  });

  it('names the access tokens page and offers no link actions there', async () => {
    useFilters.getState().setUnassigned(true);
    renderAt('/settings/tokens');

    expect(await screen.findByRole('heading', { name: 'Access tokens' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Unassigned' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument();
  });

  it('shows hub identity and hub-only actions next to the name', async () => {
    renderAt('/hubs/h1');

    expect(await screen.findByRole('heading', { name: 'AI' })).toBeInTheDocument();
    expect(screen.getByText('ml stuff')).toBeInTheDocument();
    await openActions('AI');
    expect(await screen.findByRole('menuitem', { name: 'Rename hub' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Archive hub' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete hub' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Export HTML' })).toHaveAttribute(
      'href',
      expect.stringContaining('hub=h1'),
    );
  });

  it('renames the hub in place', async () => {
    renderAt('/hubs/h1');
    await openActions('AI');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename hub' }));

    const input = screen.getByLabelText('Hub name');
    await userEvent.clear(input);
    await userEvent.type(input, 'AI & ML');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(client.patchHub).toHaveBeenCalledWith('h1', { name: 'AI & ML' });
  });

  it('archives the hub from the menu', async () => {
    renderAt('/hubs/h1');
    await openActions('AI');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive hub' }));

    expect(client.patchHub).toHaveBeenCalledWith('h1', { status: 'archived' });
  });

  it('deletes only after confirmation and then navigates home', async () => {
    renderAt('/hubs/h1');
    await openActions('AI');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete hub' }));
    expect(client.deleteHub).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('menuitem', { name: 'Really delete hub?' }));
    expect(client.deleteHub).toHaveBeenCalledWith('h1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'All links' })).toBeInTheDocument(),
    );
  });
});
