import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { links } from '../db/schema.js';
import { authHeaders } from '../test/auth.js';
import type { PageFetch } from './fetchHead.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const ALL = dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, owner, sessions, api_tokens, auth_codes, quotes CASCADE`;

/** What each URL answers, by path; anything else is a page about its own path. */
let pages: Record<string, PageFetch> = {};
const seen: string[] = [];
const page = (html: string, status = 200): PageFetch => ({ status, error: null, html, url: '' });

describe('link checks', () => {
  let app: FastifyInstance; let headers: { Authorization: string };
  beforeAll(async () => {
    await runMigrations(TEST_URL);
    const temp = await getDb(TEST_URL);
    await temp.db.execute(ALL);
    await temp.sql.end();
    app = await buildApp({
      databaseUrl: TEST_URL,
      fetchOgImage: async () => null,
      checkPage: async (url) => {
        seen.push(url);
        return pages[new URL(url).pathname] ?? page(`<body><p>About ${new URL(url).pathname}</p></body>`);
      },
    });
    headers = await authHeaders(app.db);
    return async () => { await app.close(); };
  });
  beforeEach(async () => {
    pages = {};
    seen.length = 0;
    await app.db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, quotes CASCADE`);
  });
  afterAll(async () => { await app.db.execute(ALL); });

  const save = (url: string, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/api/links', headers, payload: { url, ...extra } });
  const check = (limit = 20) =>
    app.inject({ method: 'POST', url: '/api/links/check', headers, payload: { limit } });
  const list = (query: string) => app.inject({ method: 'GET', url: `/api/links?${query}`, headers });
  const row = async (url: string) => (await app.db.select().from(links).where(eq(links.url, url)))[0]!;

  it('keeps each page’s text and status, and reports what is left', async () => {
    await save('https://a.dev/one');
    await save('https://a.dev/two');
    pages['/one'] = page('<html><head><meta property="og:image" content="/i.png"></head><body><article><p>Borrow checker explained.</p></article></body></html>');
    const res = await check(1);
    expect(res.json()).toEqual({ processed: 1, remaining: 1 });
    const one = await row('https://a.dev/one');
    expect(one.contentText).toBe('Borrow checker explained.');
    expect(one.httpStatus).toBe(200);
    expect(one.checkError).toBeNull();
    expect(one.checkedAt).toBeInstanceOf(Date);
    expect(one.imageUrl).toBe('https://a.dev/i.png');
    expect((await check()).json()).toEqual({ processed: 1, remaining: 0 });
  });

  it('checks each link once until the re-check is due', async () => {
    await save('https://a.dev/one');
    await check();
    await check();
    expect(seen).toEqual(['https://a.dev/one']);
    await app.db.execute(dsql`UPDATE links SET checked_at = now() - interval '31 days'`);
    await check();
    expect(seen).toEqual(['https://a.dev/one', 'https://a.dev/one']);
  });

  it('keeps the text an earlier check saved when the page has since gone', async () => {
    await save('https://a.dev/gone');
    pages['/gone'] = page('<p>What it used to say.</p>');
    await check();
    await app.db.execute(dsql`UPDATE links SET checked_at = now() - interval '31 days'`);
    pages['/gone'] = { status: 404, error: null, html: null, url: '' };
    await check();
    const gone = await row('https://a.dev/gone');
    expect(gone.httpStatus).toBe(404);
    expect(gone.contentText).toBe('What it used to say.');
  });

  it('finds a search word in the page’s text and shows the words around it', async () => {
    await save('https://a.dev/rust', { title: 'Some post' });
    await save('https://a.dev/other', { title: 'Other post' });
    pages['/rust'] = page(`<p>${'Filler words here. '.repeat(10)}The lifetime elision rules make most annotations unnecessary. ${'More filler. '.repeat(10)}</p>`);
    await check();
    const body = (await list('q=elision')).json();
    expect(body.items.map((i: { url: string }) => i.url)).toEqual(['https://a.dev/rust']);
    expect(body.items[0].snippet).toContain('⸢elision⸣');
  });

  it('gives no snippet when the match is in the title', async () => {
    await save('https://a.dev/x', { title: 'Elision explained' });
    await check();
    const [item] = (await list('q=elision')).json().items;
    expect(item.snippet).toBeNull();
  });

  it('lists as broken only pages that are gone: 404, 410 and dead domains', async () => {
    const answers: Record<string, PageFetch> = {
      '/ok': page('<p>fine</p>'),
      '/404': { status: 404, error: null, html: null, url: '' },
      '/410': { status: 410, error: null, html: null, url: '' },
      '/403': { status: 403, error: null, html: null, url: '' },
      '/500': { status: 500, error: null, html: null, url: '' },
      '/dns': { status: null, error: 'dns', html: null, url: '' },
      '/timeout': { status: null, error: 'timeout', html: null, url: '' },
      '/blocked': { status: null, error: 'blocked', html: null, url: '' },
    };
    pages = answers;
    for (const path of Object.keys(answers)) await save(`https://a.dev${path}`);
    await check(50);
    const broken = (await list('broken=true&sort=title')).json();
    expect(broken.items.map((i: { url: string }) => new URL(i.url).pathname)).toEqual(['/404', '/410', '/dns']);
    expect(broken.items.every((i: { broken: boolean }) => i.broken)).toBe(true);
    const stats = (await app.inject({ method: 'GET', url: '/api/stats', headers })).json();
    expect(stats).toMatchObject({ broken: 3, unchecked: 0 });
  });

  it('never checks archived links', async () => {
    await save('https://a.dev/kept');
    await app.db.execute(dsql`UPDATE links SET status = 'archived'`);
    expect((await check()).json()).toEqual({ processed: 0, remaining: 0 });
    expect(seen).toEqual([]);
  });

  it('needs a login', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/links/check', payload: {} })).statusCode).toBe(401);
  });
});
