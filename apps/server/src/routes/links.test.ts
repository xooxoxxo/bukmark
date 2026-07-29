import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { getDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { deletedHashes, hubLinks, hubs, links } from '../db/schema.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bookmarkt:bookmarkt@localhost:5432/bookmarkt_test';

let ogStub: string | null = null;

describe('links api', () => {
  let app: FastifyInstance; let db: Db;
  beforeAll(async () => {
    await runMigrations(TEST_URL);
    const tempDb = await getDb(TEST_URL);
    await tempDb.db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs CASCADE`);
    await tempDb.sql.end();
    app = await buildApp({ databaseUrl: TEST_URL, fetchOgImage: async () => ogStub });
    db = app.db;
    return async () => { await app.close(); };
  });
  beforeEach(async () => {
    ogStub = null;
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes CASCADE`);
  });
  afterAll(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs CASCADE`);
  });

  async function seed() {
    const [h] = await db.insert(hubs).values({ name: 'homelab' }).returning();
    const [l1] = await db.insert(links).values({
      url: 'https://a.com/tailscale', urlHash: 'h1', title: 'Tailscale Docs', relevance: 5, dupeCount: 3,
    }).returning();
    const [l2] = await db.insert(links).values({
      url: 'https://a.com/2', urlHash: 'h2', title: 'Unsorted thing',
    }).returning();
    await db.insert(links).values({
      url: 'https://a.com/3', urlHash: 'h3', title: 'Archived', status: 'archived',
    });
    await db.insert(hubLinks).values({ hubId: h!.id, linkId: l1!.id, assignedBy: 'auto' });
    return { hubId: h!.id, l1: l1!.id, l2: l2!.id };
  }

  it('lists active links with hubIds, total, dupeCount', async () => {
    const { hubId } = await seed();
    const res = await app.inject({ method: 'GET', url: '/api/links' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items[0].title).toBe('Tailscale Docs');
    expect(body.items[0].dupeCount).toBe(3);
    expect(body.items[0].imageUrl).toBeNull();
    expect(body.items[0].hubIds).toEqual([hubId]);
  });

  it('FTS search via q', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/links?q=tailscale' });
    expect(res.json().items.map((i: { title: string }) => i.title)).toEqual(['Tailscale Docs']);
  });

  it('unassigned filter', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/links?unassigned=true' });
    expect(res.json().items.map((i: { title: string }) => i.title)).toEqual(['Unsorted thing']);
  });

  it('hub filter', async () => {
    const { hubId } = await seed();
    const res = await app.inject({ method: 'GET', url: `/api/links?hub=${hubId}` });
    expect(res.json().total).toBe(1);
  });

  it('PATCH updates note, 404 on unknown', async () => {
    const { l1 } = await seed();
    const ok = await app.inject({ method: 'PATCH', url: `/api/links/${l1}`, payload: { note: 'n' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().note).toBe('n');
    const miss = await app.inject({
      method: 'PATCH', url: '/api/links/00000000-0000-0000-0000-000000000000', payload: { note: 'x' },
    });
    expect(miss.statusCode).toBe(404);
  });

  it('bulk archive + bulk assign', async () => {
    const { hubId, l2 } = await seed();
    const a = await app.inject({
      method: 'POST', url: '/api/links/bulk', payload: { ids: [l2], action: 'assign', hubId },
    });
    expect(a.json()).toEqual({ affected: 1 });
    const b = await app.inject({
      method: 'POST', url: '/api/links/bulk', payload: { ids: [l2], action: 'archive' },
    });
    expect(b.json()).toEqual({ affected: 1 });
    const missingHub = await app.inject({
      method: 'POST', url: '/api/links/bulk', payload: { ids: [l2], action: 'assign' },
    });
    expect(missingHub.statusCode).toBe(400);
  });

  it('bulk delete removes links + memberships and tombstones hashes', async () => {
    const { l1, l2 } = await seed();
    const res = await app.inject({
      method: 'POST', url: '/api/links/bulk', payload: { ids: [l1, l2], action: 'delete' },
    });
    expect(res.json()).toEqual({ affected: 2 });
    const remaining = await app.inject({ method: 'GET', url: '/api/links' });
    expect(remaining.json().total).toBe(0);
    const tombs = await db.select({ urlHash: deletedHashes.urlHash }).from(deletedHashes);
    expect(tombs.map((t) => t.urlHash).sort()).toEqual(['h1', 'h2']);
    const memberships = await db.select().from(hubLinks);
    expect(memberships).toEqual([]);
  });

  it('POST creates a new link with capture, hub membership, og image', async () => {
    const { hubId: _hubId } = await seed();
    ogStub = 'https://cdn.example.com/og.png';
    const res = await app.inject({
      method: 'POST', url: '/api/links',
      payload: { url: 'https://New.Example.com/a?utm_source=x', title: 'New A', note: 'keep', hub: 'reading', relevance: 4 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome).toBe('created');
    expect(body.link.url).toBe('https://new.example.com/a');
    expect(body.link.title).toBe('New A');
    expect(body.link.relevance).toBe(4);
    expect(body.link.imageUrl).toBe('https://cdn.example.com/og.png');
    expect(body.link.hubIds).toHaveLength(1);
    const caps = await db.execute(dsql`SELECT source FROM captures WHERE original_url = 'https://new.example.com/a'`);
    expect(caps[0]!.source).toBe('manual');
  });

  it('POST on an existing url updates provided fields and bumps dupeCount', async () => {
    const first = await app.inject({
      method: 'POST', url: '/api/links', payload: { url: 'https://fresh.example.com/x', title: 'First', relevance: 2 },
    });
    expect(first.json().outcome).toBe('created');
    const second = await app.inject({
      method: 'POST', url: '/api/links', payload: { url: 'https://fresh.example.com/x', note: 'added note' },
    });
    const b = second.json();
    expect(b.outcome).toBe('updated');
    expect(b.link.title).toBe('First');      // unprovided → unchanged
    expect(b.link.note).toBe('added note');   // provided → updated
    expect(b.link.relevance).toBe(2);         // unprovided → unchanged
    expect(b.link.dupeCount).toBe(2);         // bumped
  });

  it('POST resurrects a tombstoned url and clears the tombstone', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/links', payload: { url: 'https://tomb.example.com/y' },
    });
    const id = created.json().link.id;
    await app.inject({ method: 'POST', url: '/api/links/bulk', payload: { ids: [id], action: 'delete' } });
    const again = await app.inject({
      method: 'POST', url: '/api/links', payload: { url: 'https://tomb.example.com/y', title: 'Back' },
    });
    expect(again.json().outcome).toBe('resurrected');
    const tombs = await db.select({ urlHash: deletedHashes.urlHash }).from(deletedHashes);
    expect(tombs).toEqual([]);
  });

  it('POST rejects an unparseable url with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/links', payload: { url: 'not a url' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/url/);
  });

  it('POST /api/links/import creates unsorted links without fetching og', async () => {
    ogStub = 'https://cdn.example.com/should-not-be-used.png';
    const res = await app.inject({
      method: 'POST',
      url: '/api/links/import',
      payload: { items: [{ url: 'https://imported.com/1', title: 'Imported', folderPath: 'Bar/Dev' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, updated: 0, skippedDeleted: 0, invalid: [] });

    const listed = await app.inject({ method: 'GET', url: '/api/links?unassigned=true' });
    const item = listed.json().items[0];
    expect(item.hubIds).toEqual([]);
    expect(item.imageUrl).toBeNull();
  });

  it('POST /api/links/import rejects a batch over 200 items', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ url: `https://big.com/${i}` }));
    const res = await app.inject({ method: 'POST', url: '/api/links/import', payload: { items } });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/links returns the imported folder path as groupHint', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/links/import',
      payload: { items: [{ url: 'https://hinted.com/1', folderPath: 'Bookmarks Bar/Dev/Rust' }] },
    });
    const res = await app.inject({ method: 'GET', url: '/api/links?unassigned=true' });
    expect(res.json().items[0].groupHint).toBe('Bookmarks Bar/Dev/Rust');
  });

  it('GET /api/links returns null groupHint for links captured without one', async () => {
    await app.inject({ method: 'POST', url: '/api/links', payload: { url: 'https://plain.com/1' } });
    const res = await app.inject({ method: 'GET', url: '/api/links?unassigned=true' });
    expect(res.json().items[0].groupHint).toBeNull();
  });
});
