import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import type { LinkDto } from '../api/types';
import { useSelection } from '../state/selection';
import { makeWrapper } from '../test/utils';
import { BulkBar } from './BulkBar';

vi.mock('../api/client');

function link(id: string, hubIds: string[] = []): LinkDto {
  return {
    id,
    url: `https://example.com/${id}`,
    title: id,
    note: '',
    status: 'active',
    relevance: null,
    dupeCount: 1,
    hubIds,
    imageUrl: null,
    firstSeen: '2026-07-21T00:00:00.000Z',
  };
}

function renderBulk(selectedLinks: LinkDto[]) {
  useSelection.getState().setMany(
    selectedLinks.map((item) => item.id),
    true,
  );
  return render(<BulkBar selectedLinks={selectedLinks} />, { wrapper: makeWrapper() });
}

describe('BulkBar', () => {
  async function openActions() {
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
  }

  beforeEach(() => {
    useSelection.getState().clear();
    vi.mocked(client.errorMessage).mockImplementation((error) =>
      error instanceof Error ? error.message : 'unexpected error',
    );
    vi.mocked(client.fetchHubs).mockResolvedValue({
      items: [
        { id: 'h1', name: 'AI', description: '', status: 'active', linkCount: 0 },
        { id: 'h2', name: 'Reading', description: '', status: 'active', linkCount: 0 },
      ],
    });
    vi.mocked(client.bulkLinks).mockReset();
    vi.mocked(client.bulkLinks).mockResolvedValue({ affected: 2 });
  });

  it('renders nothing when selection is empty', () => {
    render(<BulkBar selectedLinks={[]} />, { wrapper: makeWrapper() });
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it('archives selected ids and clears selection', async () => {
    renderBulk([link('a'), link('b')]);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await openActions();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(client.bulkLinks).toHaveBeenCalledWith({ ids: ['a', 'b'], action: 'archive' });
    await waitFor(() => expect(useSelection.getState().selected.size).toBe(0));
  });

  it('checks only hubs common to every selected link', async () => {
    renderBulk([link('a', ['h1', 'h2']), link('b', ['h1'])]);
    await openActions();

    expect(await screen.findByRole('menuitemcheckbox', { name: 'AI' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Reading' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('keeps hub choices alphabetical when the API order changes', async () => {
    vi.mocked(client.fetchHubs).mockResolvedValueOnce({
      items: [
        { id: 'h2', name: 'Reading', description: '', status: 'active', linkCount: 0 },
        { id: 'h1', name: 'AI', description: '', status: 'active', linkCount: 0 },
      ],
    });
    renderBulk([link('a')]);
    await openActions();

    expect((await screen.findAllByRole('menuitemcheckbox')).map((item) => item.textContent)).toEqual([
      'AI',
      'Reading',
    ]);
  });

  it('assigns an unchecked hub immediately and preserves selection', async () => {
    renderBulk([link('a', ['h1']), link('b')]);
    await openActions();
    const item = await screen.findByRole('menuitemcheckbox', { name: 'AI' });
    expect(item).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(item);

    expect(client.bulkLinks).toHaveBeenCalledWith({
      ids: ['a', 'b'],
      action: 'assign',
      hubId: 'h1',
    });
    await waitFor(() => expect(useSelection.getState().selected.size).toBe(2));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Reading' })).toBeInTheDocument();
  });

  it('unassigns a common checked hub immediately and preserves selection', async () => {
    renderBulk([link('a', ['h1']), link('b', ['h1'])]);
    await openActions();
    const item = await screen.findByRole('menuitemcheckbox', { name: 'AI' });
    expect(item).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(item);

    expect(client.bulkLinks).toHaveBeenCalledWith({
      ids: ['a', 'b'],
      action: 'unassign',
      hubId: 'h1',
    });
    await waitFor(() => expect(useSelection.getState().selected.size).toBe(2));
  });

  it('disables only the hub whose membership is being saved', async () => {
    let finish!: (value: { affected: number }) => void;
    vi.mocked(client.bulkLinks).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderBulk([link('a')]);
    await openActions();
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'AI' }));

    expect(screen.getByRole('menuitemcheckbox', { name: 'AI' })).toHaveAttribute('data-disabled');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Reading' })).not.toHaveAttribute(
      'data-disabled',
    );

    finish({ affected: 1 });
    await waitFor(() =>
      expect(screen.getByRole('menuitemcheckbox', { name: 'AI' })).not.toHaveAttribute(
        'data-disabled',
      ),
    );
  });

  it('Clear empties selection without an API call', async () => {
    renderBulk([link('a')]);
    await openActions();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Clear selection' }));
    expect(useSelection.getState().selected.size).toBe(0);
    expect(client.bulkLinks).not.toHaveBeenCalled();
  });

  it('delete requires two clicks, then calls the API and clears selection', async () => {
    renderBulk([link('a'), link('b')]);
    await openActions();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(client.bulkLinks).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Really delete 2?' }));
    expect(client.bulkLinks).toHaveBeenCalledWith({ ids: ['a', 'b'], action: 'delete' });
    await waitFor(() => expect(useSelection.getState().selected.size).toBe(0));
  });

  it('delete confirmation disarms when selection changes', async () => {
    renderBulk([link('a')]);
    await openActions();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByRole('menuitem', { name: 'Really delete 1?' })).toBeInTheDocument();
    await act(async () => {
      useSelection.getState().setMany(['b'], true);
    });
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(client.bulkLinks).not.toHaveBeenCalled();
  });

  it('keeps selection and the menu open when a hub toggle fails', async () => {
    vi.mocked(client.bulkLinks).mockRejectedValueOnce(new Error('membership failed'));
    renderBulk([link('a')]);
    await openActions();
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'AI' }));

    expect(await screen.findByText('membership failed')).toHaveAttribute('role', 'alert');
    expect(useSelection.getState().selected.has('a')).toBe(true);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Reading' })).toBeInTheDocument();
  });
});
