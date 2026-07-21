import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { hubLinks, hubs, links } from '../db/schema.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bookmarkt:bookmarkt@localhost:5432/bookmarkt_test';

describe('hubs api', () => {
  let app: FastifyInstance; let db: Db;
  beforeAll(async () => {
    await runMigrations(TEST_URL);
    app = await buildApp({ databaseUrl: TEST_URL });
    db = app.db;
    return async () => { await app.close(); };
  });
  beforeEach(async () => {
    await db.execute(dsql`TRUNCATE links, hubs, hub_links CASCADE`);
  });

  it('CRUD + linkCount ordering', async () => {
    const c1 = await app.inject({ method: 'POST', url: '/api/hubs', payload: { name: 'homelab' } });
    expect(c1.statusCode).toBe(200);
    const dup = await app.inject({ method: 'POST', url: '/api/hubs', payload: { name: 'homelab' } });
    expect(dup.statusCode).toBe(409);
    const c2 = await app.inject({ method: 'POST', url: '/api/hubs', payload: { name: 'empty' } });
    const hubId = c1.json().id;
    const [l] = await db.insert(links).values({ url: 'https://a.com/1', urlHash: 'h1' }).returning();
    await db.insert(hubLinks).values({ hubId, linkId: l!.id });

    const list = await app.inject({ method: 'GET', url: '/api/hubs' });
    const items = list.json().items;
    expect(items[0]).toMatchObject({ name: 'homelab', linkCount: 1 });
    expect(items[1]).toMatchObject({ name: 'empty', linkCount: 0 });

    const patch = await app.inject({
      method: 'PATCH', url: `/api/hubs/${c2.json().id}`, payload: { status: 'archived' },
    });
    expect(patch.json().status).toBe('archived');

    const del = await app.inject({ method: 'DELETE', url: `/api/hubs/${hubId}` });
    expect(del.json()).toEqual({ ok: true });
    const remaining = await db.execute(dsql`SELECT count(*)::int AS n FROM hub_links`);
    expect(remaining[0]!.n).toBe(0);
  });

  it('stats', async () => {
    await db.insert(links).values([
      { url: 'https://a.com/1', urlHash: 'h1' },
      { url: 'https://a.com/2', urlHash: 'h2', status: 'archived' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.json()).toEqual({ links: 2, active: 1, archived: 1, hubs: 0, unassigned: 1 });
  });
});
