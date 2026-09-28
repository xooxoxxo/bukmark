import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { getDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { authHeaders } from '../test/auth.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';

describe('export api', () => {
  let app: FastifyInstance; let db: Db; let headers: { Authorization: string };

  beforeAll(async () => {
    await runMigrations(TEST_URL);
    const tempDb = await getDb(TEST_URL);
    await tempDb.db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, owner, sessions, api_tokens, auth_codes CASCADE`);
    await tempDb.sql.end();
    app = await buildApp({ databaseUrl: TEST_URL, fetchOgImage: async () => null });
    db = app.db;
    headers = await authHeaders(db);
    return async () => { await app.close(); };
  });

  beforeEach(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes CASCADE`);
  });

  async function seedWithAuth() {
    const headers = await authHeaders(db);
    return { headers };
  }

  afterAll(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, owner, sessions, api_tokens, auth_codes CASCADE`);
  });

  async function seed(): Promise<void> {
    await app.inject({ method: 'POST', url: '/api/links', headers, payload: { url: 'https://rust-lang.org', title: 'Rust', note: 'the book', hub: 'rust', relevance: 5 },
    });
    await app.inject({ method: 'POST', url: '/api/links', headers, payload: { url: 'https://fastify.dev', title: 'Fastify', hub: 'web' },
    });
    await app.inject({ method: 'POST', url: '/api/links', headers, payload: { url: 'https://loose.example.com', title: 'Loose' },
    });
  }

  it('rejects an unknown format with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/export?format=pdf', headers });
    expect(res.statusCode).toBe(400);
  });

  it('requires a format', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/export', headers });
    expect(res.statusCode).toBe(400);
  });

  it('exports every active link as json', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/export?format=json', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(1);
    expect(body.count).toBe(3);
    expect(body.links.map((l: { url: string }) => l.url).sort()).toEqual([
      'https://fastify.dev/', 'https://loose.example.com/', 'https://rust-lang.org/',
    ]);
  });

  it('carries hub names, not ids', async () => {
    await seed();
    const body = (await app.inject({ method: 'GET', url: '/api/export?format=json', headers })).json();
    const rust = body.links.find((l: { url: string }) => l.url === 'https://rust-lang.org/');
    expect(rust.hubs).toEqual(['rust']);
  });

  it('filters by hub', async () => {
    await seed();
    const hubs = (await app.inject({ method: 'GET', url: '/api/hubs', headers })).json();
    const rustHub = hubs.items.find((h: { name: string }) => h.name === 'rust');
    const body = (await app.inject({ method: 'GET', url: `/api/export?format=json&hub=${rustHub.id}`, headers })).json();
    expect(body.count).toBe(1);
    expect(body.links[0].url).toBe('https://rust-lang.org/');
  });

  it('filters to broken links, and names the file after them', async () => {
    await seed();
    await db.execute(dsql`UPDATE links SET http_status = 404 WHERE url = 'https://fastify.dev/'`);
    const res = await app.inject({ method: 'GET', url: '/api/export?format=json&broken=true', headers });
    expect(res.json().count).toBe(1);
    expect(res.json().links[0].url).toBe('https://fastify.dev/');
    expect(res.headers['content-disposition']).toMatch(/broken/);
  });

  it('filters to unassigned', async () => {
    await seed();
    const body = (await app.inject({ method: 'GET', url: '/api/export?format=json&unassigned=true', headers })).json();
    expect(body.count).toBe(1);
    expect(body.links[0].url).toBe('https://loose.example.com/');
  });

  it('honours the search filter', async () => {
    await seed();
    const body = (await app.inject({ method: 'GET', url: '/api/export?format=json&q=Rust', headers })).json();
    expect(body.count).toBe(1);
    expect(body.links[0].url).toBe('https://rust-lang.org/');
  });

  it('excludes archived links by default', async () => {
    await seed();
    const all = (await app.inject({ method: 'GET', url: '/api/export?format=json', headers })).json();
    const id = (await app.inject({ method: 'GET', url: '/api/links', headers })).json().items[0].id;
    await app.inject({ method: 'POST', url: '/api/links/bulk', headers, payload: { ids: [id], action: 'archive' } });
    const after = (await app.inject({ method: 'GET', url: '/api/export?format=json', headers })).json();
    expect(after.count).toBe(all.count - 1);
  });

  it('status=all includes archived links, so a backup is actually complete', async () => {
    await seed();
    const id = (await app.inject({ method: 'GET', url: '/api/links', headers })).json().items[0].id;
    await app.inject({ method: 'POST', url: '/api/links/bulk', headers, payload: { ids: [id], action: 'archive' } });
    const body = (await app.inject({ method: 'GET', url: '/api/export?format=json&status=all', headers })).json();
    expect(body.count).toBe(3);
  });

  it('returns more than the 200-row page cap GET /links enforces', async () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ url: `https://bulk.example.com/${i}` }));
    for (let i = 0; i < items.length; i += 200) {
      await app.inject({ method: 'POST', url: '/api/links/import', headers, payload: { items: items.slice(i, i + 200) },
      });
    }
    const body = (await app.inject({ method: 'GET', url: '/api/export?format=json', headers })).json();
    expect(body.count).toBe(250);
  });

  it('exports html with the netscape doctype and the right content type', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/export?format=html', headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(res.body).toContain('<H3>rust</H3>');
    // Hub folders sit inside the one bukmark folder.
    expect(res.body.indexOf('<DT><H3>bukmark</H3>')).toBeGreaterThan(-1);
    expect(res.body.indexOf('<DT><H3>bukmark</H3>')).toBeLessThan(res.body.indexOf('<H3>rust</H3>'));
  });

  it('exports csv with the header row and the right content type', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/export?format=csv', headers });
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.split('\n')[0]).toBe('url,title,note,hubs,relevance,status,dupeCount,firstSeen');
  });

  it('sets an attachment filename scoped to "all" when unfiltered', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/export?format=json', headers });
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="bukmark-all-\d{4}-\d{2}-\d{2}\.json"/,
    );
  });

  it('names the file after the hub when filtering by one', async () => {
    await seed();
    const hubs = (await app.inject({ method: 'GET', url: '/api/hubs', headers })).json();
    const rustHub = hubs.items.find((h: { name: string }) => h.name === 'rust');
    const res = await app.inject({ method: 'GET', url: `/api/export?format=html&hub=${rustHub.id}`, headers });
    expect(res.headers['content-disposition']).toContain('bukmark-rust-');
  });

  it('names the file "unsorted" when filtering to unassigned', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/export?format=csv&unassigned=true', headers });
    expect(res.headers['content-disposition']).toContain('bukmark-unsorted-');
  });
});

