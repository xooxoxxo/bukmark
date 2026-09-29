import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, bulkLinks, fetchLinks, fetchStats, importLinks, patchLink } from './client';

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('api client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('fetchLinks builds query string, skipping empty params', async () => {
    fetchMock.mockResolvedValue(okResponse({ items: [], total: 0 }));
    await fetchLinks({ q: 'rust', unassigned: true, status: 'active', limit: 200, offset: 400 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/links?q=rust&unassigned=true&status=active&limit=200&offset=400',
      undefined,
    );
  });

  it('fetchLinks asks for broken links and a sort, leaving the default sort out', async () => {
    fetchMock.mockImplementation(async () => okResponse({ items: [], total: 0 }));
    await fetchLinks({ broken: true, sort: 'newest' });
    expect(fetchMock).toHaveBeenCalledWith('/api/links?broken=true&sort=newest', undefined);
    await fetchLinks({ sort: 'relevance' });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/links', undefined);
  });

  it('fetchLinks with no params hits bare /api/links', async () => {
    fetchMock.mockResolvedValue(okResponse({ items: [], total: 0 }));
    await fetchLinks();
    expect(fetchMock).toHaveBeenCalledWith('/api/links', undefined);
  });

  it('patchLink sends JSON PATCH body', async () => {
    fetchMock.mockResolvedValue(okResponse({ id: 'x' }));
    await patchLink('abc', { status: 'archived' });
    expect(fetchMock).toHaveBeenCalledWith('/api/links/abc', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
  });

  it('bulkLinks posts ids + action', async () => {
    fetchMock.mockResolvedValue(okResponse({ affected: 2 }));
    const out = await bulkLinks({ ids: ['a', 'b'], action: 'assign', hubId: 'h1' });
    expect(out).toEqual({ affected: 2 });
    expect(fetchMock).toHaveBeenCalledWith('/api/links/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['a', 'b'], action: 'assign', hubId: 'h1' }),
    });
  });

  it('throws ApiError with server message and status', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'link not found' }), { status: 404 }),
    );
    const err = await patchLink('nope', { title: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('link not found');
    expect((err as ApiError).status).toBe(404);
  });

  it('throws ApiError with HTTP status when body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const err = await fetchStats().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('HTTP 500');
  });

  it('importLinks sends orphanQuotes only when there are some', async () => {
    fetchMock.mockImplementation(async () => okResponse({ created: 0 }));
    const items = [{ url: 'https://a.com', quotes: [{ text: 'q' }] }];
    await importLinks(items);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ items });
    const orphanQuotes = [{ text: 'o', sourceUrl: 'https://gone.com' }];
    await importLinks(items, orphanQuotes);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ items, orphanQuotes });
  });
});
