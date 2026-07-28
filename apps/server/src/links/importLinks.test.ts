import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql as dsql } from 'drizzle-orm';
import { getDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { captures, deletedHashes, links } from '../db/schema.js';
import { importLinks } from './importLinks.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bookmarkt:bookmarkt@localhost:5432/bookmarkt_test';

describe('importLinks', () => {
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

  it('creates links and records the folder path as a capture group hint', async () => {
    const res = await importLinks(db, [
      { url: 'https://a.com/1', title: 'Alpha', folderPath: 'Bookmarks Bar/Dev/Rust' },
    ]);
    expect(res.created).toBe(1);
    expect(res.updated).toBe(0);

    const [row] = await db.select().from(links);
    expect(row!.title).toBe('Alpha');
    expect(row!.imageUrl).toBeNull();
    expect(row!.ogFetchedAt).toBeNull();

    const [cap] = await db.select().from(captures).where(eq(captures.linkId, row!.id));
    expect(cap!.groupHint).toBe('Bookmarks Bar/Dev/Rust');
    expect(cap!.source).toBe('browser-import');
  });

  it('re-importing does not inflate dupeCount', async () => {
    await importLinks(db, [{ url: 'https://a.com/1', title: 'Alpha' }]);
    const res = await importLinks(db, [{ url: 'https://a.com/1', title: 'Alpha' }]);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(1);
    const [row] = await db.select().from(links);
    expect(row!.dupeCount).toBe(1);
  });

  it('does not clobber a title that was already curated', async () => {
    await importLinks(db, [{ url: 'https://a.com/1', title: 'Original' }]);
    await importLinks(db, [{ url: 'https://a.com/1', title: 'Chrome Says Something Else' }]);
    const [row] = await db.select().from(links);
    expect(row!.title).toBe('Original');
  });

  it('fills in an empty title on re-import', async () => {
    await importLinks(db, [{ url: 'https://a.com/1' }]);
    await importLinks(db, [{ url: 'https://a.com/1', title: 'Now Named' }]);
    const [row] = await db.select().from(links);
    expect(row!.title).toBe('Now Named');
  });

  it('skips tombstoned urls instead of resurrecting them', async () => {
    await importLinks(db, [{ url: 'https://a.com/1' }]);
    const [row] = await db.select().from(links);
    await db.insert(deletedHashes).values({ urlHash: row!.urlHash });
    await db.delete(links).where(eq(links.id, row!.id));

    const res = await importLinks(db, [{ url: 'https://a.com/1' }]);
    expect(res.skippedDeleted).toBe(1);
    expect(res.created).toBe(0);
    expect(await db.select().from(links)).toHaveLength(0);
  });

  it('reports invalid urls without dropping the valid ones', async () => {
    const res = await importLinks(db, [
      { url: 'chrome://bookmarks' },
      { url: 'not a url at all' },
      { url: 'https://good.com/1' },
    ]);
    expect(res.created).toBe(1);
    expect(res.invalid).toHaveLength(2);
    expect(res.invalid.map((i) => i.reason).sort()).toEqual(['non-http url', 'unparseable url']);
  });

  it('collapses urls that normalize to the same hash within one batch', async () => {
    const res = await importLinks(db, [
      { url: 'https://www.a.com/1?utm_source=x' },
      { url: 'https://a.com/1' },
    ]);
    expect(res.created).toBe(1);
    expect(await db.select().from(links)).toHaveLength(1);
  });

  it('returns an empty result for an empty batch', async () => {
    const res = await importLinks(db, []);
    expect(res).toEqual({ created: 0, updated: 0, skippedDeleted: 0, invalid: [] });
  });
});
