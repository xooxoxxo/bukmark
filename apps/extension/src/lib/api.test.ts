import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome, stubFetch, type FakeChrome } from '../test/chrome';
import { listHubs, runBackfill, runImport, saveLink } from './api';
import { AuthRequiredError } from './auth';
import type { FlatBookmark } from './bookmarks';

const AUTH = { server: 'http://server:8085', token: 'bkm_secret-token-value' };

let chrome: FakeChrome;

beforeEach(() => {
  chrome = fakeChrome({ local: { auth: { ...AUTH, tokenId: 't1', name: 'bukmark capture', createdAt: 1 } } });
  vi.stubGlobal('chrome', chrome);
});

afterEach(() => { vi.unstubAllGlobals(); });

function jsonOnce(bodies: unknown[]) {
  return stubFetch(() => ({ body: bodies.shift() }));
}

function bookmarks(n: number): FlatBookmark[] {
  return Array.from({ length: n }, (_, i) => ({
    url: `https://x.com/${i}`, title: `t${i}`, folderPath: 'Bar',
  }));
}

describe('saveLink', () => {
  it('posts to /api/links and returns the outcome', async () => {
    const requests = jsonOnce([{ outcome: 'created', link: { dupeCount: 1 } }]);
    const res = await saveLink(AUTH, { url: 'https://a.com', title: 'A', note: 'why' });
    expect(res.outcome).toBe('created');
    expect(requests[0]).toMatchObject({ method: 'POST', url: `${AUTH.server}/api/links` });
  });

  it('omits empty optional fields rather than sending blanks', async () => {
    const requests = jsonOnce([{ outcome: 'created', link: { dupeCount: 1 } }]);
    await saveLink(AUTH, { url: 'https://a.com', title: '', note: '', hub: '' });
    expect(requests[0]!.body).toEqual({ url: 'https://a.com' });
  });

  it('throws the server error message', async () => {
    stubFetch(() => ({ status: 400, body: { error: 'non-http url' } }));
    await expect(saveLink(AUTH, { url: 'ftp://a' })).rejects.toThrow('non-http url');
  });
});

describe('listHubs', () => {
  it('unwraps the items array', async () => {
    jsonOnce([{ items: [{ id: 'h1', name: 'rust', linkCount: 2 }] }]);
    await expect(listHubs(AUTH)).resolves.toEqual([{ id: 'h1', name: 'rust', linkCount: 2 }]);
  });
});

describe('runImport', () => {
  it('splits into batches of 200 and sums the totals', async () => {
    const requests = jsonOnce([
      { created: 200, updated: 0, skippedDeleted: 0, invalid: [] },
      { created: 50, updated: 0, skippedDeleted: 0, invalid: [{ url: 'x', reason: 'bad' }] },
    ]);
    const totals = await runImport(AUTH, bookmarks(250));
    expect(requests).toHaveLength(2);
    expect(totals).toEqual({ created: 250, updated: 0, skippedDeleted: 0, invalid: 1 });
  });

  it('reports progress after each batch', async () => {
    jsonOnce([
      { created: 200, updated: 0, skippedDeleted: 0, invalid: [] },
      { created: 50, updated: 0, skippedDeleted: 0, invalid: [] },
    ]);
    const seen: number[] = [];
    await runImport(AUTH, bookmarks(250), (p) => seen.push(p.done));
    expect(seen).toEqual([200, 250]);
  });

  it('does not call the server for an empty list', async () => {
    const requests = jsonOnce([]);
    const totals = await runImport(AUTH, []);
    expect(requests).toHaveLength(0);
    expect(totals).toEqual({ created: 0, updated: 0, skippedDeleted: 0, invalid: 0 });
  });
});

describe('runBackfill', () => {
  it('loops until nothing remains', async () => {
    const requests = jsonOnce([
      { processed: 20, remaining: 30 },
      { processed: 20, remaining: 10 },
      { processed: 10, remaining: 0 },
    ]);
    await expect(runBackfill(AUTH)).resolves.toBe(50);
    expect(requests).toHaveLength(3);
  });

  it('stops instead of spinning when the server stops making progress', async () => {
    // remaining > 0 but processed === 0 means nothing is claimable; looping
    // here would hammer the server forever.
    const requests = jsonOnce([{ processed: 0, remaining: 7 }]);
    await expect(runBackfill(AUTH)).resolves.toBe(0);
    expect(requests).toHaveLength(1);
  });

  it('reports remaining after each round', async () => {
    jsonOnce([{ processed: 20, remaining: 5 }, { processed: 5, remaining: 0 }]);
    const seen: number[] = [];
    await runBackfill(AUTH, (r) => seen.push(r));
    expect(seen).toEqual([5, 0]);
  });
});

describe('every request', () => {
  it('carries the bearer token and goes only to the token’s own server', async () => {
    const requests = stubFetch(({ url }) => ({
      body: url.endsWith('/api/hubs') ? { items: [] }
        : url.endsWith('/api/links/import') ? { created: 1, updated: 0, skippedDeleted: 0, invalid: [] }
        : url.endsWith('/api/links/og-backfill') ? { processed: 0, remaining: 0 }
        : { outcome: 'created', link: { dupeCount: 1 } },
    }));
    await saveLink(AUTH, { url: 'https://a.com' });
    await listHubs(AUTH);
    await runImport(AUTH, bookmarks(1));
    await runBackfill(AUTH);
    expect(requests.map((r) => r.url)).toEqual([
      `${AUTH.server}/api/links`,
      `${AUTH.server}/api/hubs`,
      `${AUTH.server}/api/links/import`,
      `${AUTH.server}/api/links/og-backfill`,
    ]);
    for (const r of requests) expect(r.headers.get('authorization')).toBe(`Bearer ${AUTH.token}`);
  });

  it('turns a 401 into AuthRequiredError and forgets the stored token', async () => {
    stubFetch(() => ({ status: 401, body: { error: 'Not authenticated', code: 'unauthenticated' } }));
    await expect(listHubs(AUTH)).rejects.toBeInstanceOf(AuthRequiredError);
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('auth');
    expect(chrome.storage.local.data.auth).toBeUndefined();
  });

  it('keeps the stored token on other failures', async () => {
    stubFetch(() => ({ status: 500, body: { error: 'boom' } }));
    await expect(listHubs(AUTH)).rejects.toThrow('boom');
    expect(chrome.storage.local.data.auth).toBeDefined();
  });

  it.each([
    ['a server error with a message', { status: 500, body: { error: 'boom' } }],
    ['a server error without a body', { status: 502 }],
    ['a 401', { status: 401 }],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('never puts the token in the error for %s', async (_case, reply) => {
    stubFetch(() => reply);
    const err = await saveLink(AUTH, { url: 'https://a.com' }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).not.toContain(AUTH.token);
    expect((err as Error).message).not.toContain(AUTH.token);
  });
});
