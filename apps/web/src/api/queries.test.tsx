import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeWrapper } from '../test/utils';
import * as client from './client';
import { PAGE_SIZE, useBulkLinks, useImportLinks, useLinksInfinite } from './queries';
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

describe('useImportLinks', () => {
  const result = (n: number, added: number, skipped = 0) => ({
    created: n, updated: 0, skippedDeleted: 0, invalid: [], quotes: { added, skipped },
  });

  beforeEach(() => {
    vi.mocked(client.importLinks).mockReset();
  });

  it('keeps each item\'s quotes with it across batches, sends orphans once with the first batch, and sums the counts', async () => {
    vi.mocked(client.importLinks)
      .mockResolvedValueOnce(result(200, 3, 1))
      .mockResolvedValueOnce(result(1, 2));
    const items = Array.from({ length: 201 }, (_, i) => ({ url: `https://a.com/${i}` }));
    const first = { ...items[0]!, quotes: [{ text: 'one' }] };
    const last = { ...items[200]!, quotes: [{ text: 'three' }, { text: 'four', note: 'n' }] };
    const all = [first, ...items.slice(1, 200), last];
    const orphans = [{ text: 'o', sourceUrl: 'https://gone.com' }];

    const { result: hook } = renderHook(() => useImportLinks(), { wrapper: makeWrapper() });
    const total = await hook.current.mutateAsync({ items: all, orphanQuotes: orphans });

    const calls = vi.mocked(client.importLinks).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([all.slice(0, 200), orphans]);
    expect(calls[1]).toEqual([[last], undefined]);
    expect(total.quotes).toEqual({ added: 5, skipped: 1 });
    expect(total.created).toBe(201);
  });

  it('spreads more than 1000 orphans over requests that carry no items', async () => {
    vi.mocked(client.importLinks).mockResolvedValue(result(1, 0));
    const orphans = Array.from({ length: 2500 }, (_, i) => ({ text: `o${i}`, sourceUrl: 'https://gone.com' }));
    const { result: hook } = renderHook(() => useImportLinks(), { wrapper: makeWrapper() });
    await hook.current.mutateAsync({ items: [{ url: 'https://a.com/1' }], orphanQuotes: orphans });
    const calls = vi.mocked(client.importLinks).mock.calls;
    expect(calls.map((c) => c[1]?.length)).toEqual([1000, 1000, 500]);
    expect(calls.map((c) => c[0].length)).toEqual([1, 0, 0]);
  });

  it('imports orphan quotes from a file with no links', async () => {
    vi.mocked(client.importLinks).mockResolvedValue(result(0, 1));
    const orphans = [{ text: 'o', sourceUrl: 'https://gone.com' }];
    const { result: hook } = renderHook(() => useImportLinks(), { wrapper: makeWrapper() });
    await hook.current.mutateAsync({ items: [], orphanQuotes: orphans });
    expect(vi.mocked(client.importLinks).mock.calls).toEqual([[[], orphans]]);
  });

  it('closes a batch before its body passes the byte budget', async () => {
    vi.mocked(client.importLinks).mockResolvedValue(result(0, 0));
    const big = 'x'.repeat(9000);
    const items = Array.from({ length: 100 }, (_, i) => ({
      url: `https://a.com/${i}`,
      quotes: Array.from({ length: 5 }, (_, j) => ({ text: `${j} ${big}` })),
    }));
    const { result: hook } = renderHook(() => useImportLinks(), { wrapper: makeWrapper() });
    await hook.current.mutateAsync({ items });
    const calls = vi.mocked(client.importLinks).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.flatMap((c) => c[0])).toEqual(items);
    for (const c of calls) {
      expect(c[0].length).toBeLessThanOrEqual(200);
      expect(new TextEncoder().encode(JSON.stringify({ items: c[0] })).length).toBeLessThan(800_000 + 60_000);
    }
  });
});
