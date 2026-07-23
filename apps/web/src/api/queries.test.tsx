import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeWrapper } from '../test/utils';
import * as client from './client';
import { PAGE_SIZE, useBulkLinks, useLinksInfinite } from './queries';
import type { LinkDto } from './types';

vi.mock('./client');

function link(id: string): LinkDto {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Link ${id}`,
    note: '',
    status: 'active',
    relevance: 3,
    dupeCount: 1,
    hubIds: [],
    imageUrl: null,
    firstSeen: '2026-07-21T00:00:00.000Z',
  };
}

describe('useLinksInfinite', () => {
  beforeEach(() => {
    vi.mocked(client.fetchLinks).mockReset();
  });

  it('fetches first page with PAGE_SIZE and offset 0', async () => {
    vi.mocked(client.fetchLinks).mockResolvedValue({ items: [link('a')], total: 1 });
    const { result } = renderHook(() => useLinksInfinite({ q: 'rust' }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.fetchLinks).toHaveBeenCalledWith({
      q: 'rust',
      limit: PAGE_SIZE,
      offset: 0,
    });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('pages by offset until total reached', async () => {
    const pageOne = Array.from({ length: PAGE_SIZE }, (_, i) => link(`p1-${i}`));
    vi.mocked(client.fetchLinks)
      .mockResolvedValueOnce({ items: pageOne, total: PAGE_SIZE + 1 })
      .mockResolvedValueOnce({ items: [link('p2-0')], total: PAGE_SIZE + 1 });
    const { result } = renderHook(() => useLinksInfinite({}), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
    expect(client.fetchLinks).toHaveBeenLastCalledWith({ limit: PAGE_SIZE, offset: PAGE_SIZE });
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe('useBulkLinks', () => {
  it('calls client and resolves affected count', async () => {
    vi.mocked(client.bulkLinks).mockResolvedValue({ affected: 2 });
    const { result } = renderHook(() => useBulkLinks(), { wrapper: makeWrapper() });
    const out = await result.current.mutateAsync({ ids: ['a', 'b'], action: 'archive' });
    expect(out).toEqual({ affected: 2 });
    expect(client.bulkLinks).toHaveBeenCalledWith({ ids: ['a', 'b'], action: 'archive' });
  });
});
