import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { authHeaders } from '../test/auth.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const ALL = dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, owner, sessions, api_tokens, auth_codes CASCADE`;

describe('one link, sorting and editing', () => {
  let app: FastifyInstance; let headers: { Authorization: string };
  beforeAll(async () => {
    await runMigrations(TEST_URL);
    const temp = await getDb(TEST_URL);
    await temp.db.execute(ALL);
    await temp.sql.end();
    app = await buildApp({
      databaseUrl: TEST_URL,
      fetchOgImage: async () => null,
      checkPage: async () => ({ status: 200, error: null, html: '<p>The saved words.</p>', url: '' }),
    });
    headers = await authHeaders(app.db);
    return async () => { await app.close(); };
  });
  beforeEach(async () => {
    await app.db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs CASCADE`);
  });
  afterAll(async () => { await app.db.execute(ALL); });

  const save = async (url: string, extra: Record<string, unknown> = {}) =>
    (await app.inject({ method: 'POST', url: '/api/links', headers, payload: { url, ...extra } })).json().link.id as string;
  const urls = async (sort: string) =>
    (await app.inject({ method: 'GET', url: `/api/links?sort=${sort}`, headers })).json().items.map((i: { url: string }) => i.url);

  it('returns one link with its saved text, check and hubs', async () => {
    const id = await save('https://a.dev/x', { title: 'X', hub: 'rust' });
    await app.inject({ method: 'POST', url: '/api/links/check', headers, payload: {} });
    const res = await app.inject({ method: 'GET', url: `/api/links/${id}`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id, url: 'https://a.dev/x', title: 'X', contentText: 'The saved words.',
      httpStatus: 200, checkError: null, broken: false,
    });
    expect(res.json().hubIds).toHaveLength(1);
    expect(typeof res.json().checkedAt).toBe('string');
  });

  it('answers 404 for a link that does not exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/links/00000000-0000-0000-0000-000000000000', headers });
    expect(res.statusCode).toBe(404);
  });

  it('sorts newest, oldest, by title and by relevance', async () => {
    await save('https://a.dev/1', { title: 'banana', relevance: 2 });
    await app.db.execute(dsql`UPDATE links SET first_seen = now() - interval '2 days'`);
    await save('https://a.dev/2', { title: 'Apple', relevance: 5 });
    await app.db.execute(dsql`UPDATE links SET first_seen = now() - interval '1 day' WHERE url = 'https://a.dev/2'`);
    await save('https://a.dev/3', { title: '' });
    expect(await urls('newest')).toEqual(['https://a.dev/3', 'https://a.dev/2', 'https://a.dev/1']);
    expect(await urls('oldest')).toEqual(['https://a.dev/1', 'https://a.dev/2', 'https://a.dev/3']);
    expect(await urls('title')).toEqual(['https://a.dev/2', 'https://a.dev/1', 'https://a.dev/3']);
    expect(await urls('relevance')).toEqual(['https://a.dev/2', 'https://a.dev/1', 'https://a.dev/3']);
  });

  it('refuses a sort it does not know', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/links?sort=random', headers })).statusCode).toBe(400);
  });

  it('sets and clears relevance', async () => {
    const id = await save('https://a.dev/r');
    const set = await app.inject({ method: 'PATCH', url: `/api/links/${id}`, headers, payload: { relevance: 4 } });
    expect(set.json().relevance).toBe(4);
    const cleared = await app.inject({ method: 'PATCH', url: `/api/links/${id}`, headers, payload: { relevance: null } });
    expect(cleared.json().relevance).toBeNull();
    expect((await app.inject({ method: 'PATCH', url: `/api/links/${id}`, headers, payload: { relevance: 9 } })).statusCode).toBe(400);
  });
});
