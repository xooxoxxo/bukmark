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

  it('GET validates limit and cursor', async () => {
    for (const url of ['/api/quotes?limit=0', '/api/quotes?limit=101', '/api/quotes?cursor=garbage', '/api/quotes?linkId=nope']) {
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
});
