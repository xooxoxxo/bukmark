import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import { useSelection } from '../state/selection';
import { makeWrapper } from '../test/utils';
import { BulkBar } from './BulkBar';

vi.mock('../api/client');

describe('BulkBar', () => {
  async function openActions() {
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
  }

  beforeEach(() => {
    useSelection.getState().clear();
    vi.mocked(client.fetchHubs).mockResolvedValue({
      items: [{ id: 'h1', name: 'AI', description: '', status: 'active', linkCount: 0 }],
    });
    vi.mocked(client.bulkLinks).mockReset();
    vi.mocked(client.bulkLinks).mockResolvedValue({ affected: 2 });
  });

  it('renders nothing when selection is empty', () => {
    render(<BulkBar />, { wrapper: makeWrapper() });
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it('archives selected ids and clears selection', async () => {
    useSelection.getState().setMany(['a', 'b'], true);
    render(<BulkBar />, { wrapper: makeWrapper() });
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await openActions();
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(client.bulkLinks).toHaveBeenCalledWith({ ids: ['a', 'b'], action: 'archive' });
    await waitFor(() => expect(useSelection.getState().selected.size).toBe(0));
  });

  it('assigns selected ids to the chosen hub', async () => {
    useSelection.getState().setMany(['a', 'b'], true);
    render(<BulkBar />, { wrapper: makeWrapper() });
    await openActions();
    await userEvent.click(screen.getByRole('combobox', { name: 'Assign to hub' }));
    await userEvent.click(await screen.findByRole('option', { name: 'AI' }));
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(client.bulkLinks).toHaveBeenCalledWith({ ids: ['a', 'b'], action: 'assign', hubId: 'h1' });
  });

  it('Assign button disabled until a hub is chosen', async () => {
    useSelection.getState().setMany(['a'], true);
    render(<BulkBar />, { wrapper: makeWrapper() });
    await openActions();
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('Clear empties selection without API call', async () => {
    useSelection.getState().setMany(['a'], true);
    render(<BulkBar />, { wrapper: makeWrapper() });
    await openActions();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(useSelection.getState().selected.size).toBe(0);
    expect(client.bulkLinks).not.toHaveBeenCalled();
  });

  it('delete requires two clicks, then calls API and clears selection', async () => {
    useSelection.getState().setMany(['a', 'b'], true);
    render(<BulkBar />, { wrapper: makeWrapper() });
    await openActions();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(client.bulkLinks).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Really delete 2?' }));
    expect(client.bulkLinks).toHaveBeenCalledWith({ ids: ['a', 'b'], action: 'delete' });
    await waitFor(() => expect(useSelection.getState().selected.size).toBe(0));
  });

  it('delete confirm disarms when selection changes', async () => {
    useSelection.getState().setMany(['a'], true);
    render(<BulkBar />, { wrapper: makeWrapper() });
    await openActions();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Really delete 1?' })).toBeInTheDocument();
    await act(async () => {
      useSelection.getState().setMany(['b'], true);
    });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(client.bulkLinks).not.toHaveBeenCalled();
  });
});
