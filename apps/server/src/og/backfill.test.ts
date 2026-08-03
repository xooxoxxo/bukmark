import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isNull, sql as dsql } from 'drizzle-orm';
import { getDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { links } from '../db/schema.js';
import { importLinks } from '../links/importLinks.js';
import { backfillOg } from './backfill.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';

async function seed(db: Db, n: number): Promise<void> {
  await importLinks(db, Array.from({ length: n }, (_, i) => ({ url: `https://seed.com/${i}` })));
}

describe('backfillOg', () => {
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

  it('processes up to limit and reports what is left', async () => {
    await seed(db, 5);
    const res = await backfillOg(db, async () => 'https://cdn/og.png', 2);
    expect(res).toEqual({ processed: 2, remaining: 3 });
  });

  it('stores the fetched image', async () => {
    await seed(db, 1);
    await backfillOg(db, async () => 'https://cdn/og.png', 10);
    const [row] = await db.select().from(links);
    expect(row!.imageUrl).toBe('https://cdn/og.png');
    expect(row!.ogFetchedAt).not.toBeNull();
  });

  it('marks ogFetchedAt even when the page has no og image', async () => {
    await seed(db, 1);
    await backfillOg(db, async () => null, 10);
    const [row] = await db.select().from(links);
    expect(row!.imageUrl).toBeNull();
    expect(row!.ogFetchedAt).not.toBeNull();
  });

  it('marks ogFetchedAt even when the fetch throws, so failures do not requeue forever', async () => {
    await seed(db, 1);
    const res = await backfillOg(db, async () => { throw new Error('ECONNREFUSED'); }, 10);
    expect(res).toEqual({ processed: 1, remaining: 0 });
    const stuck = await db.select().from(links).where(isNull(links.ogFetchedAt));
    expect(stuck).toHaveLength(0);
  });

  it('drains to zero over repeated calls and then does nothing', async () => {
    await seed(db, 5);
    let guard = 0;
    let remaining = Number.MAX_SAFE_INTEGER;
    while (remaining > 0 && guard++ < 10) {
      ({ remaining } = await backfillOg(db, async () => null, 2));
    }
    expect(remaining).toBe(0);
    const idle = await backfillOg(db, async () => null, 2);
    expect(idle).toEqual({ processed: 0, remaining: 0 });
  });

  it('fetches concurrently rather than one at a time', async () => {
    await seed(db, 8);
    let inFlight = 0; let peak = 0;
    await backfillOg(db, async () => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return null;
    }, 8, 4);
    expect(peak).toBe(4);
  });
});
