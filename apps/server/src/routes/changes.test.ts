import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql as dsql } from 'drizzle-orm';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { getDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { hubLinks, hubs, links } from '../db/schema.js';
import { authHeaders } from '../test/auth.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const ALL = dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, link_deletions, owner, sessions, api_tokens, auth_codes, quotes CASCADE`;
const DATA = dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, link_deletions, quotes CASCADE`;

/** UTC, ISO 8601, six fractional digits. */
const FEED_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

interface Item { id: string; url: string; title: string; note: string; status: string; hubs: string[]; updatedAt: string }
interface Page { items: Item[]; deleted: { id: string; deletedAt: string }[]; cursor: string | null; more: boolean }

describe('changes feed and PATCH hubs', () => {
  let app: FastifyInstance; let db: Db; let headers: { Authorization: string };
  beforeAll(async () => {
    await runMigrations(TEST_URL);
    const temp = getDb(TEST_URL);
    await temp.db.execute(ALL);
    await temp.sql.end();
    app = await buildApp({ databaseUrl: TEST_URL, fetchOgImage: async () => null });
    db = app.db;
    headers = await authHeaders(db);
    return async () => { await app.close(); };
  });
  beforeEach(async () => { await db.execute(DATA); });
  afterAll(async () => { await db.execute(ALL); });

  async function pull(query: Record<string, string | number> = {}): Promise<Page> {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
    const res = await app.inject({ method: 'GET', url: `/api/links/changes?${qs}`, headers });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }
  /** Pulls page after page from `since` until the feed says there is no more. */
  async function pullAll(since?: string, limit = 500): Promise<{ pages: Page[]; cursor: string | null }> {
    const pages: Page[] = [];
    let cursor = since ?? null;
    for (let i = 0; i < 50; i++) {
      const page = await pull({ ...(cursor ? { since: cursor } : {}), limit });
      pages.push(page);
      cursor = page.cursor;
      if (!page.more) return { pages, cursor };
    }
    throw new Error('the feed never ran out');
  }
  async function link(url: string, over: Partial<typeof links.$inferInsert> = {}): Promise<string> {
    const [row] = await db.insert(links).values({ url, urlHash: url, ...over }).returning({ id: links.id });
    return row!.id;
  }
  async function stamp(id: string): Promise<string> {
    const [row] = await db.execute(
      dsql`SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM links WHERE id = ${id}`,
    );
    return row!.at as string;
  }
  const ids = (p: Page | Page[]) => [p].flat().flatMap((x) => x.items.map((i) => i.id));

  describe('GET /api/links/changes', () => {
    it('needs auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/links/changes' });
      expect(res.statusCode).toBe(401);
    });

    it('returns everything without since: every status, hub names without archived hubs', async () => {
      const a = await link('https://a.dev/1', { title: 'One', note: 'why' });
      const b = await link('https://a.dev/2', { status: 'archived' });
      const [rust, zig, old] = await db.insert(hubs).values([
        { name: 'rust' }, { name: 'zig', status: 'dormant' }, { name: 'old', status: 'archived' },
      ]).returning();
      await db.insert(hubLinks).values([
        { hubId: zig!.id, linkId: a }, { hubId: rust!.id, linkId: a }, { hubId: old!.id, linkId: a },
      ]);

      const page = await pull();
      expect(page.more).toBe(false);
      expect(page.deleted).toEqual([]);
      const byId = new Map(page.items.map((i) => [i.id, i]));
      expect(byId.get(a)).toEqual({
        id: a, url: 'https://a.dev/1', title: 'One', note: 'why', status: 'active',
        hubs: ['rust', 'zig'], updatedAt: await stamp(a),
      });
      expect(byId.get(b)).toMatchObject({ status: 'archived', hubs: [] });
      expect(page.cursor).toBe(page.items.at(-1)!.updatedAt);
    });

    it('writes times with microseconds, exactly as Postgres holds them', async () => {
      const id = await link('https://a.dev/us');
      await db.execute(dsql`UPDATE links SET updated_at = '2026-09-28 10:11:12.345678+00' WHERE id = ${id}`);
      const page = await pull();
      expect(page.items[0]!.updatedAt).toBe('2026-09-28T10:11:12.345678Z');
      expect(page.cursor).toMatch(FEED_TIME);
      // Any offset reads the same instant.
      const again = await pull({ since: '2026-09-28T12:11:12.345678+02:00' });
      expect(ids(again)).toEqual([id]);
      expect((await pull({ since: '2026-09-28T10:11:12.345679Z' })).items).toEqual([]);
    });

    it('is inclusive: the cursor’s own timestamp comes back, anything older does not', async () => {
      const old = await link('https://a.dev/old');
      await db.execute(dsql`UPDATE links SET updated_at = '2026-01-01T00:00:00Z' WHERE id = ${old}`);
      const a = await link('https://a.dev/a');
      const first = await pull();
      expect(ids(first)).toEqual([old, a]);

      const again = await pull({ since: first.cursor! });
      expect(ids(again)).toEqual([a]);
      expect(again.cursor).toBe(first.cursor);
      expect(again.more).toBe(false);
    });

    it('orders by time then id, and pages through every change with no loss', async () => {
      const made: string[] = [];
      for (let i = 0; i < 7; i++) made.push(await link(`https://a.dev/p${i}`));
      const { pages } = await pullAll(undefined, 3);
      // Each later page starts at the last one's cursor: the item that shares
      // it comes back, on top of the limit.
      expect(pages.map((p) => p.items.length)).toEqual([3, 1 + 3, 1 + 1]);
      expect(pages.map((p) => p.more)).toEqual([true, true, false]);
      expect(pages[1]!.items[0]!.id).toBe(pages[0]!.items.at(-1)!.id);
      expect([...new Set(ids(pages))]).toEqual(made);
      for (const p of pages) expect(p.items.map((i) => i.updatedAt)).toEqual(p.items.map((i) => i.updatedAt).sort());
    });

    it('never splits writes that share a timestamp, however many there are', async () => {
      // One statement, one now(): five links alike, then three more alike.
      const firstBatch = (await db.insert(links).values(
        Array.from({ length: 5 }, (_, i) => ({ url: `https://a.dev/g${i}`, urlHash: `g${i}` })),
      ).returning({ id: links.id })).map((r) => r.id);
      const secondBatch = (await db.insert(links).values(
        Array.from({ length: 3 }, (_, i) => ({ url: `https://a.dev/h${i}`, urlHash: `h${i}` })),
      ).returning({ id: links.id })).map((r) => r.id);

      const one = await pull({ limit: 2 });
      expect(one.items.map((i) => i.id).sort()).toEqual([...firstBatch].sort());
      expect(one.more).toBe(true);

      // The cursor's own group comes back and does not count; the next group follows whole.
      const two = await pull({ since: one.cursor!, limit: 2 });
      expect(two.items.map((i) => i.id).sort()).toEqual([...firstBatch, ...secondBatch].sort());
      expect(two.more).toBe(false);
      expect(two.cursor).not.toBe(one.cursor);

      const { pages } = await pullAll(undefined, 1);
      expect(new Set(ids(pages))).toEqual(new Set([...firstBatch, ...secondBatch]));
    });

    it('keeps writes from separate transactions in the same instant', async () => {
      const a = await link('https://a.dev/same1');
      const b = await link('https://a.dev/same2');
      await db.execute(dsql`UPDATE links SET updated_at = '2026-09-28T10:00:00.000001Z'`);
      const page = await pull({ since: '2026-09-28T10:00:00.000001Z', limit: 1 });
      expect(ids(page).sort()).toEqual([a, b].sort());
      expect(page.more).toBe(false);
    });

    it('lists deleted links, in time order with the rest', async () => {
      const gone = await link('https://a.dev/gone');
      const kept = await link('https://a.dev/kept');
      const before = await pull();
      await app.inject({ method: 'POST', url: '/api/links/bulk', headers, payload: { ids: [gone], action: 'delete' } });

      const after = await pull({ since: before.cursor! });
      expect(after.deleted).toHaveLength(1);
      expect(after.deleted[0]!.id).toBe(gone);
      expect(after.deleted[0]!.deletedAt).toMatch(FEED_TIME);
      expect(after.cursor).toBe(after.deleted[0]!.deletedAt);
      expect(ids(after)).toEqual([kept]);

      const later = await pull({ since: '2999-01-01T00:00:00Z' });
      expect(later).toEqual({ items: [], deleted: [], cursor: '2999-01-01T00:00:00.000000Z', more: false });

      // A first sync hears of deletions too: they are part of everything.
      expect((await pull()).deleted.map((d) => d.id)).toEqual([gone]);
    });

    it('pages deletions like any other change', async () => {
      const made: string[] = [];
      for (let i = 0; i < 4; i++) made.push(await link(`https://a.dev/x${i}`));
      for (const id of made) await db.delete(links).where(eq(links.id, id));
      const { pages } = await pullAll(undefined, 2);
      expect(pages.length).toBeGreaterThan(1);
      expect(new Set(pages.flatMap((p) => p.deleted.map((d) => d.id)))).toEqual(new Set(made));
    });

    it('has no cursor to give on an empty first sync', async () => {
      expect(await pull()).toEqual({ items: [], deleted: [], cursor: null, more: false });
    });

    it('turns away a since or limit it cannot use', async () => {
      for (const q of ['since=yesterday', 'since=2026-09-28', 'limit=0', 'limit=1001']) {
        const res = await app.inject({ method: 'GET', url: `/api/links/changes?${q}`, headers });
        expect(res.statusCode, q).toBe(400);
      }
      const res = await app.inject({ method: 'GET', url: '/api/links/changes?since=2026-02-30T00:00:00Z', headers });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid since' });
    });

    it('shows hub renames and archives as changes to the links in them', async () => {
      const id = await link('https://a.dev/h');
      const hub = (await app.inject({ method: 'POST', url: '/api/hubs', headers, payload: { name: 'rust' } })).json();
      await db.insert(hubLinks).values({ hubId: hub.id, linkId: id });
      const before = await pull();

      await app.inject({ method: 'PATCH', url: `/api/hubs/${hub.id}`, headers, payload: { name: 'rustlang' } });
      const renamed = await pull({ since: before.cursor! });
      expect(renamed.items.find((i) => i.id === id)).toMatchObject({ hubs: ['rustlang'] });
      expect(renamed.cursor! > before.cursor!).toBe(true);

      await app.inject({ method: 'PATCH', url: `/api/hubs/${hub.id}`, headers, payload: { status: 'archived' } });
      const archived = await pull({ since: renamed.cursor! });
      expect(archived.items.find((i) => i.id === id)).toMatchObject({ hubs: [] });
    });

    it('holds back rows an open transaction could still write under, until it ends', async () => {
      const first = await link('https://a.dev/first');
      const base = await pull();

      // A slow writer: its rows carry its start time but appear only at commit.
      const other = postgres(TEST_URL, { max: 1, onnotice: () => {} });
      let commit!: () => void;
      const committed = new Promise<void>((resolve) => { commit = resolve; });
      let wrote!: () => void;
      const written = new Promise<void>((resolve) => { wrote = resolve; });
      const slow = other.begin(async (tx) => {
        await tx`INSERT INTO links (url, url_hash) VALUES ('https://a.dev/slow', 'slow')`;
        wrote();
        await committed;
      });
      try {
        await written;
        const fast = await link('https://a.dev/fast');
        expect(await stamp(fast) > base.cursor!).toBe(true);

        // Without the hold, this pull would hand out fast's stamp as the cursor
        // and the slow row, stamped earlier, would never be pulled.
        const during = await pull({ since: base.cursor! });
        expect(ids(during)).toEqual([first]);
        expect(during.cursor).toBe(base.cursor);
      } finally {
        commit();
        await slow;
        await other.end();
      }
      const after = await pull({ since: base.cursor! });
      expect(after.items.map((i) => i.url)).toEqual(['https://a.dev/first', 'https://a.dev/slow', 'https://a.dev/fast']);
    });
  });

  describe('PATCH /api/links/:id hubs', () => {
    const patch = (id: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/api/links/${id}`, headers, payload });
    async function hubsOf(id: string): Promise<{ name: string; assignedBy: string }[]> {
      return db.select({ name: hubs.name, assignedBy: hubLinks.assignedBy })
        .from(hubLinks).innerJoin(hubs, eq(hubs.id, hubLinks.hubId))
        .where(eq(hubLinks.linkId, id)).orderBy(hubs.name);
    }

    it('replaces the hub set by name, creating missing hubs as filed by you', async () => {
      const id = await link('https://a.dev/p');
      const [a, b] = await db.insert(hubs).values([{ name: 'a' }, { name: 'b' }]).returning();
      await db.insert(hubLinks).values([
        { hubId: a!.id, linkId: id, assignedBy: 'auto' }, { hubId: b!.id, linkId: id, assignedBy: 'auto' },
      ]);

      const res = await patch(id, { hubs: ['b', 'c', 'c'] });
      expect(res.statusCode).toBe(200);
      expect(await hubsOf(id)).toEqual([{ name: 'b', assignedBy: 'auto' }, { name: 'c', assignedBy: 'user' }]);
      const c = (await db.select().from(hubs).where(eq(hubs.name, 'c')))[0]!;
      expect(res.json().hubIds.sort()).toEqual([b!.id, c.id].sort());
      expect(c.status).toBe('active');
    });

    it('takes hubs with other fields in one change, and shows up in the feed', async () => {
      const id = await link('https://a.dev/q', { title: 'Old' });
      const before = await pull();
      const res = await patch(id, { title: 'New', hubs: ['rust'] });
      expect(res.json()).toMatchObject({ title: 'New' });
      const after = await pull({ since: before.cursor! });
      expect(after.items.find((i) => i.id === id)).toMatchObject({ title: 'New', hubs: ['rust'] });
      expect(after.cursor! > before.cursor!).toBe(true);
    });

    it('empties the set with [], but keeps archived hubs it was not told about', async () => {
      const id = await link('https://a.dev/r');
      const [live, gone] = await db.insert(hubs).values([{ name: 'live' }, { name: 'gone', status: 'archived' }]).returning();
      await db.insert(hubLinks).values([{ hubId: live!.id, linkId: id }, { hubId: gone!.id, linkId: id }]);
      await patch(id, { hubs: [] });
      expect((await hubsOf(id)).map((h) => h.name)).toEqual(['gone']);
    });

    it('brings back an archived hub it is filed into', async () => {
      const id = await link('https://a.dev/s');
      await db.insert(hubs).values({ name: 'old', status: 'archived' });
      await patch(id, { hubs: ['old'] });
      const [old] = await db.select().from(hubs).where(eq(hubs.name, 'old'));
      expect(old!.status).toBe('active');
      expect((await pull()).items.find((i) => i.id === id)).toMatchObject({ hubs: ['old'] });
    });

    it('leaves hubs alone when the body has none, as before', async () => {
      const id = await link('https://a.dev/t');
      await patch(id, { hubs: ['rust'] });
      await patch(id, { note: 'n' });
      expect((await hubsOf(id)).map((h) => h.name)).toEqual(['rust']);
    });

    it('404s for an unknown link without creating hubs', async () => {
      const res = await patch('00000000-0000-0000-0000-000000000000', { hubs: ['phantom'] });
      expect(res.statusCode).toBe(404);
      expect(await db.select().from(hubs)).toEqual([]);
    });

    it('rejects an empty hub name', async () => {
      const id = await link('https://a.dev/u');
      expect((await patch(id, { hubs: [''] })).statusCode).toBe(400);
    });
  });

  describe('PATCH /api/links/:id addHubs and removeHubs', () => {
    const patch = (id: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/api/links/${id}`, headers, payload });
    async function hubsOf(id: string): Promise<{ name: string; assignedBy: string }[]> {
      return db.select({ name: hubs.name, assignedBy: hubLinks.assignedBy })
        .from(hubLinks).innerJoin(hubs, eq(hubs.id, hubLinks.hubId))
        .where(eq(hubLinks.linkId, id)).orderBy(hubs.name);
    }
    async function filed(url: string, names: string[]): Promise<string> {
      const id = await link(url);
      const rows = await db.insert(hubs).values(names.map((name) => ({ name }))).returning();
      await db.insert(hubLinks).values(rows.map((h) => ({ hubId: h.id, linkId: id, assignedBy: 'auto' as const })));
      return id;
    }

    it('moves a link between two hubs and keeps a hub added on the server meanwhile', async () => {
      // The browser pulled [dev]; the web app has since filed it into reading too.
      const id = await filed('https://a.dev/m', ['dev', 'reading']);
      const res = await patch(id, { removeHubs: ['dev'], addHubs: ['rust'] });
      expect(res.statusCode).toBe(200);
      expect(await hubsOf(id)).toEqual([{ name: 'reading', assignedBy: 'auto' }, { name: 'rust', assignedBy: 'user' }]);
      const rust = (await db.select().from(hubs).where(eq(hubs.name, 'rust')))[0]!;
      expect(res.json().hubIds).toContain(rust.id);
    });

    it('adds by name, creating a missing hub and bringing back an archived one', async () => {
      const id = await filed('https://a.dev/n', ['keep']);
      await db.insert(hubs).values({ name: 'old', status: 'archived' });
      await patch(id, { addHubs: ['old', 'new', 'new', 'keep'] });
      expect(await hubsOf(id)).toEqual([
        { name: 'keep', assignedBy: 'auto' }, { name: 'new', assignedBy: 'user' }, { name: 'old', assignedBy: 'user' },
      ]);
      const [old] = await db.select().from(hubs).where(eq(hubs.name, 'old'));
      expect(old!.status).toBe('active');
    });

    it('removes only the named hubs, and a name the link is not in changes nothing', async () => {
      const id = await filed('https://a.dev/o', ['a', 'b']);
      await patch(id, { removeHubs: ['a', 'nowhere'] });
      expect((await hubsOf(id)).map((h) => h.name)).toEqual(['b']);
      expect((await db.select().from(hubs)).map((h) => h.name).sort()).toEqual(['a', 'b']);
      await patch(id, { removeHubs: ['b'], addHubs: [] });
      expect(await hubsOf(id)).toEqual([]);
    });

    it('leaves a link in an archived hub named in removeHubs, as archiving does', async () => {
      // Another browser saw a pull move the link out of the archived hub's folder.
      const id = await filed('https://a.dev/o2', ['dev', 'books']);
      await db.update(hubs).set({ status: 'archived' }).where(eq(hubs.name, 'books'));
      await patch(id, { removeHubs: ['books', 'dev'] });
      expect((await hubsOf(id)).map((h) => h.name)).toEqual(['books']);
      // Brought back, the hub has the link again.
      await db.update(hubs).set({ status: 'active' }).where(eq(hubs.name, 'books'));
      expect((await pull()).items.find((i) => i.id === id)).toMatchObject({ hubs: ['books'] });
    });

    it('takes them with other fields in one change, and shows up in the feed', async () => {
      const id = await filed('https://a.dev/p2', ['dev']);
      const before = await pull();
      await patch(id, { title: 'Moved', removeHubs: ['dev'], addHubs: ['rust'] });
      const after = await pull({ since: before.cursor! });
      expect(after.items.find((i) => i.id === id)).toMatchObject({ title: 'Moved', hubs: ['rust'] });
    });

    it('adds a name that is in both lists', async () => {
      const id = await filed('https://a.dev/q2', ['dev']);
      await patch(id, { removeHubs: ['dev'], addHubs: ['dev'] });
      expect((await hubsOf(id)).map((h) => h.name)).toEqual(['dev']);
    });

    it('refuses them alongside hubs, changing nothing', async () => {
      const id = await filed('https://a.dev/r2', ['dev']);
      const res = await patch(id, { title: 'No', hubs: ['x'], addHubs: ['y'] });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'hubs cannot be sent with addHubs or removeHubs' });
      expect((await patch(id, { hubs: [], removeHubs: ['dev'] })).statusCode).toBe(400);
      expect((await hubsOf(id)).map((h) => h.name)).toEqual(['dev']);
      expect((await db.select().from(links).where(eq(links.id, id)))[0]!.title).not.toBe('No');
      expect((await db.select().from(hubs)).map((h) => h.name)).toEqual(['dev']);
    });

    it('404s for an unknown link without creating hubs, and rejects an empty name', async () => {
      const res = await patch('00000000-0000-0000-0000-000000000000', { addHubs: ['phantom'] });
      expect(res.statusCode).toBe(404);
      expect(await db.select().from(hubs)).toEqual([]);
      const id = await link('https://a.dev/s2');
      expect((await patch(id, { addHubs: [''] })).statusCode).toBe(400);
      expect((await patch(id, { removeHubs: [''] })).statusCode).toBe(400);
    });
  });

  describe('hub names', () => {
    it('saving into an archived hub brings it back', async () => {
      await db.insert(hubs).values({ name: 'old', status: 'archived' });
      await app.inject({ method: 'POST', url: '/api/links', headers, payload: { url: 'https://a.dev/v', hub: 'old' } });
      const [old] = await db.select().from(hubs).where(eq(hubs.name, 'old'));
      expect(old!.status).toBe('active');
    });

    it('renaming a hub to a name another has is a 409', async () => {
      const [, b] = await db.insert(hubs).values([{ name: 'a' }, { name: 'b' }]).returning();
      const res = await app.inject({ method: 'PATCH', url: `/api/hubs/${b!.id}`, headers, payload: { name: 'a' } });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'hub name exists' });
    });
  });
});
