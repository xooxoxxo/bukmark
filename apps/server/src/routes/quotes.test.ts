import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { getDb, type Db } from '../db/client.js';
import { authHeaders } from '../test/auth.js';
import { runMigrations } from '../db/migrate.js';
import { links, quotes } from '../db/schema.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';

describe('quotes schema', () => {
  const { db, sql } = getDb(TEST_URL);

  beforeAll(async () => {
    const admin = getDb(TEST_URL.replace(/\/bukmark_test$/, '/bukmark'));
    await admin.sql`CREATE DATABASE bukmark_test`.catch(() => {});
    await admin.sql.end();
    await runMigrations(TEST_URL);
  });
  beforeEach(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, owner, sessions, api_tokens, auth_codes, quotes CASCADE`);
  });
  afterAll(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, owner, sessions, api_tokens, auth_codes, quotes CASCADE`);
    await sql.end();
  });

  async function makeLink() {
    const [l] = await db.insert(links).values({ url: 'https://a.com/x', urlHash: 'h1', title: 'A' }).returning();
    return l!;
  }

  it('inserts a quote with a link and fills search_tsv', async () => {
    const link = await makeLink();
    await db.insert(quotes).values({
      linkId: link.id, text: 'Whales are mammals', textKey: 'whales are mammals',
      note: 'ocean', sourceUrl: 'https://a.com/x', sourceTitle: 'A',
    });
    const hit = await db.execute(
      dsql`SELECT id FROM quotes WHERE search_tsv @@ websearch_to_tsquery('simple','whales')`,
    );
    expect(hit.length).toBe(1);
    const noteHit = await db.execute(
      dsql`SELECT id FROM quotes WHERE search_tsv @@ websearch_to_tsquery('simple','ocean')`,
    );
    expect(noteHit.length).toBe(1);
  });

  it('deleting the link nulls link_id and keeps the source copy', async () => {
    const link = await makeLink();
    const [q] = await db.insert(quotes).values({
      linkId: link.id, text: 'Keep me', textKey: 'keep me',
      sourceUrl: 'https://a.com/x', sourceTitle: 'A',
    }).returning();
    await db.delete(links).where(eq(links.id, link.id));
    const [after] = await db.select().from(quotes).where(eq(quotes.id, q!.id));
    expect(after!.linkId).toBeNull();
    expect(after!.text).toBe('Keep me');
    expect(after!.sourceUrl).toBe('https://a.com/x');
    expect(after!.sourceTitle).toBe('A');
  });

  it('rejects the same text_key twice for one link', async () => {
    const link = await makeLink();
    const row = { linkId: link.id, text: 'Dup', textKey: 'dup', sourceUrl: 'https://a.com/x' };
    await db.insert(quotes).values(row);
    await expect(db.insert(quotes).values(row)).rejects.toThrow();
  });

  it('allows the same text_key twice when link_id is null', async () => {
    const row = { linkId: null, text: 'Orphan', textKey: 'orphan', sourceUrl: 'https://a.com/x' };
    await db.insert(quotes).values(row);
    await db.insert(quotes).values(row);
    const rows = await db.select().from(quotes);
    expect(rows.length).toBe(2);
  });
});

describe('quotes api', () => {
  let app: FastifyInstance; let db: Db; let headers: { Authorization: string };
  const TRUNC = dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, owner, sessions, api_tokens, auth_codes, quotes CASCADE`;

  beforeAll(async () => {
    await runMigrations(TEST_URL);
    const tempDb = getDb(TEST_URL);
    await tempDb.db.execute(TRUNC);
    await tempDb.sql.end();
    app = await buildApp({ databaseUrl: TEST_URL, fetchOgImage: async () => null });
    db = app.db;
    headers = await authHeaders(db);
    return async () => { await db.execute(TRUNC); await app.close(); };
  });
  beforeEach(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, quotes CASCADE`);
  });

  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/quotes', headers, payload });

  it('requires auth on every route', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    for (const [method, url] of [['POST', '/api/quotes'], ['GET', '/api/quotes'], ['PATCH', `/api/quotes/${id}`], ['DELETE', `/api/quotes/${id}`]] as const) {
      const res = await app.inject({ method, url, payload: method === 'GET' || method === 'DELETE' ? undefined : { url: 'https://example.com', text: 'x' } });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('POST creates (201) then returns the same quote (200)', async () => {
    const a = await post({ url: 'https://example.com/a', title: 'A page', text: 'Whales are mammals.', note: 'ocean' });
    expect(a.statusCode).toBe(201);
    expect(a.json().quote).toMatchObject({ text: 'Whales are mammals.', note: 'ocean', sourceTitle: 'A page', sourceUrl: 'https://example.com/a' });
    expect(a.json().link.created).toBe(true);
    const b = await post({ url: 'https://example.com/a', text: '  whales   ARE mammals. ' });
    expect(b.statusCode).toBe(200);
    expect(b.json().quote.id).toBe(a.json().quote.id);
    expect(b.json().link).toEqual({ id: a.json().link.id, created: false });
  });

  it('POST rejects bad input with 400 and a message', async () => {
    for (const payload of [
      { url: 'not a url', text: 'x' },
      { url: 'ftp://example.com/a', text: 'x' },
      { url: 'https://example.com/a', text: '   ' },
      { url: 'https://example.com/a', text: 'x'.repeat(10001) },
      { url: 'https://example.com/a' },
    ]) {
      const res = await post(payload);
      expect(res.statusCode, JSON.stringify(payload).slice(0, 60)).toBe(400);
      expect(typeof res.json().error).toBe('string');
    }
    expect(await db.select().from(quotes)).toHaveLength(0);
  });

  it('GET lists newest first and filters by linkId', async () => {
    const a = await post({ url: 'https://example.com/a', text: 'First.' });
    await post({ url: 'https://example.com/b', text: 'Second.' });
    const all = await app.inject({ method: 'GET', url: '/api/quotes', headers });
    expect(all.statusCode).toBe(200);
    expect(all.json().items.map((q: { text: string }) => q.text)).toEqual(['Second.', 'First.']);
    expect(all.json().nextCursor).toBeNull();
    const one = await app.inject({ method: 'GET', url: `/api/quotes?linkId=${a.json().link.id}`, headers });
    expect(one.json().items.map((q: { text: string }) => q.text)).toEqual(['First.']);
  });

  it('GET searches quote text and note', async () => {
    await post({ url: 'https://example.com/a', text: 'JavaScript tips.' });
    await post({ url: 'https://example.com/b', text: 'Python guide.', note: 'compare with javascript' });
    await post({ url: 'https://example.com/c', text: 'Rust book.' });
    const res = await app.inject({ method: 'GET', url: '/api/quotes?q=javascript', headers });
    expect(res.json().items.map((q: { text: string }) => q.text).sort()).toEqual(['JavaScript tips.', 'Python guide.']);
  });

  const b64 = (v: string) => Buffer.from(v).toString('base64url');
  it('GET validates limit and cursor', async () => {
    for (const url of ['/api/quotes?limit=0', '/api/quotes?limit=101', '/api/quotes?cursor=garbage', `/api/quotes?cursor=${b64('2026-99-99T00:00:00.000000Z|00000000-0000-4000-8000-000000000000')}`, `/api/quotes?cursor=${b64('2026-02-31T00:00:00.000000Z|00000000-0000-4000-8000-000000000000')}`, `/api/quotes?cursor=${b64('2026-01-01T00:00:00.000000Z|zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')}`, '/api/quotes?linkId=nope']) {
      expect((await app.inject({ method: 'GET', url, headers })).statusCode, url).toBe(400);
    }
  });

  it('GET pages return every quote exactly once, same-timestamp rows included', async () => {
    const [link] = await db.insert(links).values({ url: 'https://a.com/x', urlHash: 'h1', title: 'A' }).returning();
    const tied = new Date('2026-01-01T00:00:00.123Z');
    const rows = Array.from({ length: 7 }, (_, i) => ({
      linkId: link!.id, text: `Quote ${i}`, textKey: `quote ${i}`, sourceUrl: 'https://a.com/x',
      createdAt: i < 5 ? tied : new Date(tied.getTime() + (i - 4) * 1000),
    }));
    await db.insert(quotes).values(rows);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: Awaited<ReturnType<typeof app.inject>> = await app.inject({
        method: 'GET', headers, url: `/api/quotes?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      seen.push(...body.items.map((q: { text: string }) => q.text));
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(4);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('PATCH updates text and note', async () => {
    const { quote } = (await post({ url: 'https://example.com/a', text: 'Original.', note: 'Old.' })).json();
    const res = await app.inject({ method: 'PATCH', url: `/api/quotes/${quote.id}`, headers, payload: { text: ' Updated text. ', note: 'New.' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().quote).toMatchObject({ id: quote.id, text: 'Updated text.', note: 'New.' });
    expect(res.json().quote.updatedAt > quote.updatedAt).toBe(true);
    const noteOnly = await app.inject({ method: 'PATCH', url: `/api/quotes/${quote.id}`, headers, payload: { note: '' } });
    expect(noteOnly.json().quote).toMatchObject({ text: 'Updated text.', note: '' });
  });

  it('PATCH rejects an empty body, empty text, and over-long text with 400', async () => {
    const { quote } = (await post({ url: 'https://example.com/a', text: 'Original.' })).json();
    for (const payload of [{}, { text: '  ' }, { text: 'x'.repeat(10001) }]) {
      const res = await app.inject({ method: 'PATCH', url: `/api/quotes/${quote.id}`, headers, payload });
      expect(res.statusCode, JSON.stringify(payload).slice(0, 30)).toBe(400);
    }
  });

  it('PATCH to text another quote of the link has returns 409; same-link self edit is fine', async () => {
    await post({ url: 'https://example.com/a', text: 'First.' });
    const second = (await post({ url: 'https://example.com/a', text: 'Second.' })).json().quote;
    const clash = await app.inject({ method: 'PATCH', url: `/api/quotes/${second.id}`, headers, payload: { text: ' FIRST. ' } });
    expect(clash.statusCode).toBe(409);
    const self = await app.inject({ method: 'PATCH', url: `/api/quotes/${second.id}`, headers, payload: { text: 'SECOND.' } });
    expect(self.statusCode).toBe(200);
  });

  it('PATCH and DELETE of a missing quote return 404', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await app.inject({ method: 'PATCH', url: `/api/quotes/${id}`, headers, payload: { note: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/quotes/${id}`, headers })).statusCode).toBe(404);
  });

  it('DELETE removes the quote (204), then 404', async () => {
    const { quote } = (await post({ url: 'https://example.com/a', text: 'Delete me.' })).json();
    const del = await app.inject({ method: 'DELETE', url: `/api/quotes/${quote.id}`, headers });
    expect(del.statusCode).toBe(204);
    expect(del.body).toBe('');
    expect((await app.inject({ method: 'DELETE', url: `/api/quotes/${quote.id}`, headers })).statusCode).toBe(404);
    expect(await db.select().from(quotes)).toHaveLength(0);
  });

  it('link list and detail carry quoteCount without touching order or paging', async () => {
    const [a, b] = await db.insert(links).values([
      { url: 'https://a.com/a', urlHash: 'qa', title: 'A' },
      { url: 'https://a.com/b', urlHash: 'qb', title: 'B' },
    ]).returning();
    await db.insert(quotes).values([
      { linkId: a!.id, text: 'One', textKey: 'one', sourceUrl: a!.url },
      { linkId: a!.id, text: 'Two', textKey: 'two', sourceUrl: a!.url },
    ]);
    const list = await app.inject({ method: 'GET', url: '/api/links?sort=relevance&limit=1', headers });
    const all = await app.inject({ method: 'GET', url: '/api/links?sort=relevance', headers });
    expect(list.json().total).toBe(2);
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].id).toBe(all.json().items[0].id);
    const counts = Object.fromEntries(all.json().items.map((i: { id: string; quoteCount: number }) => [i.id, i.quoteCount]));
    expect(counts).toEqual({ [a!.id]: 2, [b!.id]: 0 });
    const detail = await app.inject({ method: 'GET', url: `/api/links/${a!.id}`, headers });
    expect(detail.json().quoteCount).toBe(2);
    const none = await app.inject({ method: 'GET', url: `/api/links/${b!.id}`, headers });
    expect(none.json().quoteCount).toBe(0);
  });

  describe('backup: export and import', () => {
    const exp = async (qs = 'format=json&status=all') =>
      JSON.parse((await app.inject({ method: 'GET', url: `/api/export?${qs}`, headers })).body);
    const imp = async (payload: unknown) =>
      app.inject({ method: 'POST', url: '/api/links/import', headers, payload: payload as object });

    async function seedBackup() {
      const a = (await post({ url: 'https://a.com/one', title: 'One', text: 'Older quote.', note: 'n1' })).json();
      await post({ url: 'https://a.com/one', text: 'Newer quote.' });
      const b = (await post({ url: 'https://b.com/two', title: 'Two', text: 'Doomed page quote.', note: 'orph' })).json();
      await db.update(quotes).set({ createdAt: new Date('2026-01-01T10:00:00.000Z') }).where(eq(quotes.text, 'Older quote.'));
      await db.update(quotes).set({ createdAt: new Date('2026-02-01T10:00:00.000Z') }).where(eq(quotes.text, 'Newer quote.'));
      await db.update(quotes).set({ createdAt: new Date('2026-03-01T10:00:00.000Z') }).where(eq(quotes.text, 'Doomed page quote.'));
      await app.inject({ method: 'POST', url: '/api/links/bulk', headers, payload: { ids: [b.link.id], action: 'delete' } });
      return { a, b };
    }

    it('exports each link\'s quotes oldest first and orphans at the top level', async () => {
      await seedBackup();
      const body = await exp();
      expect(body.version).toBe(1);
      const link = body.links.find((l: { url: string }) => l.url === 'https://a.com/one');
      expect(link.quotes).toEqual([
        { text: 'Older quote.', note: 'n1', createdAt: '2026-01-01T10:00:00.000Z' },
        { text: 'Newer quote.', note: '', createdAt: '2026-02-01T10:00:00.000Z' },
      ]);
      expect(body.orphanQuotes).toEqual([
        { text: 'Doomed page quote.', note: 'orph', sourceUrl: 'https://b.com/two', sourceTitle: 'Two', createdAt: '2026-03-01T10:00:00.000Z' },
      ]);
    });

    it('a link without quotes exports an empty list; a filtered export carries no orphans', async () => {
      await seedBackup();
      await app.inject({ method: 'POST', url: '/api/links', headers, payload: { url: 'https://c.com/plain', title: 'Plain' } });
      const full = await exp('format=json');
      expect(full.orphanQuotes).toHaveLength(1);
      expect(full.links.find((l: { url: string }) => l.url === 'https://c.com/plain').quotes).toEqual([]);
      for (const qs of ['format=json&q=One', 'format=json&unassigned=true', 'format=json&status=archived', 'format=json&broken=true']) {
        expect((await exp(qs)).orphanQuotes).toEqual([]);
      }
      const q = await exp('format=json&q=One');
      expect(q.links).toHaveLength(1);
      expect(q.links[0].quotes).toHaveLength(2);
    });

    it('html and csv exports do not mention quotes', async () => {
      await seedBackup();
      for (const format of ['html', 'csv']) {
        const res = await app.inject({ method: 'GET', url: `/api/export?format=${format}&status=all`, headers });
        expect(res.body).not.toContain('Older quote');
        expect(res.body).not.toContain('Doomed page quote');
      }
    });

    it('round trip: export, wipe, import brings back links, quotes and orphans; twice adds nothing', async () => {
      await seedBackup();
      const backup = await exp();
      await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, quotes CASCADE`);
      expect(await db.select().from(quotes)).toHaveLength(0);

      const res = await imp({ items: backup.links, orphanQuotes: backup.orphanQuotes });
      expect(res.statusCode).toBe(200);
      expect(res.json().quotes).toEqual({ added: 3, skipped: 0 });

      const again = await exp();
      expect(again.links.map((l: { url: string; quotes: unknown }) => [l.url, l.quotes]))
        .toEqual(backup.links.map((l: { url: string; quotes: unknown }) => [l.url, l.quotes]));
      expect(again.orphanQuotes).toEqual(backup.orphanQuotes);

      const twice = await imp({ items: backup.links, orphanQuotes: backup.orphanQuotes });
      expect(twice.json().quotes).toEqual({ added: 0, skipped: 3 });
      expect(await db.select().from(quotes)).toHaveLength(3);
    });

    it('attaches quotes to an existing link, with source copy from the link, deduping by text key', async () => {
      const first = (await post({ url: 'https://a.com/one', title: 'One', text: 'Same text.' })).json();
      const res = await imp({ items: [{ url: 'https://a.com/one', title: 'Other', quotes: [
        { text: '  same   TEXT. ' }, { text: 'Fresh one.', note: 'x' }, { text: 'Fresh one.' },
      ] }] });
      expect(res.json().updated).toBe(1);
      expect(res.json().quotes).toEqual({ added: 1, skipped: 2 });
      const rows = await db.select().from(quotes).where(eq(quotes.linkId, first.link.id));
      expect(rows).toHaveLength(2);
      const fresh = rows.find((r) => r.text === 'Fresh one.')!;
      expect(fresh.sourceUrl).toBe('https://a.com/one');
      expect(fresh.sourceTitle).toBe('One');
      expect(fresh.note).toBe('x');
    });

    it('dedupes orphans by source url and text, and validates quote input', async () => {
      const orphan = { text: 'Lonely.', sourceUrl: 'https://gone.com/p', sourceTitle: 'Gone' };
      const ok = await imp({ items: [{ url: 'https://a.com/1' }], orphanQuotes: [orphan, { ...orphan, text: ' LONELY. ' }, { ...orphan, sourceUrl: 'https://gone.com/other' }] });
      expect(ok.json().quotes).toEqual({ added: 2, skipped: 1 });
      const rows = await db.select().from(quotes);
      expect(rows.every((r) => r.linkId === null)).toBe(true);
      expect((await imp({ items: [{ url: 'https://a.com/1' }], orphanQuotes: [orphan] })).json().quotes).toEqual({ added: 0, skipped: 1 });

      expect((await imp({ items: [{ url: 'https://a.com/2', quotes: [{ text: '' }] }] })).statusCode).toBe(400);
      expect((await imp({ items: [{ url: 'https://a.com/2', quotes: [{ text: 'x'.repeat(10001) }] }] })).statusCode).toBe(400);
      expect((await imp({ items: [{ url: 'https://a.com/2' }], orphanQuotes: [{ text: 'no source' }] })).statusCode).toBe(400);
    });

    it('quotes of a link that stays deleted come back as orphans with the item\'s url and title', async () => {
      const made = (await post({ url: 'https://a.com/one', text: 'Kept.' })).json();
      await app.inject({ method: 'POST', url: '/api/links/bulk', headers, payload: { ids: [made.link.id], action: 'delete' } });
      await db.delete(quotes);
      const item = { url: 'https://a.com/one', title: 'One', quotes: [{ text: 'Back.', note: 'n', createdAt: '2026-01-01T00:00:00.000Z' }] };
      const res = await imp({ items: [item] });
      expect(res.json().skippedDeleted).toBe(1);
      expect(res.json().quotes).toEqual({ added: 1, skipped: 0 });
      const rows = await db.select().from(quotes);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ linkId: null, text: 'Back.', note: 'n', sourceUrl: 'https://a.com/one', sourceTitle: 'One' });
      expect(await db.select().from(links)).toHaveLength(0);
      expect((await imp({ items: [item] })).json().quotes).toEqual({ added: 0, skipped: 1 });
    });

    it('imports orphan quotes alone, and rejects a request with nothing in it', async () => {
      const res = await imp({ items: [], orphanQuotes: [{ text: 'Only me.', sourceUrl: 'https://gone.com/p' }] });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ created: 0, updated: 0, skippedDeleted: 0, invalid: [], quotes: { added: 1, skipped: 0 } });
      expect(await db.select().from(links)).toHaveLength(0);
      expect((await imp({ items: [] })).statusCode).toBe(400);
      expect((await imp({ items: [], orphanQuotes: [] })).statusCode).toBe(400);
    });

    it('accepts a body over Fastify\'s 1 MiB default', async () => {
      const big = 'x'.repeat(9000);
      const quotesList = Array.from({ length: 150 }, (_, i) => ({ text: `${i} ${big}` }));
      const payload = { items: [{ url: 'https://a.com/big', quotes: quotesList }] };
      expect(JSON.stringify(payload).length).toBeGreaterThan(1024 * 1024);
      const res = await imp(payload);
      expect(res.statusCode).toBe(200);
      expect(res.json().quotes.added).toBe(150);
    });
  });
});
