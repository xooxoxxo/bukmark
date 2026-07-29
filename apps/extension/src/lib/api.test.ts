import { afterEach, describe, expect, it, vi } from 'vitest';
import { listHubs, runBackfill, runImport, saveLink } from './api';
import type { FlatBookmark } from './bookmarks';

const BASE = 'http://server:8085';

afterEach(() => { vi.unstubAllGlobals(); });

function jsonOnce(bodies: unknown[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => {
    const body = bodies.shift();
    return { ok: true, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function bookmarks(n: number): FlatBookmark[] {
  return Array.from({ length: n }, (_, i) => ({
    url: `https://x.com/${i}`, title: `t${i}`, folderPath: 'Bar',
  }));
}

describe('saveLink', () => {
  it('posts to /api/links and returns the outcome', async () => {
    const fn = jsonOnce([{ outcome: 'created', link: { dupeCount: 1 } }]);
    const res = await saveLink(BASE, { url: 'https://a.com', title: 'A', note: 'why' });
    expect(res.outcome).toBe('created');
    expect(fn.mock.calls[0]![0]).toBe(`${BASE}/api/links`);
  });

  it('omits empty optional fields rather than sending blanks', async () => {
    const fn = jsonOnce([{ outcome: 'created', link: { dupeCount: 1 } }]);
    await saveLink(BASE, { url: 'https://a.com', title: '', note: '', hub: '' });
    const init = fn.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://a.com' });
  });

  it('throws the server error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 400, json: async () => ({ error: 'non-http url' }),
    } as unknown as Response)));
    await expect(saveLink(BASE, { url: 'ftp://a' })).rejects.toThrow('non-http url');
  });
});

describe('listHubs', () => {
  it('unwraps the items array', async () => {
    jsonOnce([{ items: [{ id: 'h1', name: 'rust', linkCount: 2 }] }]);
    await expect(listHubs(BASE)).resolves.toEqual([{ id: 'h1', name: 'rust', linkCount: 2 }]);
  });
});

describe('runImport', () => {
  it('splits into batches of 200 and sums the totals', async () => {
    const fn = jsonOnce([
      { created: 200, updated: 0, skippedDeleted: 0, invalid: [] },
      { created: 50, updated: 0, skippedDeleted: 0, invalid: [{ url: 'x', reason: 'bad' }] },
    ]);
    const totals = await runImport(BASE, bookmarks(250));
    expect(fn).toHaveBeenCalledTimes(2);
    expect(totals).toEqual({ created: 250, updated: 0, skippedDeleted: 0, invalid: 1 });
  });

  it('reports progress after each batch', async () => {
    jsonOnce([
      { created: 200, updated: 0, skippedDeleted: 0, invalid: [] },
      { created: 50, updated: 0, skippedDeleted: 0, invalid: [] },
    ]);
    const seen: number[] = [];
    await runImport(BASE, bookmarks(250), (p) => seen.push(p.done));
    expect(seen).toEqual([200, 250]);
  });

  it('does not call the server for an empty list', async () => {
    const fn = jsonOnce([]);
    const totals = await runImport(BASE, []);
    expect(fn).not.toHaveBeenCalled();
    expect(totals).toEqual({ created: 0, updated: 0, skippedDeleted: 0, invalid: 0 });
  });
});

describe('runBackfill', () => {
  it('loops until nothing remains', async () => {
    const fn = jsonOnce([
      { processed: 20, remaining: 30 },
      { processed: 20, remaining: 10 },
      { processed: 10, remaining: 0 },
    ]);
    await expect(runBackfill(BASE)).resolves.toBe(50);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops instead of spinning when the server stops making progress', async () => {
    // remaining > 0 but processed === 0 means nothing is claimable; looping
    // here would hammer the server forever.
    const fn = jsonOnce([{ processed: 0, remaining: 7 }]);
    await expect(runBackfill(BASE)).resolves.toBe(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reports remaining after each round', async () => {
    jsonOnce([{ processed: 20, remaining: 5 }, { processed: 5, remaining: 0 }]);
    const seen: number[] = [];
    await runBackfill(BASE, (r) => seen.push(r));
    expect(seen).toEqual([5, 0]);
  });
});
