import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { getDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { captures, deletedHashes, hubLinks, hubs, links } from '../db/schema.js';
import { authHeaders } from '../test/auth.js';
import { findNearDuplicates, type LinkWithHubs } from './duplicates.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';

describe('duplicates', () => {
  let app: FastifyInstance; let db: Db; let headers: { Authorization: string };
  beforeAll(async () => {
    await runMigrations(TEST_URL);
    const tempDb = await getDb(TEST_URL);
    await tempDb.db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, owner, sessions, api_tokens, auth_codes CASCADE`);
    await tempDb.sql.end();
    app = await buildApp({ databaseUrl: TEST_URL, fetchOgImage: async () => null });
    db = app.db;
    headers = await authHeaders(db);
    return async () => { await app.close(); };
  });
  beforeEach(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs CASCADE`);
  });
  afterAll(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, owner, sessions, api_tokens, auth_codes CASCADE`);
  });

  describe('findNearDuplicates', () => {
    it('different query params never group', () => {
      const now = new Date();
      const rows: LinkWithHubs[] = [
        {
          id: '1',
          url: 'https://youtube.com/watch?v=A',
          title: 'Video A',
          note: '',
          status: 'active',
          firstSeen: now,
          createdAt: new Date(now.getTime()),
          dupeCount: 1,
          hubIds: [],
        },
        {
          id: '2',
          url: 'https://youtube.com/watch?v=B',
          title: 'Video B',
          note: '',
          status: 'active',
          firstSeen: now,
          createdAt: new Date(now.getTime() + 1000),
          dupeCount: 1,
          hubIds: [],
        },
      ];
      const groups = findNearDuplicates(rows);
      expect(groups).toHaveLength(0);
    });

    it('http and https variants group', () => {
      const now = new Date();
      const rows: LinkWithHubs[] = [
        {
          id: '1',
          url: 'http://example.com/page',
          title: 'Page',
          note: '',
          status: 'active',
          firstSeen: now,
          createdAt: new Date(now.getTime()),
          dupeCount: 1,
          hubIds: [],
        },
        {
          id: '2',
          url: 'https://example.com/page',
          title: 'Page',
          note: '',
          status: 'active',
          firstSeen: now,
          createdAt: new Date(now.getTime() + 1000),
          dupeCount: 1,
          hubIds: [],
        },
      ];
      const groups = findNearDuplicates(rows);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.reason).toContain('http and https');
    });

    it('trailing slash variants group', () => {
      const now = new Date();
      const rows: LinkWithHubs[] = [
        {
          id: '1',
          url: 'https://example.com/a',
          title: 'A',
          note: '',
          status: 'active',
          firstSeen: now,
          createdAt: new Date(now.getTime()),
          dupeCount: 1,
          hubIds: [],
        },
        {
          id: '2',
          url: 'https://example.com/a/',
          title: 'A with slash',
          note: '',
          status: 'active',
          firstSeen: now,
          createdAt: new Date(now.getTime() + 1000),
          dupeCount: 1,
          hubIds: [],
        },
      ];
      const groups = findNearDuplicates(rows);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.reason).toContain('Trailing slash');
    });

    it('mobile subdomain variants group', () => {
      const now = new Date();
      const rows: LinkWithHubs[] = [
        {
          id: '1',
          url: 'https://example.com/a',
          title: 'Desktop',
          note: '',
          status: 'active',
          firstSeen: now,
          createdAt: new Date(now.getTime()),
          dupeCount: 1,
          hubIds: [],
        },
        {
          id: '2',
          url: 'https://m.example.com/a',
          title: 'Mobile',
          note: '',
          status: 'active',
          firstSeen: now,
          createdAt: new Date(now.getTime() + 1000),
          dupeCount: 1,
          hubIds: [],
        },
      ];
      const groups = findNearDuplicates(rows);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.reason).toContain('Mobile site');
    });

    it('amp-guide word does not match /amp rule', () => {
      const now = new Date();
      const rows: LinkWithHubs[] = [
        {
          id: '1',
          url: 'https://example.com/amp-guide',
          title: 'Amp Guide',
          note: '',
          status: 'active',
          firstSeen: now,
          createdAt: new Date(now.getTime()),
          dupeCount: 1,
          hubIds: [],
        },
        {
          id: '2',
          url: 'https://example.com/guide',
          title: 'Guide',
          note: '',
          status: 'active',
          firstSeen: now,
          createdAt: new Date(now.getTime() + 1000),
          dupeCount: 1,
          hubIds: [],
        },
      ];
      const groups = findNearDuplicates(rows);
      expect(groups).toHaveLength(0);
    });

    it('amp subdomain and plain host group', () => {
      const now = new Date();
      const rows: LinkWithHubs[] = [
        {
          id: '1',
          url: 'https://example.com/article',
          title: 'Article',
          note: '',
          status: 'active',
          firstSeen: now,
          createdAt: new Date(now.getTime()),
          dupeCount: 1,
          hubIds: [],
        },
        {
          id: '2',
          url: 'https://amp.example.com/article',
          title: 'Article AMP',
          note: '',
          status: 'active',
          firstSeen: now,
          createdAt: new Date(now.getTime() + 1000),
          dupeCount: 1,
          hubIds: [],
        },
      ];
      const groups = findNearDuplicates(rows);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.reason).toContain('AMP version');
    });
  });

  describe('/api/links/duplicates', () => {
    it('returns empty when no duplicates', async () => {
      await db.insert(links).values([
        { url: 'https://a.com', urlHash: 'h1', title: 'A' },
        { url: 'https://b.com', urlHash: 'h2', title: 'B' },
      ]);
      const res = await app.inject({
        method: 'GET',
        url: '/api/links/duplicates',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.groups).toHaveLength(0);
    });

    it('excludes archived links', async () => {
      await db.insert(links).values([
        { url: 'https://example.com/page', urlHash: 'h1', title: 'Page' },
        { url: 'https://m.example.com/page', urlHash: 'h2', title: 'Page Mobile', status: 'archived' },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/links/duplicates',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.groups).toHaveLength(0);
    });
  });

  describe('/api/links/merge', () => {
    it('rejects when keepId in mergeIds', async () => {
      const id = (await db.insert(links).values({ url: 'https://a.com', urlHash: 'h1' }).returning())[0]!.id;
      const res = await app.inject({
        method: 'POST',
        url: '/api/links/merge',
        headers,
        payload: { keepId: id, mergeIds: [id] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects duplicate mergeIds', async () => {
      const [l1] = await db.insert(links).values({ url: 'https://a.com', urlHash: 'h1' }).returning();
      const [l2] = await db.insert(links).values({ url: 'https://b.com', urlHash: 'h2' }).returning();
      const res = await app.inject({
        method: 'POST',
        url: '/api/links/merge',
        headers,
        payload: { keepId: l1!.id, mergeIds: [l2!.id, l2!.id] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when keep link not found', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/links/merge',
        headers,
        payload: {
          keepId: '00000000-0000-0000-0000-000000000000',
          mergeIds: ['11111111-1111-1111-1111-111111111111'],
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when keep link is archived', async () => {
      const [l1] = await db.insert(links).values({ url: 'https://a.com', urlHash: 'h1', status: 'archived' }).returning();
      const [l2] = await db.insert(links).values({ url: 'https://b.com', urlHash: 'h2' }).returning();
      const res = await app.inject({
        method: 'POST',
        url: '/api/links/merge',
        headers,
        payload: { keepId: l1!.id, mergeIds: [l2!.id] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when merge link is archived', async () => {
      const [l1] = await db.insert(links).values({ url: 'https://a.com', urlHash: 'h1' }).returning();
      const [l2] = await db.insert(links).values({ url: 'https://b.com', urlHash: 'h2', status: 'archived' }).returning();
      const res = await app.inject({
        method: 'POST',
        url: '/api/links/merge',
        headers,
        payload: { keepId: l1!.id, mergeIds: [l2!.id] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('merges links', async () => {
      const l1 = (await db.insert(links).values({
        url: 'https://example.com/page',
        urlHash: 'h1',
        title: 'Short',
      }).returning())[0]!;
      const l2 = (await db.insert(links).values({
        url: 'https://m.example.com/page',
        urlHash: 'h2',
        title: 'Longer Title',
      }).returning())[0]!;

      const res = await app.inject({
        method: 'POST',
        url: '/api/links/merge',
        headers,
        payload: { keepId: l1.id, mergeIds: [l2.id] },
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.title).toBe('Longer Title');
    });

    it('merges hubs and preserves assignedBy', async () => {
      const h1 = (await db.insert(hubs).values({ name: 'h1' }).returning())[0]!;
      const h2 = (await db.insert(hubs).values({ name: 'h2' }).returning())[0]!;
      const l1 = (await db.insert(links).values({ url: 'https://example.com/page', urlHash: 'h1' }).returning())[0]!;
      const l2 = (await db.insert(links).values({ url: 'https://m.example.com/page', urlHash: 'h2' }).returning())[0]!;

      await db.insert(hubLinks).values({ hubId: h1.id, linkId: l1.id, assignedBy: 'user' });
      await db.insert(hubLinks).values({ hubId: h2.id, linkId: l2.id, assignedBy: 'auto' });

      await app.inject({
        method: 'POST',
        url: '/api/links/merge',
        headers,
        payload: { keepId: l1.id, mergeIds: [l2.id] },
      });

      const h2Link = (await db.select().from(hubLinks).where(eq(hubLinks.linkId, l1.id)))[1]!;
      expect(h2Link.assignedBy).toBe('auto');
    });

    it('sums dupeCount', async () => {
      const l1 = (await db.insert(links).values({ url: 'https://example.com/page', urlHash: 'h1', dupeCount: 3 }).returning())[0]!;
      const l2 = (await db.insert(links).values({ url: 'https://m.example.com/page', urlHash: 'h2', dupeCount: 2 }).returning())[0]!;

      const res = await app.inject({
        method: 'POST',
        url: '/api/links/merge',
        headers,
        payload: { keepId: l1.id, mergeIds: [l2.id] },
      });
      expect(JSON.parse(res.body).dupeCount).toBe(5);
    });

    it('concatenates notes', async () => {
      const l1 = (await db.insert(links).values({ url: 'https://example.com/page', urlHash: 'h1', note: 'Note 1' }).returning())[0]!;
      const l2 = (await db.insert(links).values({ url: 'https://m.example.com/page', urlHash: 'h2', note: 'Note 2' }).returning())[0]!;

      const res = await app.inject({
        method: 'POST',
        url: '/api/links/merge',
        headers,
        payload: { keepId: l1.id, mergeIds: [l2.id] },
      });
      expect(JSON.parse(res.body).note).toBe('Note 1\n\nNote 2');
    });

    it('moves captures to keep link', async () => {
      const l1 = (await db.insert(links).values({ url: 'https://example.com/page', urlHash: 'h1' }).returning())[0]!;
      const l2 = (await db.insert(links).values({ url: 'https://m.example.com/page', urlHash: 'h2' }).returning())[0]!;

      await db.insert(captures).values({ linkId: l2.id, source: 'test', originalUrl: 'https://m.example.com/page', originalTitle: 'Title' });

      await app.inject({
        method: 'POST',
        url: '/api/links/merge',
        headers,
        payload: { keepId: l1.id, mergeIds: [l2.id] },
      });

      const capturesOnL1 = await db.select().from(captures).where(eq(captures.linkId, l1.id));
      expect(capturesOnL1).toHaveLength(1);
    });

    it('records deleted hashes', async () => {
      const l1 = (await db.insert(links).values({ url: 'https://example.com/page', urlHash: 'h1' }).returning())[0]!;
      const l2 = (await db.insert(links).values({ url: 'https://m.example.com/page', urlHash: 'h2' }).returning())[0]!;

      await app.inject({
        method: 'POST',
        url: '/api/links/merge',
        headers,
        payload: { keepId: l1.id, mergeIds: [l2.id] },
      });

      const deleted = await db.select().from(deletedHashes).where(eq(deletedHashes.urlHash, 'h2'));
      expect(deleted).toHaveLength(1);
    });
  });
});
