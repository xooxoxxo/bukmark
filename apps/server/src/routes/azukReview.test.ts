import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createAzukClient, type AzukItem, type AzukWatch, type WatchTrigger } from '../azuk/client.js';
import { runAzukDelivery } from '../azuk/delivery.js';
import { runMigrations } from '../db/migrate.js';
import { authCookie, SAME_ORIGIN } from '../test/auth.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const LISTING = 'https://www.amazon.de/dp/B000000001';
const list = { id: randomUUID(), name: 'Bookmarkt test', kind: 'shopping' };

function fakeAzuk() {
  const items: AzukItem[] = [];
  const watches: AzukWatch[] = [];
  const posts = { item: 0, watch: 0 };
  let loseResponse: 'item' | 'watch' | null = null;
  let rejectWatch = false;
  let hideList = false;
  const client = createAzukClient('https://azuk.example', 'test-token', async (input, init) => {
    const url = new URL(String(input));
    const { pathname } = url;
    if (pathname === '/api/lists') return Response.json(hideList ? [] : [list]);
    if (pathname.endsWith('/items')) {
      if (init?.method === 'GET') return Response.json(items);
      posts.item++;
      const { text, note, status } = JSON.parse(String(init?.body));
      const item = { id: randomUUID(), list_id: list.id, text, note, status };
      items.push(item);
      if (loseResponse === 'item') throw new Error('Response lost after commit');
      return Response.json(item, { status: 201 });
    }
    if (pathname === '/api/watches') {
      if (init?.method === 'GET') return Response.json(watches);
      posts.watch++;
      if (rejectWatch) return Response.json({}, { status: 403 });
      const { url: listing, tier, notify, triggers } = JSON.parse(String(init?.body));
      const watch = {
        id: randomUUID(), source: 'url', status: 'active', tier, notify_scope: notify,
        last_checked_at: null, triggers,
        targets: [{ url: listing, last_price: null, last_currency: null, last_observed_at: null, status: 'pending' }],
      };
      watches.push(watch);
      if (loseResponse === 'watch') throw new Error('Response lost after commit');
      return Response.json(watch, { status: 201 });
    }
    return Response.json(watches.find((watch) => pathname === `/api/watches/${watch.id}`) ?? null);
  })!;
  return {
    client, items, watches, posts,
    lose: (step: typeof loseResponse) => { loseResponse = step; },
    blockWatch: (value: boolean) => { rejectWatch = value; },
    hideList: () => { hideList = true; },
  };
}

describe('Azuk handoff from review', () => {
  let app: FastifyInstance;
  let remote: ReturnType<typeof fakeAzuk>;
  let cookies: { bukmark_session: string };

  beforeAll(async () => { await runMigrations(TEST_URL); });
  beforeEach(async () => {
    remote = fakeAzuk();
    app = await buildApp({ databaseUrl: TEST_URL, fetchOgImage: async () => null, azuk: remote.client, azukWorker: false });
    await app.db.execute(sql`TRUNCATE links, azuk_deliveries, owner, sessions, api_tokens CASCADE`);
    cookies = { bukmark_session: (await authCookie(app.db)).cookie };
    return async () => { await app.close(); };
  });

  async function request(method: 'GET' | 'POST', url: string, payload?: object) {
    const response = await app.inject({ method, url, payload, cookies, headers: SAME_ORIGIN });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function prepare(url = 'https://amazon.de/Instrument/dp/B000000001/ref=demo?tag=tracking') {
    const { link } = await request('POST', '/api/links', { url, title: 'Controller', note: 'Keep this note local' });
    await request('POST', '/api/review/prepare', { linkId: link.id });
    const [proposal] = (await request('GET', `/api/review?linkId=${link.id}`)).items;
    const options = await request('GET', '/api/review/azuk/lists');
    expect(options).toMatchObject({ status: 'ready', lists: [list] });
    return {
      linkId: link.id as string, id: proposal.id as string, revision: proposal.revision as number,
      sourceVersion: proposal.sourceVersion as string, decision: 'approve' as const,
      azuk: { connection: options.connection as string, listId: list.id, listName: list.name,
        listingUrl: proposal.listingUrl as string, productName: 'Controller' },
    };
  }

  async function delivery() {
    const result = await request('GET', '/api/review/azuk/deliveries');
    expect(result.items).toHaveLength(1);
    return result.items[0];
  }

  async function approve(item: Awaited<ReturnType<typeof prepare>>) {
    return (await request('POST', '/api/review/decisions', { items: [item] })).items[0].outcome as string;
  }

  it('queues one approved delivery and creates one item and exact watch under concurrency', async () => {
    const item = await prepare();
    expect(item.azuk.listingUrl).toBe(LISTING);
    expect((await Promise.all([approve(item), approve(item)])).sort()).toEqual(['changed', 'saved']);
    expect(remote.posts).toEqual({ item: 0, watch: 0 });
    expect((await Promise.all([runAzukDelivery(app.db, remote.client), runAzukDelivery(app.db, remote.client)])).sort())
      .toEqual([false, true]);
    expect(remote.items).toEqual([{ id: expect.any(String), list_id: list.id, text: 'Controller [amazon.de B000000001]', note: LISTING, status: 'open' }]);
    expect(remote.watches).toEqual([expect.objectContaining({
      source: 'url', tier: 'passive', notify_scope: 'creator', triggers: [{ type: 'drop_pct', pct: 10 }],
      targets: [expect.objectContaining({ url: LISTING })],
    })]);
    expect(await delivery()).toMatchObject({ status: 'delivered', itemId: remote.items[0]!.id,
      watchId: remote.watches[0]!.id, watch: { observation: null, settingsMatch: true } });
    const alias = await prepare('https://www.amazon.de/dp/B000000001');
    expect(await approve(alias)).toBe('existing');
    expect((await request('GET', `/api/review/azuk/deliveries?linkId=${alias.linkId}`)).items).toHaveLength(1);
    expect(remote.posts).toEqual({ item: 1, watch: 1 });
  });

  it('reconciles lost item and watch responses without sending either POST twice', async () => {
    await approve(await prepare());
    remote.lose('item');
    await runAzukDelivery(app.db, remote.client);
    const first = await delivery();
    expect(first).toMatchObject({ status: 'needs_review', itemId: null, watchId: null });
    const retry = () => request('POST', `/api/review/azuk/deliveries/${first.id}/retry`);
    remote.lose('watch');
    expect(await retry()).toEqual({ outcome: 'queued' });
    await runAzukDelivery(app.db, remote.client);
    expect(await delivery()).toMatchObject({ status: 'needs_review', itemId: remote.items[0]!.id, watchId: null });
    remote.lose(null);
    expect(await retry()).toEqual({ outcome: 'queued' });
    await runAzukDelivery(app.db, remote.client);
    expect(await delivery()).toMatchObject({ status: 'delivered', itemId: remote.items[0]!.id, watchId: remote.watches[0]!.id });
    expect(await retry()).toEqual({ outcome: 'unchanged' });
    expect(remote.posts).toEqual({ item: 1, watch: 1 });
  });

  it('stops after finding a bought item during a watch retry', async () => {
    await approve(await prepare());
    remote.blockWatch(true);
    await runAzukDelivery(app.db, remote.client);
    const first = await delivery();
    expect(first).toMatchObject({ status: 'failed', itemId: remote.items[0]!.id, watchId: null });
    remote.items[0]!.status = 'bought';
    remote.blockWatch(false);
    await request('POST', `/api/review/azuk/deliveries/${first.id}/retry`);
    await runAzukDelivery(app.db, remote.client);
    expect(await delivery()).toMatchObject({ status: 'stopped', itemId: remote.items[0]!.id, watchId: null });
    expect(remote.watches).toEqual([]);
    expect(remote.posts).toEqual({ item: 1, watch: 1 });
  });

  it('shows the real settings and later price of an existing exact watch', async () => {
    const item = await prepare();
    const trigger: WatchTrigger = { type: 'price_below', price: '100.00', currency: 'EUR' };
    const existing = await remote.client.addWatch(LISTING, 'Existing', trigger);
    await approve(item);
    await runAzukDelivery(app.db, remote.client);
    const saved = await delivery();
    expect(saved).toMatchObject({ watchId: existing.id, watch: { settingsMatch: false, triggers: [trigger], observation: null } });
    const at = '2026-11-08T10:00:00Z';
    Object.assign(remote.watches[0]!.targets[0]!, { last_price: '99.90', last_currency: 'EUR', last_observed_at: at, status: 'ok' });
    expect(await request('POST', `/api/review/azuk/deliveries/${saved.id}/refresh`)).toEqual({ outcome: 'refreshed' });
    expect(await delivery()).toMatchObject({ watch: { observation: { price: '99.90', currency: 'EUR', at } } });
    expect(remote.posts).toEqual({ item: 1, watch: 1 });
  });

  it('rejects an approval when the selected list disappears', async () => {
    const item = await prepare();
    remote.hideList();
    expect(await approve(item)).toBe('destination');
    expect((await request('GET', '/api/review/azuk/deliveries')).items).toEqual([]);
    expect(remote.posts).toEqual({ item: 0, watch: 0 });
  });
});
