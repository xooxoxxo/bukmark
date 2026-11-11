import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { matchKey, normalizeUrl, sha256Hex } from '@bukmark/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { runMigrations } from '../db/migrate.js';
import { captures, deletedHashes, links } from '../db/schema.js';
import { authHeaders } from '../test/auth.js';

const testUrl = process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const item = (occurrenceId: string, url: string) => ({
  snapshotId: 'backup-1', occurrenceId, snapshotName: 'Reading', groupName: 'Research', position: 3, url,
});

describe('session import', () => {
  let app: FastifyInstance;
  let headers: { Authorization: string };
  const fetchOgImage = vi.fn(async () => null);
  const checkPage = vi.fn(async (url: string) => ({ url, html: null, status: 200, error: null }));

  beforeAll(async () => {
    await runMigrations(testUrl);
    app = await buildApp({ databaseUrl: testUrl, fetchOgImage, checkPage, checkPages: true, checkUpdates: false });
    await app.db.execute(sql`TRUNCATE owner, sessions, api_tokens, auth_codes CASCADE`);
    headers = await authHeaders(app.db);
  });
  beforeEach(async () => {
    await app.db.execute(sql`TRUNCATE links, deleted_hashes, link_deletions CASCADE`);
    vi.clearAllMocks();
  });
  afterAll(async () => { if (app) await app.close(); });

  function send(items: ReturnType<typeof item>[], preview = false) {
    return app.inject({ method: 'POST', url: '/api/links/session-import', headers, payload: { items, preview } });
  }

  it('merges URL variants while retaining one capture for each occurrence across retries', async () => {
    const first = item('tab-1', 'https://example.test/post#section');
    const second = item('tab-2', 'http://m.example.test/post/');
    expect((await send([first])).json()).toMatchObject({ createdLinks: 1, recorded: 1 });
    expect((await send([first, second])).json()).toMatchObject({ createdLinks: 0, recorded: 1, alreadyRecorded: 1 });
    const [link] = await app.db.select().from(links);
    const rows = await app.db.select().from(captures).where(eq(captures.linkId, link!.id));
    expect(rows.map(row => row.originalUrl).sort()).toEqual([second.url, first.url]);
    expect(rows[0]).toMatchObject({ groupHint: 'Reading / Research', raw: { snapshotId: 'backup-1', position: 3 } });
    expect(link).toMatchObject({ sessionProtected: true, dupeCount: 1 });
  });

  it('previews existing and deleted bookmarks without a write and preserves existing fields on import', async () => {
    const existing = normalizeUrl('https://example.test/existing');
    const deleted = normalizeUrl('https://example.test/deleted');
    if (!existing.ok || !deleted.ok) throw new Error('invalid fixture');
    await app.db.insert(links).values({ url: existing.url, urlHash: existing.urlHash, matchKey: matchKey(existing.url),
      title: 'Curated title', note: 'Curated note', status: 'archived' });
    await app.db.insert(deletedHashes).values({ urlHash: deleted.urlHash });
    const inputs = [item('tab-1', existing.url), item('tab-2', deleted.url), item('tab-3', 'https://user:pw@example.test')];
    const preview = await send(inputs, true);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ recorded: 1, alreadyLinked: 1, existingProcessingEnabled: 1, skippedDeleted: 1, invalid: 1 });
    expect(await app.db.select().from(captures)).toHaveLength(0);

    expect((await send(inputs)).json()).toMatchObject({ recorded: 1, createdLinks: 0, skippedDeleted: 1, invalid: 1 });
    const rows = await app.db.select().from(links);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Curated title', note: 'Curated note', status: 'archived', sessionProtected: false });
  });

  it('preserves long tab URLs while matching their variants', async () => {
    const path = Array.from({ length: 80 }, (_, index) => sha256Hex(`session-url-${index}`)).join('');
    const first = item('tab-1', `https://example.test/${path}`);
    const variant = item('tab-2', `http://m.example.test/${path}/`);
    expect((await send([first])).json()).toMatchObject({ createdLinks: 1, recorded: 1 });
    expect((await send([variant])).json()).toMatchObject({ createdLinks: 0, alreadyLinked: 1, recorded: 1 });
    const rows = await app.db.select().from(captures);
    expect(rows.map(row => row.originalUrl).sort()).toEqual([first.url, variant.url].sort());
    expect(new Set(rows.map(row => row.linkId)).size).toBe(1);
  });

  it('reports new bookmark and occurrence counts in preview without writing anything', async () => {
    const inputs = [item('tab-1', 'https://example.test/new#section'), item('tab-2', 'http://m.example.test/new/')];
    const result = await send(inputs, true);
    expect(result.json()).toMatchObject({ createdLinks: 1, recorded: 2, alreadyLinked: 0 });
    expect(await app.db.select().from(links)).toHaveLength(0);
    expect(await app.db.select().from(captures)).toHaveLength(0);
  });

  it('verifies only the exact stored occurrence and source metadata', async () => {
    const stored = item('tab-1', 'https://example.test/post#section');
    const verify = (items: typeof stored[]) => app.inject({
      method: 'POST', url: '/api/links/session-import/verify', headers, payload: { items },
    });
    expect((await verify([stored])).json()).toEqual({ verified: [] });
    expect((await send([stored])).statusCode).toBe(200);
    const result = await verify([stored, { ...stored, position: 4 }, { ...stored, url: 'https://example.test/post' }]);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ verified: [{ snapshotId: stored.snapshotId,
      occurrenceId: stored.occurrenceId, urlHash: sha256Hex(stored.url) }] });
  });

  it('skips page checks, preview backfill and sync until the owner enables processing', async () => {
    const input = item('tab-1', 'https://example.test/private');
    expect((await send([input])).statusCode).toBe(200);
    const [link] = await app.db.select().from(links);
    const check = () => app.inject({ method: 'POST', url: '/api/links/check', headers, payload: {} });
    const backfill = () => app.inject({ method: 'POST', url: '/api/links/og-backfill', headers, payload: {} });
    const changes = () => app.inject({ method: 'GET', url: '/api/links/changes', headers });
    expect((await check()).json()).toEqual({ processed: 0, remaining: 0 });
    expect((await backfill()).json()).toEqual({ processed: 0, remaining: 0 });
    expect((await changes()).json().items).toEqual([]);
    expect(checkPage).not.toHaveBeenCalled();
    expect(fetchOgImage).not.toHaveBeenCalled();

    const enabled = await app.inject({ method: 'PATCH', url: `/api/links/${link!.id}`, headers, payload: { sessionProtected: false } });
    expect(enabled.statusCode).toBe(200);
    expect((await changes()).json().items).toMatchObject([{ id: link!.id, url: input.url }]);
    expect((await backfill()).json().processed).toBe(1);
    expect((await check()).json().processed).toBe(1);
    expect(fetchOgImage).toHaveBeenCalledWith(input.url);
    expect(checkPage).toHaveBeenCalledWith(input.url);
  });
});
