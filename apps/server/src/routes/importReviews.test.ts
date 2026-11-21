import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex, type SessionImportItem } from '@bukmark/shared';
import type { ImportDecision, ImportReviewItem, ImportView } from '@bukmark/shared/review';
import { buildApp } from '../app.js';
import { runMigrations } from '../db/migrate.js';
import { importSession } from '../links/importSession.js';
import { authCookie, authHeaders, SAME_ORIGIN } from '../test/auth.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const snapshot = 'android-chrome-usb:test';
const group = '/api/imports/' + sha256Hex('session:' + snapshot);
const tab = (id: string, address: string): SessionImportItem => ({
  occurrenceId: id, snapshotId: snapshot, snapshotName: 'Phone import', title: 'A saved page', url: address,
});
const makeDecision = (i: ImportReviewItem, choice: ImportDecision['choice']): ImportDecision =>
  ({ id: i.id, version: i.version, revision: i.revision, choice });

describe('owner import review', () => {
  let app: FastifyInstance;
  let cookies: { bukmark_session: string };
  const get = async () => (await app.inject({ url: group, cookies })).json<ImportView>();
  const post = (items: ImportDecision[]) => app.inject({ method: 'POST', url: group + '/decisions', cookies,
    headers: SAME_ORIGIN, payload: { items } });

  beforeAll(async () => {
    await runMigrations(url);
    app = await buildApp({ databaseUrl: url, checkUpdates: false, checkPages: false, azuk: null });
    return () => app.close();
  });
  beforeEach(async () => {
    await app.db.execute(sql`TRUNCATE links, hubs, owner, sessions, api_tokens CASCADE`);
    cookies = { bukmark_session: (await authCookie(app.db)).cookie };
  });

  it('keeps old snapshots distinct, persists skips and answers, and rejects stale or out-of-group writes atomically', async () => {
    const clearTab = tab('a', 'https://github.com/example/library');
    await importSession(app.db, [clearTab, { ...clearTab, occurrenceId: 'a2' }, tab('b', 'https://example.org/checkout')], false);
    await importSession(app.db, [{ ...tab('c', 'https://example.org/other'), snapshotId: 'second' }], false);
    const rows = (await get()).items;
    expect(rows).toHaveLength(2);
    const clear = rows.find(i => i.state === 'clear')!;
    const question = rows.find(i => i.state === 'question')!;
    const accept = makeDecision(clear, 'accept');
    expect((await post([accept, makeDecision(question, 'accept')])).statusCode).toBe(409);
    expect((await get()).items.every(i => i.revision === 0)).toBe(true);
    const other = (await app.inject({ url: '/api/imports/' + sha256Hex('session:second'), cookies })).json<ImportView>();
    expect((await post([makeDecision(other.items[0]!, 'keep')])).statusCode).toBe(409);
    expect((await post([accept, makeDecision(question, 'skip')])).statusCode).toBe(204);
    expect((await post([accept])).statusCode).toBe(409);
    const skipped = (await get()).items.find(i => i.state === 'skipped')!;
    const answer = { ...makeDecision(skipped, 'answer'), answer: 'Decide on Friday' };
    expect((await post([answer])).statusCode).toBe(204);
    expect((await post([answer])).statusCode).toBe(409);
    const final = (await get()).items;
    expect(final.every(i => i.protected && i.state === 'saved')).toBe(true);
    expect(final.map(i => i.outcome)).toContain('Decide on Friday');
    const feed = await app.inject({ url: '/api/links/changes', cookies });
    expect(feed.json().items).toEqual([]);
    const token = await authHeaders(app.db);
    for (const path of ['/api/imports', group]) expect((await app.inject({ url: path, headers: token })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: group + '/decisions', headers: token, payload: { items: [accept] } })).statusCode).toBe(403);
  });

  it('recognizes all chunks of a file import and carries earlier bookmark decisions into overlapping imports', async () => {
    const fileId = 'a'.repeat(32);
    const group = { importId: fileId, importName: 'My bookmarks.html' };
    for (const url of ['https://github.com/example/first', 'https://example.org/login', 'https://example.org/login']) {
      const r = await app.inject({ method: 'POST', url: '/api/links/import', cookies, headers: SAME_ORIGIN,
        payload: { group, items: [{ url, title: 'Example' }] } });
      expect(r.statusCode).toBe(200);
    }
    const view = (await app.inject({ url: '/api/imports/' + fileId, cookies })).json<ImportView>();
    expect(view.name).toBe(group.importName);
    expect(view.items).toHaveLength(2);
    const clear = view.items.find(i => i.state === 'clear')!;
    expect((await app.inject({ method: 'POST', url: '/api/imports/' + fileId + '/decisions', cookies, headers: SAME_ORIGIN,
      payload: { items: [makeDecision(clear, 'accept')] } })).statusCode).toBe(204);
    await importSession(app.db, [tab('deferred-source', 'https://github.com/example/first')], false);
    expect((await get()).items[0]?.state).toBe('saved');
  });
});
