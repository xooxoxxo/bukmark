import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { getDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { hubLinks, hubs, links } from '../db/schema.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bookmarkt:bookmarkt@localhost:5432/bookmarkt_test';

describe('links api', () => {
  let app: FastifyInstance; let db: Db;
  beforeAll(async () => {
    await runMigrations(TEST_URL);
    const tempDb = await getDb(TEST_URL);
    await tempDb.db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, import_jobs CASCADE`);
    await tempDb.sql.end();
    app = await buildApp({ databaseUrl: TEST_URL });
    db = app.db;
    return async () => { await app.close(); };
  });
  beforeEach(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links CASCADE`);
  });
  afterAll(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, import_jobs CASCADE`);
  });

  async function seed() {
    const [h] = await db.insert(hubs).values({ name: 'homelab' }).returning();
    const [l1] = await db.insert(links).values({
      url: 'https://a.com/tailscale', urlHash: 'h1', title: 'Tailscale Docs', relevance: 5,
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

  it('lists active links with hubIds, total', async () => {
    const { hubId } = await seed();
    const res = await app.inject({ method: 'GET', url: '/api/links' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items[0].title).toBe('Tailscale Docs');
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
});
