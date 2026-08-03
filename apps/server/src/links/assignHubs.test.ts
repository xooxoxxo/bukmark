import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql as dsql } from 'drizzle-orm';
import { getDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { hubLinks, hubs, links } from '../db/schema.js';
import { importLinks } from './importLinks.js';
import { assignHubs } from './assignHubs.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';

async function seedIds(db: Db, n: number): Promise<string[]> {
  await importLinks(db, Array.from({ length: n }, (_, i) => ({ url: `https://s.com/${i}` })));
  const rows = await db.select({ id: links.id }).from(links).orderBy(links.url);
  return rows.map((r) => r.id);
}

describe('assignHubs', () => {
  let db: Db; let end: () => Promise<void>;
  beforeAll(async () => {
    await runMigrations(TEST_URL);
    const h = await getDb(TEST_URL);
    db = h.db; end = () => h.sql.end();
  });
  beforeEach(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes CASCADE`);
  });
  afterAll(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes CASCADE`);
    await end();
  });

  it('creates hubs by name and assigns each link to its own hub', async () => {
    const [a, b] = await seedIds(db, 2);
    const res = await assignHubs(db, [
      { linkId: a!, hub: 'rust', relevance: 5 },
      { linkId: b!, hub: 'homelab', relevance: 3 },
    ]);
    expect(res.assigned).toBe(2);
    expect(res.hubsCreated.sort()).toEqual(['homelab', 'rust']);
    expect(res.unknownLinkIds).toEqual([]);
    expect(await db.select().from(hubs)).toHaveLength(2);
  });

  it('reuses an existing hub instead of creating a duplicate', async () => {
    const [a, b] = await seedIds(db, 2);
    await assignHubs(db, [{ linkId: a!, hub: 'rust' }]);
    const res = await assignHubs(db, [{ linkId: b!, hub: 'rust' }]);
    expect(res.hubsCreated).toEqual([]);
    expect(await db.select().from(hubs)).toHaveLength(1);
  });

  it('marks assignments as auto so Claude filing is distinguishable from yours', async () => {
    const [a] = await seedIds(db, 1);
    await assignHubs(db, [{ linkId: a!, hub: 'rust' }]);
    const [row] = await db.select().from(hubLinks);
    expect(row!.assignedBy).toBe('auto');
  });

  it('is idempotent and updates relevance on re-assignment', async () => {
    const [a] = await seedIds(db, 1);
    await assignHubs(db, [{ linkId: a!, hub: 'rust', relevance: 2 }]);
    const res = await assignHubs(db, [{ linkId: a!, hub: 'rust', relevance: 5 }]);
    expect(res.assigned).toBe(1);
    const rows = await db.select().from(hubLinks);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relevance).toBe(5);
  });

  it('reports unknown link ids without failing the whole batch', async () => {
    const [a] = await seedIds(db, 1);
    const ghost = '00000000-0000-0000-0000-000000000000';
    const res = await assignHubs(db, [
      { linkId: a!, hub: 'rust' },
      { linkId: ghost, hub: 'rust' },
    ]);
    expect(res.assigned).toBe(1);
    expect(res.unknownLinkIds).toEqual([ghost]);
  });

  it('assigns one link to several hubs', async () => {
    const [a] = await seedIds(db, 1);
    await assignHubs(db, [
      { linkId: a!, hub: 'rust' },
      { linkId: a!, hub: 'homelab' },
    ]);
    const rows = await db.select().from(hubLinks).where(eq(hubLinks.linkId, a!));
    expect(rows).toHaveLength(2);
  });

  it('returns an empty result for an empty batch', async () => {
    const res = await assignHubs(db, []);
    expect(res).toEqual({ assigned: 0, hubsCreated: [], unknownLinkIds: [] });
  });

  it('updates assignedBy from user to auto on re-assignment', async () => {
    const [a] = await seedIds(db, 1);
    // Create a hub manually
    const [hub] = await db.insert(hubs).values({ name: 'rust' }).returning({ id: hubs.id });
    // Insert a hub_links row marked as user-filed
    await db
      .insert(hubLinks)
      .values({ hubId: hub!.id, linkId: a!, assignedBy: 'user' as const, relevance: 2 });

    // Re-assign through assignHubs
    const res = await assignHubs(db, [{ linkId: a!, hub: 'rust', relevance: 5 }]);

    expect(res.assigned).toBe(1);
    const rows = await db.select().from(hubLinks).where(eq(hubLinks.linkId, a!));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assignedBy).toBe('auto');
    expect(rows[0]!.relevance).toBe(5);
  });

  it('stores null for relevance when omitted', async () => {
    const [a] = await seedIds(db, 1);
    await assignHubs(db, [{ linkId: a!, hub: 'rust' }]);
    const [row] = await db.select().from(hubLinks);
    expect(row!.relevance).toBeNull();
  });
});
