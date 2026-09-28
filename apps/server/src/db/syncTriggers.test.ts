import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql as dsql } from 'drizzle-orm';
import { getDb, type Db } from './client.js';
import { runMigrations } from './migrate.js';
import { hubLinks, hubs, linkDeletions, links } from './schema.js';
import { assignHubs } from '../links/assignHubs.js';
import { importLinks } from '../links/importLinks.js';
import { backfillOg } from '../og/backfill.js';
import { checkLinks } from '../og/checkLinks.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const CLEAN = dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, link_deletions CASCADE`;

/** A stamp no real write makes, so any write that moves updated_at shows. */
const LONG_AGO = '2000-01-01T00:00:00.000000Z';

// The migration's triggers, checked against the database itself: bookmark sync
// trusts links.updated_at to move for every change a browser shows, and for
// nothing else.
describe('sync triggers', () => {
  let db: Db; let end: () => Promise<void>;
  beforeAll(async () => {
    await runMigrations(TEST_URL);
    const h = getDb(TEST_URL);
    db = h.db; end = () => h.sql.end();
  });
  beforeEach(async () => { await db.execute(CLEAN); });
  afterAll(async () => { await db.execute(CLEAN); await end(); });

  async function link(url: string, title = ''): Promise<string> {
    const [row] = await db.insert(links).values({ url, urlHash: url, title }).returning({ id: links.id });
    return row!.id;
  }
  async function hub(name: string): Promise<string> {
    const [row] = await db.insert(hubs).values({ name }).returning({ id: hubs.id });
    return row!.id;
  }
  /** Sets updated_at back without touching anything the trigger watches. */
  async function age(...ids: string[]): Promise<void> {
    for (const id of ids) await db.execute(dsql`UPDATE links SET updated_at = ${LONG_AGO}::timestamptz WHERE id = ${id}`);
  }
  async function stamp(id: string): Promise<string> {
    const [row] = await db.execute(
      dsql`SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM links WHERE id = ${id}`,
    );
    return row!.at as string;
  }

  it('moves updated_at when a url, title, note or status changes, without the app setting it', async () => {
    const id = await link('https://a.dev/1');
    for (const set of [dsql`title = 'T'`, dsql`note = 'N'`, dsql`status = 'archived'`, dsql`url = 'https://a.dev/1b'`]) {
      await age(id);
      await db.execute(dsql`UPDATE links SET ${set} WHERE id = ${id}`);
      expect(await stamp(id)).not.toBe(LONG_AGO);
    }
  });

  it('leaves updated_at alone for page checks and og:image lookups', async () => {
    const id = await link('https://a.dev/2', 'Kept');
    await age(id);
    await db.update(links).set({
      imageUrl: 'https://cdn/x.png', ogFetchedAt: new Date(), contentText: 'text', httpStatus: 200,
      checkError: null, checkedAt: new Date(), relevance: 4, dupeCount: 3, lastSeen: new Date(),
    }).where(eq(links.id, id));
    expect(await stamp(id)).toBe(LONG_AGO);

    await db.update(links).set({ ogFetchedAt: null, checkedAt: null }).where(eq(links.id, id));
    await age(id);
    await backfillOg(db, async () => 'https://cdn/og.png', 10);
    await checkLinks(db, async (url) => ({ status: 200, error: null, html: '<p>Page text</p>', url }), 10);
    const [row] = await db.select().from(links).where(eq(links.id, id));
    expect(row!.checkedAt).not.toBeNull();
    expect(row!.contentText).toBe('Page text');
    expect(await stamp(id)).toBe(LONG_AGO);
  });

  it('moves updated_at when a link joins or leaves a hub', async () => {
    const id = await link('https://a.dev/3');
    const h = await hub('rust');
    await age(id);
    await db.insert(hubLinks).values({ hubId: h, linkId: id });
    expect(await stamp(id)).not.toBe(LONG_AGO);

    await age(id);
    await db.delete(hubLinks).where(eq(hubLinks.linkId, id));
    expect(await stamp(id)).not.toBe(LONG_AGO);
  });

  it('touches only the links whose hub pair changed in a multi-row write', async () => {
    const [a, b, c] = [await link('https://a.dev/a'), await link('https://a.dev/b'), await link('https://a.dev/c')];
    const h = await hub('rust');
    await db.insert(hubLinks).values({ hubId: h, linkId: a });
    await age(a, b, c);
    await db.insert(hubLinks).values([{ hubId: h, linkId: b }, { hubId: h, linkId: a }]).onConflictDoNothing();
    expect(await stamp(a)).toBe(LONG_AGO);
    expect(await stamp(b)).not.toBe(LONG_AGO);
    expect(await stamp(c)).toBe(LONG_AGO);
  });

  it('leaves updated_at alone when an assign only rewrites relevance', async () => {
    const id = await link('https://a.dev/4');
    await assignHubs(db, [{ linkId: id, hub: 'rust', relevance: 2 }]);
    await age(id);
    await assignHubs(db, [{ linkId: id, hub: 'rust', relevance: 5 }]);
    const [m] = await db.select().from(hubLinks).where(eq(hubLinks.linkId, id));
    expect(m!.relevance).toBe(5);
    expect(await stamp(id)).toBe(LONG_AGO);
  });

  it('moves updated_at when a membership row is moved to another hub', async () => {
    const id = await link('https://a.dev/5');
    const [h1, h2] = [await hub('one'), await hub('two')];
    await db.insert(hubLinks).values({ hubId: h1, linkId: id });
    await age(id);
    await db.update(hubLinks).set({ hubId: h2 }).where(eq(hubLinks.linkId, id));
    expect(await stamp(id)).not.toBe(LONG_AGO);
  });

  it('moves updated_at on every link of a hub that is renamed or archived, and on no other', async () => {
    const [inHub, other] = [await link('https://a.dev/6'), await link('https://a.dev/7')];
    const h = await hub('rust');
    await db.insert(hubLinks).values({ hubId: h, linkId: inHub });

    await age(inHub, other);
    await db.update(hubs).set({ name: 'rustlang' }).where(eq(hubs.id, h));
    expect(await stamp(inHub)).not.toBe(LONG_AGO);
    expect(await stamp(other)).toBe(LONG_AGO);

    await age(inHub);
    await db.update(hubs).set({ status: 'archived' }).where(eq(hubs.id, h));
    expect(await stamp(inHub)).not.toBe(LONG_AGO);
  });

  it('leaves links alone when a hub changes in a way no folder shows', async () => {
    const id = await link('https://a.dev/8');
    const h = await hub('rust');
    await db.insert(hubLinks).values({ hubId: h, linkId: id });
    await age(id);
    await db.update(hubs).set({ description: 'Systems', updatedAt: new Date() }).where(eq(hubs.id, h));
    // A rename to the same name and a status set to what it was are no change.
    await db.update(hubs).set({ name: 'rust', status: 'active' }).where(eq(hubs.id, h));
    expect(await stamp(id)).toBe(LONG_AGO);
  });

  it('moves updated_at on the links of a deleted hub', async () => {
    const id = await link('https://a.dev/9');
    const h = await hub('rust');
    await db.insert(hubLinks).values({ hubId: h, linkId: id });
    await age(id);
    await db.delete(hubs).where(eq(hubs.id, h));
    expect(await stamp(id)).not.toBe(LONG_AGO);
  });

  it('logs every deleted link, hub members included', async () => {
    const [a, b, keep] = [await link('https://a.dev/d1'), await link('https://a.dev/d2'), await link('https://a.dev/d3')];
    const h = await hub('rust');
    await db.insert(hubLinks).values([{ hubId: h, linkId: a }, { hubId: h, linkId: b }]);
    await db.delete(links).where(dsql`${links.id} IN (${a}, ${b})`);

    const logged = await db.select().from(linkDeletions);
    expect(logged.map((r) => r.linkId).sort()).toEqual([a, b].sort());
    expect(logged.every((r) => r.deletedAt instanceof Date)).toBe(true);
    expect((await db.select().from(links)).map((r) => r.id)).toEqual([keep]);
    expect(await db.select().from(hubLinks)).toEqual([]);
  });

  it('re-importing a link moves updated_at only when it fills in the title', async () => {
    await importLinks(db, [{ url: 'https://a.dev/titled', title: 'Mine' }, { url: 'https://a.dev/bare' }]);
    const [titled] = await db.select().from(links).where(eq(links.url, 'https://a.dev/titled'));
    const [bare] = await db.select().from(links).where(eq(links.url, 'https://a.dev/bare'));
    await age(titled!.id, bare!.id);

    await importLinks(db, [{ url: 'https://a.dev/titled', title: 'Theirs' }, { url: 'https://a.dev/bare', title: 'Filled' }]);
    expect(await stamp(titled!.id)).toBe(LONG_AGO);
    expect(await stamp(bare!.id)).not.toBe(LONG_AGO);
    const [after] = await db.select().from(links).where(eq(links.id, bare!.id));
    expect(after!.title).toBe('Filled');
  });

  it('gives every write in one transaction the same stamp', async () => {
    const [a, b] = [await link('https://a.dev/t1'), await link('https://a.dev/t2')];
    const h = await hub('rust');
    await db.transaction(async (tx) => {
      await tx.update(links).set({ title: 'x' }).where(eq(links.id, a));
      await tx.insert(hubLinks).values([{ hubId: h, linkId: a }, { hubId: h, linkId: b }]);
    });
    expect(await stamp(a)).toBe(await stamp(b));
  });
});
