import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import { useSelection } from '../state/selection';
import { makeWrapper } from '../test/utils';
import { BulkBar } from './BulkBar';

vi.mock('../api/client');

describe('BulkBar', () => {
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
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(client.bulkLinks).toHaveBeenCalledWith({ ids: ['a', 'b'], action: 'archive' });
    await waitFor(() => expect(useSelection.getState().selected.size).toBe(0));
  });

  it('assigns selected ids to the chosen hub', async () => {
    useSelection.getState().setMany(['a', 'b'], true);
    render(<BulkBar />, { wrapper: makeWrapper() });
    await screen.findByRole('option', { name: 'AI' });
    await userEvent.selectOptions(screen.getByLabelText('Assign to hub'), 'h1');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(client.bulkLinks).toHaveBeenCalledWith({ ids: ['a', 'b'], action: 'assign', hubId: 'h1' });
  });

  it('Assign button disabled until a hub is chosen', async () => {
    useSelection.getState().setMany(['a'], true);
    render(<BulkBar />, { wrapper: makeWrapper() });
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('Clear empties selection without API call', async () => {
    useSelection.getState().setMany(['a'], true);
    render(<BulkBar />, { wrapper: makeWrapper() });
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(useSelection.getState().selected.size).toBe(0);
    expect(client.bulkLinks).not.toHaveBeenCalled();
  });
});
