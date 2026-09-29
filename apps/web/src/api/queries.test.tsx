import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeWrapper } from '../test/utils';
import * as client from './client';
import {
  PAGE_SIZE,
  QUOTES_PAGE_SIZE,
  useBulkLinks,
  useCreateQuote,
  useDeleteLink,
  useDeleteQuote,
  useImportLinks,
  useLinksInfinite,
  useQuotes,
  useUpdateQuote,
} from './queries';
import type { LinkDto, QuoteDto } from './types';

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
  const result = (n: number, added: number, alreadyHere = 0, invalid = 0) => ({
    created: n, updated: 0, skippedDeleted: 0, invalid: [], quotes: { added, alreadyHere, invalid },
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
    expect(total.quotes).toEqual({ added: 5, alreadyHere: 1, invalid: 0 });
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

function quote(id: string): QuoteDto {
  return {
    id,
    linkId: 'l1',
    text: `Passage ${id}.`,
    note: '',
    sourceUrl: 'https://example.com/a',
    sourceTitle: 'Example',
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  };
}

/** A wrapper whose client the test can watch for invalidations. */
function spiedWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const keys = () => invalidate.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
  return { Wrapper, keys };
}

describe('useQuotes', () => {
  beforeEach(() => {
    vi.mocked(client.fetchQuotes).mockReset();
  });

  it('asks for the first page with no cursor, then follows nextCursor until it is null', async () => {
    vi.mocked(client.fetchQuotes)
      .mockResolvedValueOnce({ items: [quote('a')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [quote('b')], nextCursor: null });
    const { result } = renderHook(() => useQuotes({ q: 'rust' }), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.fetchQuotes).toHaveBeenCalledWith({ q: 'rust', limit: QUOTES_PAGE_SIZE });
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
    expect(client.fetchQuotes).toHaveBeenLastCalledWith({ q: 'rust', limit: QUOTES_PAGE_SIZE, cursor: 'c1' });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('lists one link\'s quotes', async () => {
    vi.mocked(client.fetchQuotes).mockResolvedValue({ items: [], nextCursor: null });
    const { result } = renderHook(() => useQuotes({ linkId: 'l1' }), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.fetchQuotes).toHaveBeenCalledWith({ linkId: 'l1', limit: QUOTES_PAGE_SIZE });
  });
});

describe('quote mutations', () => {
  it('useCreateQuote refreshes quotes, links, hubs and stats: a quote can save its page', async () => {
    vi.mocked(client.createQuote).mockResolvedValue({ quote: quote('a'), link: { id: 'l1', created: true } });
    const { Wrapper, keys } = spiedWrapper();
    const { result } = renderHook(() => useCreateQuote(), { wrapper: Wrapper });
    await result.current.mutateAsync({ url: 'https://example.com/a', text: 'Passage a.' });
    expect(client.createQuote).toHaveBeenCalledWith({ url: 'https://example.com/a', text: 'Passage a.' });
    await waitFor(() => expect(keys()).toEqual(expect.arrayContaining(['quotes', 'links', 'link', 'hubs', 'stats'])));
  });

  it('useUpdateQuote patches and refreshes the quote lists', async () => {
    vi.mocked(client.patchQuote).mockResolvedValue({ ...quote('a'), note: 'n' });
    const { Wrapper, keys } = spiedWrapper();
    const { result } = renderHook(() => useUpdateQuote(), { wrapper: Wrapper });
    const out = await result.current.mutateAsync({ id: 'a', body: { note: 'n' } });
    expect(out.note).toBe('n');
    expect(client.patchQuote).toHaveBeenCalledWith('a', { note: 'n' });
    expect(keys()).toContain('quotes');
  });

  it('useDeleteQuote deletes and refreshes quotes, links and stats', async () => {
    vi.mocked(client.deleteQuote).mockResolvedValue(undefined);
    const { Wrapper, keys } = spiedWrapper();
    const { result } = renderHook(() => useDeleteQuote(), { wrapper: Wrapper });
    await result.current.mutateAsync('a');
    expect(client.deleteQuote).toHaveBeenCalledWith('a');
    expect(keys()).toEqual(expect.arrayContaining(['quotes', 'links', 'link', 'stats']));
  });
});

describe('link changes refresh the quote lists', () => {
  it('an import (which carries quotes), a link delete and a bulk change invalidate quotes', async () => {
    vi.mocked(client.importLinks).mockResolvedValue({
      created: 0, updated: 0, skippedDeleted: 0, invalid: [], quotes: { added: 1, alreadyHere: 0, invalid: 0 },
    });
    vi.mocked(client.bulkLinks).mockResolvedValue({ affected: 1 });

    const imp = spiedWrapper();
    const { result: importHook } = renderHook(() => useImportLinks(), { wrapper: imp.Wrapper });
    await importHook.current.mutateAsync({ items: [{ url: 'https://a.com', quotes: [{ text: 'q' }] }] });
    expect(imp.keys()).toContain('quotes');

    const del = spiedWrapper();
    const { result: deleteHook } = renderHook(() => useDeleteLink(), { wrapper: del.Wrapper });
    await deleteHook.current.mutateAsync('l1');
    expect(del.keys()).toContain('quotes');

    const bulk = spiedWrapper();
    const { result: bulkHook } = renderHook(() => useBulkLinks(), { wrapper: bulk.Wrapper });
    await bulkHook.current.mutateAsync({ ids: ['l1'], action: 'delete' });
    expect(bulk.keys()).toContain('quotes');
  });
});
