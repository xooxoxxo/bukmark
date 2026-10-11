import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_RELEASES_URL } from '@bukmark/shared';
import { buildApp } from '../app.js';
import { type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { appSettings } from '../db/schema.js';
import { authHeaders } from '../test/auth.js';
import { patchUpdates, readUpdates, startUpdateChecks } from '../updates/check.js';
import type { UpdatesEnv } from '../updates/feed.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';

const FEED = [
  { tag_name: 'v0.5.0-rc.1', prerelease: true, body: 'Try it.' },
  { tag_name: 'v0.4.0', name: 'bukmark 0.4.0', body: 'Updates in Settings.', html_url: 'https://github.com/xooxoxxo/bukmark/releases/tag/v0.4.0' },
  { tag_name: 'v0.3.0', body: 'Triage first.' },
  { tag_name: 'v0.6.0', draft: true },
];

/** A stand-in for the network: answers from `next` and records what was asked. */
function fakeFetch() {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const state = { next: (): Response => new Response(JSON.stringify(FEED), { status: 200, headers: { etag: '"v1"' } }) };
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    return state.next();
  }) as typeof fetch;
  return { fn, calls, state };
}

describe('updates api', () => {
  let app: FastifyInstance; let db: Db; let headers: { Authorization: string };
  let net: ReturnType<typeof fakeFetch>;
  const apps: FastifyInstance[] = [];

  /** Another app on the same database with a different build or server feed. */
  async function appWith(env: Partial<UpdatesEnv>): Promise<FastifyInstance> {
    const other = await buildApp({ databaseUrl: TEST_URL, checkUpdates: false, updates: { version: '0.3.0', install: 'installer', feed: undefined, fetch: net.fn, ...env } });
    apps.push(other);
    return other;
  }

  beforeAll(async () => {
    await runMigrations(TEST_URL);
    net = fakeFetch();
    app = await buildApp({
      databaseUrl: TEST_URL,
      checkUpdates: false,
      updates: { version: '0.3.0', install: 'installer', feed: undefined, fetch: net.fn },
    });
    db = app.db;
    await db.execute(dsql`TRUNCATE owner, sessions, api_tokens, auth_codes, app_settings CASCADE`);
    headers = await authHeaders(db);
  });
  beforeEach(async () => {
    await db.execute(dsql`TRUNCATE app_settings`);
    net.calls.length = 0;
    net.state.next = () => new Response(JSON.stringify(FEED), { status: 200, headers: { etag: '"v1"' } });
  });
  afterAll(async () => {
    await db.execute(dsql`TRUNCATE owner, sessions, api_tokens, auth_codes, app_settings CASCADE`);
    for (const a of apps) await a.close();
    await app.close();
  });

  it('needs auth', async () => {
    for (const [method, url] of [['GET', '/api/updates'], ['POST', '/api/updates/check'], ['PATCH', '/api/updates']] as const) {
      const res = await app.inject({ method, url, payload: method === 'PATCH' ? { enabled: false } : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
    expect(net.calls).toEqual([]);
  });

  it('reports the running build before any check', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/updates', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      version: '0.3.0', development: false, install: 'installer', enabled: true, lockedByServer: false,
      lastCheckedAt: null, error: null, latest: null, newer: [], skippedVersion: null, updateAvailable: false,
    });
    expect(net.calls).toEqual([]);
  });

  it('checks the feed with one plain GET and finds the newer release', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/updates/check', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ updateAvailable: true, error: null, latest: { version: '0.4.0', name: 'bukmark 0.4.0' } });
    expect(body.newer.map((r: { version: string }) => r.version)).toEqual(['0.4.0']);
    expect(body.lastCheckedAt).toEqual(expect.any(String));
    expect(net.calls).toEqual([{
      url: DEFAULT_RELEASES_URL,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'bukmark-update-check' },
    }]);
    // Drafts are not kept; the prerelease is, for the page to ignore.
    expect((await readUpdates(db)).lastCheck?.releases.map((r) => r.version)).toEqual(['0.5.0-rc.1', '0.4.0', '0.3.0']);
  });

  it('sends the stored etag and keeps the releases on 304', async () => {
    await app.inject({ method: 'POST', url: '/api/updates/check', headers });
    const first = await readUpdates(db);
    // Age the check past the "Check now" gap.
    await patchUpdates(db, { lastCheck: { ...first.lastCheck!, at: new Date(Date.now() - 120_000).toISOString() } });
    net.state.next = () => new Response(null, { status: 304 });

    const res = await app.inject({ method: 'POST', url: '/api/updates/check', headers });
    expect(net.calls[1]?.headers['If-None-Match']).toBe('"v1"');
    expect(res.json()).toMatchObject({ updateAvailable: true, error: null, latest: { version: '0.4.0' } });
    const after = await readUpdates(db);
    expect(after.lastCheck?.etag).toBe('"v1"');
    expect(after.lastCheck?.releases).toEqual(first.lastCheck?.releases);
    expect(Date.parse(after.lastCheck!.at)).toBeGreaterThan(Date.now() - 10_000);
  });

  it('stores a failed check as a short error and keeps the last releases', async () => {
    await app.inject({ method: 'POST', url: '/api/updates/check', headers });
    const first = await readUpdates(db);
    await patchUpdates(db, { lastCheck: { ...first.lastCheck!, at: new Date(Date.now() - 120_000).toISOString() } });
    net.state.next = () => new Response('rate limited', { status: 403 });

    const res = await app.inject({ method: 'POST', url: '/api/updates/check', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ error: 'the feed answered 403', updateAvailable: true, latest: { version: '0.4.0' } });

    net.state.next = () => { throw new TypeError('fetch failed'); };
    await patchUpdates(db, { lastCheck: { ...(await readUpdates(db)).lastCheck!, at: new Date(Date.now() - 120_000).toISOString() } });
    const down = await app.inject({ method: 'POST', url: '/api/updates/check', headers });
    expect(down.json().error).toBe('fetch failed');

    // The error stays on the status until the next check.
    const get = await app.inject({ method: 'GET', url: '/api/updates', headers });
    expect(get.json().error).toBe('fetch failed');
  });

  it('fetches at most once a minute on "Check now"', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/updates/check', headers });
    const second = await app.inject({ method: 'POST', url: '/api/updates/check', headers });
    expect(net.calls.length).toBe(1);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
  });

  it('skips a version and stops skipping', async () => {
    await app.inject({ method: 'POST', url: '/api/updates/check', headers });
    const skip = await app.inject({ method: 'PATCH', url: '/api/updates', headers, payload: { skippedVersion: 'v0.4.0' } });
    expect(skip.statusCode).toBe(200);
    expect(skip.json()).toMatchObject({ skippedVersion: '0.4.0', updateAvailable: false });
    expect(skip.json().newer).toHaveLength(1);

    const unskip = await app.inject({ method: 'PATCH', url: '/api/updates', headers, payload: { skippedVersion: null } });
    expect(unskip.json()).toMatchObject({ skippedVersion: null, updateAvailable: true });
    // The skip did not wipe the stored check.
    expect((await readUpdates(db)).lastCheck?.releases).toHaveLength(3);
  });

  // An empty string is not in the list: Fastify's coercion reads it as null (stop skipping).
  it('rejects a bad body', async () => {
    for (const payload of [{ enabled: 'yes' }, { skippedVersion: '   ' }, { skippedVersion: 'x'.repeat(65) }]) {
      const res = await app.inject({ method: 'PATCH', url: '/api/updates', headers, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('turns checks off and on', async () => {
    await app.inject({ method: 'POST', url: '/api/updates/check', headers });
    const off = await app.inject({ method: 'PATCH', url: '/api/updates', headers, payload: { enabled: false } });
    expect(off.json()).toMatchObject({ enabled: false, updateAvailable: false, latest: null, newer: [] });

    const check = await app.inject({ method: 'POST', url: '/api/updates/check', headers });
    expect(check.statusCode).toBe(409);
    expect(net.calls.length).toBe(1);

    const on = await app.inject({ method: 'PATCH', url: '/api/updates', headers, payload: { enabled: true } });
    expect(on.json()).toMatchObject({ enabled: true, updateAvailable: true });
  });

  it('refuses to change checks when BUKMARK_UPDATE_FEED sets them', async () => {
    const locked = await appWith({ feed: 'off' });
    const status = await locked.inject({ method: 'GET', url: '/api/updates', headers });
    expect(status.json()).toMatchObject({ enabled: false, lockedByServer: true });
    const res = await locked.inject({ method: 'PATCH', url: '/api/updates', headers, payload: { enabled: true } });
    expect(res.statusCode).toBe(409);
    expect(await readUpdates(db)).toEqual({});
    // Skipping a version is still the owner's call.
    const skip = await locked.inject({ method: 'PATCH', url: '/api/updates', headers, payload: { skippedVersion: '0.4.0' } });
    expect(skip.statusCode).toBe(200);

    const custom = await appWith({ feed: 'https://releases.example.test/bukmark' });
    const res2 = await custom.inject({ method: 'PATCH', url: '/api/updates', headers, payload: { enabled: false } });
    expect(res2.statusCode).toBe(409);
    await custom.inject({ method: 'POST', url: '/api/updates/check', headers });
    expect(net.calls.map((c) => c.url)).toEqual(['https://releases.example.test/bukmark']);
  });

  it('reports a development build and its install method', async () => {
    const dev = await appWith({ version: 'dev', install: 'source' });
    const res = await dev.inject({ method: 'POST', url: '/api/updates/check', headers });
    expect(res.json()).toMatchObject({ version: 'dev', development: true, install: 'source', updateAvailable: false, newer: [] });
    expect(res.json().latest.version).toBe('0.4.0');
    const unknown = await appWith({ install: undefined });
    expect((await unknown.inject({ method: 'GET', url: '/api/updates', headers })).json().install).toBe('unknown');
  });

  it('checks in the background when due, and not again before 12 h', async () => {
    const bg = await buildApp({ databaseUrl: TEST_URL, checkUpdates: false });
    const env: UpdatesEnv = { version: '0.3.0', install: 'installer', feed: undefined, fetch: net.fn };
    startUpdateChecks(bg, env, { firstDelayMs: 1, intervalMs: 20 });
    await expect.poll(async () => (await readUpdates(db)).lastCheck?.at ?? null).not.toBeNull();
    await new Promise((r) => setTimeout(r, 100));
    await bg.close();
    expect(net.calls.length).toBe(1);
  });

  it('keeps settings in one app_settings row', async () => {
    await app.inject({ method: 'PATCH', url: '/api/updates', headers, payload: { skippedVersion: '0.4.0' } });
    await app.inject({ method: 'PATCH', url: '/api/updates', headers, payload: { enabled: false } });
    const rows = await db.select().from(appSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'updates', value: { skippedVersion: '0.4.0', enabled: false } });
  });
});
