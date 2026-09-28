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

describe('GET /api/links/lookup', () => {
  let app: FastifyInstance; let headers: { Authorization: string };
  beforeAll(async () => {
    await runMigrations(TEST_URL);
    const tempDb = await getDb(TEST_URL);
    await tempDb.db.execute(ALL);
    await tempDb.sql.end();
    app = await buildApp({ databaseUrl: TEST_URL, fetchOgImage: async () => null });
    headers = await authHeaders(app.db);
    return async () => { await app.close(); };
  });
  beforeEach(async () => {
    await app.db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs CASCADE`);
  });
  afterAll(async () => { await app.db.execute(ALL); });

  const save = (url: string, hub?: string) =>
    app.inject({ method: 'POST', url: '/api/links', headers, payload: hub ? { url, hub } : { url } });
  const lookup = (url: string) =>
    app.inject({ method: 'GET', url: `/api/links/lookup?url=${encodeURIComponent(url)}`, headers });

  it('knows nothing of a page on a site never saved', async () => {
    const res = await lookup('https://new.example/page');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ saved: null, domain: { host: 'new.example', links: 0, hubs: [] } });
  });

  it('finds a saved page however its URL is written, with its hubs by name', async () => {
    await save('https://github.com/a/b', 'rust');
    await save('https://github.com/a/b', 'reading');
    const res = await lookup('https://WWW.GitHub.com/a/b?utm_source=x');
    const body = res.json();
    expect(body.saved).toMatchObject({ hubs: ['reading', 'rust'] });
    expect(body.domain).toEqual({ host: 'github.com', links: 0, hubs: [] });
  });

  it('says a saved page in no hub is saved with no hubs', async () => {
    await save('https://a.dev/x');
    expect((await lookup('https://a.dev/x')).json().saved).toMatchObject({ hubs: [] });
  });

  it('counts the other active links on the site and names its top hubs', async () => {
    await save('https://github.com/1', 'dev-tools');
    await save('https://github.com/2', 'dev-tools');
    await save('https://www.github.com/3', 'rust');
    await save('https://github.com/4');
    await save('https://gist.github.com/5', 'rust');
    await save('https://notgithub.com/6', 'rust');
    const body = (await lookup('https://github.com/new')).json();
    expect(body.saved).toBeNull();
    expect(body.domain).toEqual({
      host: 'github.com',
      links: 4,
      hubs: [{ name: 'dev-tools', links: 2 }, { name: 'rust', links: 1 }],
    });
  });

  it('leaves archived links out of the site count', async () => {
    await save('https://a.dev/1', 'x');
    await app.db.execute(dsql`UPDATE links SET status = 'archived'`);
    expect((await lookup('https://a.dev/2')).json().domain).toEqual({ host: 'a.dev', links: 0, hubs: [] });
  });

  it('refuses a URL it cannot read', async () => {
    const res = await lookup('not a url');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/url/);
  });

  it('needs a login', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/links/lookup?url=https%3A%2F%2Fa.dev%2F' });
    expect(res.statusCode).toBe(401);
  });
});
