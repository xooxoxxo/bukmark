import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeUrl } from '../../../../packages/shared/src/normalize';
import type { Auth } from './auth';
import type { SyncReply, SyncState } from './sync';
import {
  browserStarts,
  fakeChrome,
  fireAlarm,
  startBackground,
  stopBackground,
  stubFetch,
  type FakeChrome,
  type FakeRequest,
} from '../test/chrome';
import { FakeServer } from '../test/server';

const SERVER = 'http://nas.lan:3000';
const AUTH: Auth = { token: 'bkm_sync', tokenId: 't1', server: SERVER, name: 'bukmark capture', createdAt: 1 };

let chrome: FakeChrome;
let server: FakeServer;
let requests: FakeRequest[];

async function start(browser: 'chrome' | 'firefox' = 'chrome'): Promise<void> {
  chrome = fakeChrome({ browser, local: { auth: AUTH }, sync: { baseUrl: SERVER } });
  vi.stubGlobal('chrome', chrome);
  server = new FakeServer();
  requests = stubFetch(server.route);
  await startBackground(chrome);
}

/** Lets every event, push and pull run to the end. */
async function quiet(): Promise<void> {
  for (let i = 0; i < 200; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

async function ask(action: 'enable' | 'disable' | 'pull'): Promise<SyncReply> {
  const reply = (await chrome.runtime.sendMessage({ type: 'sync', action })) as SyncReply;
  await quiet();
  return reply;
}

const tree = () => chrome.bookmarks.tree;
const state = () => chrome.storage.local.data.sync as SyncState;
const root = () => tree().at('bukmark')!;
/** The bukmark folder at a glance: each subfolder, and "title → url" for each bookmark. */
const folder = () => tree().outline(root().id);
const sent = () => requests.map((r) => `${r.method} ${new URL(r.url).pathname}`);
/** Requests after the first n. */
const since = (n: number) => sent().slice(n);
const person = () => tree();

afterEach(() => { vi.unstubAllGlobals(); });

describe('turning sync on', () => {
  it('fills a bukmark folder in Other bookmarks: a folder per hub, Unsorted for links in none', async () => {
    await start();
    server.add('https://a.com/', 'A', ['dev']);
    server.add('https://b.com/', 'B', ['dev', 'rust']);
    server.add('https://c.com/', 'C');
    server.add('https://gone.com/', 'Gone', ['dev'], 'archived');

    expect(await ask('enable')).toEqual({ ok: true });
    expect(root().parentId).toBe('2');
    expect(folder()).toEqual({
      dev: { '*': ['A → https://a.com/', 'B → https://b.com/'] },
      rust: { '*': ['B → https://b.com/'] },
      Unsorted: { '*': ['C → https://c.com/'] },
    });
    expect(state()).toMatchObject({ enabled: true, server: SERVER, full: false, queue: [], error: null });
    expect(Object.keys(state().links)).toHaveLength(3);
    // First after a minute, then every five.
    expect(chrome.alarms.create).toHaveBeenCalledWith('bukmark-sync', { delayInMinutes: 1, periodInMinutes: 5 });
    expect(chrome.alarms.data.get('bukmark-sync')).toMatchObject({ periodInMinutes: 5 });
  });
});

/** Sync on, over a server with links in dev, dev+rust and none. */
async function synced(browser: 'chrome' | 'firefox' = 'chrome') {
  await start(browser);
  const a = server.add('https://a.com/', 'A', ['dev']);
  const b = server.add('https://b.com/', 'B', ['dev', 'rust']);
  const c = server.add('https://c.com/', 'C');
  expect(await ask('enable')).toEqual({ ok: true });
  const dev = tree().at('bukmark', 'dev')!.id;
  const rust = tree().at('bukmark', 'rust')!.id;
  const unsorted = tree().at('bukmark', 'Unsorted')!.id;
  return { a, b, c, dev, rust, unsorted, before: requests.length };
}

const bookmarkIn = (folderId: string, title: string) => tree().child(folderId, title)!;

describe('turning sync on, more', () => {
  it('uses Firefox’s Other Bookmarks (unfiled_____)', async () => {
    await start('firefox');
    server.add('https://a.com/', 'A', ['dev']);
    await ask('enable');
    expect(root().parentId).toBe('unfiled_____');
    expect(folder()).toEqual({ dev: { '*': ['A → https://a.com/'] } });
  });

  it('reads the feed page by page', async () => {
    await start();
    server.pageSize = 2;
    for (const n of [1, 2, 3, 4, 5]) server.add(`https://${n}.com/`, `L${n}`);
    await ask('enable');
    expect((folder().Unsorted as { '*': string[] })['*']).toHaveLength(5);
    const sinces = requests.filter((r) => r.url.includes('/changes')).map((r) => new URL(r.url).searchParams.get('since'));
    // `since` is inclusive, so each page starts with the last one's final link again.
    const stamps = [...server.links.values()].map((l) => l.updatedAt);
    expect(sinces).toEqual([null, stamps[1], stamps[2], stamps[3]]);
    expect(state().cursor).toBe(stamps[4]);
    expect(Object.keys(state().links)).toHaveLength(5);
  });

  it('takes up a bukmark folder that is already there, matching its bookmarks by address', async () => {
    await start();
    server.add('https://a.com/page', 'A', ['dev']);
    const old = person().create({ parentId: '2', title: 'bukmark' });
    const dev = person().create({ parentId: old.id, title: 'dev' });
    const kept = person().create({ parentId: dev.id, title: 'A', url: 'https://www.A.com/page?utm_source=x' });
    person().create({ parentId: dev.id, title: 'New here', url: 'https://new.com/' });
    await quiet();

    await ask('enable');
    expect(root().id).toBe(old.id);
    expect(tree().child('2', 'bukmark')!.id).toBe(old.id);
    // The same bookmark, left at the address it had: it is the same link.
    expect(Object.values(state().links).find((l) => l.url === 'https://a.com/page')?.bookmarkIds).toEqual([kept.id]);
    expect(bookmarkIn(dev.id, 'A').url).toBe('https://www.A.com/page?utm_source=x');
    // One the server never had is sent, into the hub of its folder.
    expect(server.view(server.byUrl('https://new.com/'))).toEqual({ url: 'https://new.com/', title: 'New here', status: 'active', hubs: ['dev'] });
    expect(tree().outline(dev.id)['*']).toHaveLength(2);
  });

  it('turned off and on again: the server wins for the links it has, and bookmarks added meanwhile are sent', async () => {
    const { a, dev } = await synced();
    await ask('disable');
    server.edit(a, { title: 'A renamed' });
    person().create({ parentId: dev, title: 'Meanwhile', url: 'https://meanwhile.com/' });
    await quiet();
    expect(server.byUrl('https://meanwhile.com/')).toBeUndefined();

    await ask('enable');
    expect(tree().outline(dev)['*']).toEqual(['A renamed → https://a.com/', 'B → https://b.com/', 'Meanwhile → https://meanwhile.com/']);
    expect(server.view(server.byUrl('https://meanwhile.com/'))?.hubs).toEqual(['dev']);
    expect(tree().child('2', 'bukmark')).toBeDefined();
    expect(tree().outline('2')).toEqual({ bukmark: folder() });
  });

  it('says so when the browser has not given access to bookmarks', async () => {
    chrome = fakeChrome({ local: { auth: AUTH }, sync: { baseUrl: SERVER }, without: ['bookmarks'] });
    vi.stubGlobal('chrome', chrome);
    requests = stubFetch(() => ({ body: {} }));
    await startBackground(chrome);
    expect(await ask('enable')).toEqual({ ok: false, error: 'Not turned on — access to your bookmarks was declined.' });
    expect(requests).toHaveLength(0);
  });

  it('needs a login', async () => {
    await start();
    await chrome.storage.local.remove('auth');
    expect(await ask('enable')).toEqual({ ok: false, error: 'Log in to sync.' });
    expect(tree().child('2', 'bukmark')).toBeUndefined();
  });

  it('asks an old server to update when it has no changes feed, and stays off', async () => {
    await start();
    requests = stubFetch(({ url }) => (url.includes('/changes') ? { status: 404, body: { error: 'Not Found' } } : server.route({} as FakeRequest)));
    expect(await ask('enable')).toEqual({ ok: false, error: "Update your bukmark server — nas.lan:3000 can't sync bookmarks yet." });
    expect(state().error).toBe("Update your bukmark server — nas.lan:3000 can't sync bookmarks yet.");
    // Off, so nothing the person does in a folder is sent to a server that can't file it.
    expect(state().enabled).toBe(false);
    expect(chrome.alarms.data.has('bukmark-sync')).toBe(false);
    expect(tree().child('2', 'bukmark')).toBeUndefined();
  });
});

describe('pulling the server’s changes', () => {
  it('asks only for what changed since the last pull, and applies titles, hubs, archiving and deletion', async () => {
    const { a, b, c } = await synced();
    const d = server.add('https://d.com/', 'D', ['rust']);
    server.edit(a, { title: 'A2' });
    server.edit(b, { hubs: ['rust'] });
    server.edit(c, { status: 'archived' });
    const cursor = state().cursor;
    expect(await ask('pull')).toEqual({ ok: true });

    expect(new URL(requests.at(-1)!.url).searchParams.get('since')).toBe(cursor);
    expect(folder()).toEqual({
      dev: { '*': ['A2 → https://a.com/'] },
      rust: { '*': ['B → https://b.com/', 'D → https://d.com/'] },
    });

    server.remove(d);
    await ask('pull');
    expect(folder()).toEqual({ dev: { '*': ['A2 → https://a.com/'] }, rust: { '*': ['B → https://b.com/'] } });
    expect(state().links[d.id]).toBeUndefined();
  });

  it('follows a hub renamed on the server, and takes away the folder it emptied', async () => {
    await synced();
    server.renameHub(server.hubByName('dev')!, 'code');
    await ask('pull');
    // A new hub folder goes before Unsorted.
    expect(Object.keys(folder())).toEqual(['rust', 'code', 'Unsorted']);
    expect(folder().code).toEqual({ '*': ['A → https://a.com/', 'B → https://b.com/'] });
    expect(state().hubFolders).not.toHaveProperty('dev');
  });

  it('moves the links of a hub archived on the server to Unsorted, or to their other hubs', async () => {
    await synced();
    server.setHubStatus(server.hubByName('dev')!, 'archived');
    await ask('pull');
    expect(folder()).toEqual({
      rust: { '*': ['B → https://b.com/'] },
      Unsorted: { '*': ['C → https://c.com/', 'A → https://a.com/'] },
    });
  });

  it('keeps one bookmark per folder: a moved link’s bookmark is moved, not made again', async () => {
    const { a, dev } = await synced();
    const before = bookmarkIn(dev, 'A').id;
    server.edit(a, { hubs: ['rust'] });
    await ask('pull');
    expect(bookmarkIn(tree().at('bukmark', 'rust')!.id, 'A').id).toBe(before);
  });

  it('makes the folder again when it is gone, without touching the server', async () => {
    await synced();
    const count = requests.length;
    person().remove(root().id, true);
    await quiet();
    expect(since(count)).toEqual([]);
    await ask('pull');
    expect(Object.keys(folder())).toEqual(['dev', 'rust', 'Unsorted']);
  });

  it('leaves every bookmark outside the folder alone', async () => {
    await start();
    const bar = person().create({ parentId: '1', title: 'Mine', url: 'https://a.com/' });
    const other = person().create({ parentId: '2', title: 'Also mine', url: 'https://b.com/' });
    server.add('https://a.com/', 'A', ['dev']);
    server.add('https://b.com/', 'B', ['dev'], 'archived');
    await ask('enable');
    expect(tree().child('1', 'Mine')?.id).toBe(bar.id);
    expect(tree().child('2', 'Also mine')?.id).toBe(other.id);
    expect(server.byUrl('https://b.com/')!.status).toBe('archived');
  });

  it('pulls on the alarm, when the browser starts, and after a save with the keyboard shortcut', async () => {
    await synced();
    server.add('https://alarm.com/', 'Alarm');
    fireAlarm(chrome, 'bukmark-sync');
    await quiet();
    expect(JSON.stringify(folder())).toContain('https://alarm.com/');

    server.add('https://startup.com/', 'Startup');
    browserStarts(chrome);
    await quiet();
    expect(JSON.stringify(folder())).toContain('https://startup.com/');

    chrome.tabs.query.mockResolvedValue([{ url: 'https://saved.com/', title: 'Saved' }]);
    const { saveActiveTab } = await import('../background/handlers');
    await saveActiveTab();
    await quiet();
    expect((folder().Unsorted as { '*': string[] })['*']).toContain('Saved → https://saved.com/');
  });

  it('sets the alarm again where the browser forgot it, as Firefox does on restart', async () => {
    await synced('firefox');
    chrome.alarms.data.clear();
    stopBackground(chrome);
    await startBackground(chrome);
    await quiet();
    expect(chrome.alarms.data.get('bukmark-sync')).toMatchObject({ periodInMinutes: 5 });
  });

  it('stops asking when the feed does not move', async () => {
    await synced();
    requests = stubFetch(({ url }) => (url.includes('/changes')
      ? { body: { items: [], deleted: [], cursor: state().cursor, more: true } }
      : { body: {} }));
    expect(await ask('pull')).toEqual({ ok: true });
    expect(requests).toHaveLength(1);
  });
});

describe('pushing what the person changes in the folder', () => {
  it('sends a bookmark made in a hub folder as a link in that hub, at once', async () => {
    const { dev, before } = await synced();
    const made = person().create({ parentId: dev, title: 'New', url: 'https://new.com/x#top' });
    await quiet();
    expect(since(before)).toEqual(['POST /api/links']);
    expect(requests.at(-1)!.body).toEqual({ url: 'https://new.com/x#top', title: 'New', hub: 'dev' });
    const link = server.byUrl('https://new.com/x')!;
    expect(server.view(link)).toMatchObject({ status: 'active', hubs: ['dev'] });
    expect(state().links[link.id]).toEqual({ url: 'https://new.com/x', title: 'New', bookmarkIds: [made.id] });
  });

  it('sends one made in Unsorted, or loose in the bukmark folder, without a hub', async () => {
    const { unsorted } = await synced();
    person().create({ parentId: unsorted, title: 'U', url: 'https://u.com/' });
    person().create({ parentId: root().id, title: 'Loose', url: 'https://loose.com/' });
    await quiet();
    expect(requests.slice(-2).map((r) => r.body)).toEqual([
      { url: 'https://u.com/', title: 'U' },
      { url: 'https://loose.com/', title: 'Loose' },
    ]);
    // The next pull files the loose one under Unsorted.
    await ask('pull');
    expect(tree().child(root().id, 'Loose')).toBeUndefined();
    expect((folder().Unsorted as { '*': string[] })['*']).toContain('Loose → https://loose.com/');
  });

  it('ignores bookmarks that are not web pages, and everything outside the folder', async () => {
    const { dev, before } = await synced();
    person().create({ parentId: dev, title: 'Bookmarklet', url: 'javascript:alert(1)' });
    person().create({ parentId: dev, title: 'File', url: 'file:///etc/hosts' });
    person().create({ parentId: '1', title: 'Bar', url: 'https://bar.com/' });
    const deep = person().create({ parentId: dev, title: 'Deeper' });
    person().create({ parentId: deep.id, title: 'Deep', url: 'https://deep.com/' });
    person().update(bookmarkIn('1', 'Bar').id, { title: 'Bar 2' });
    await quiet();
    expect(since(before)).toEqual([]);
  });

  it('sends a new title', async () => {
    const { a, dev, before } = await synced();
    person().update(bookmarkIn(dev, 'A').id, { title: 'A, better' });
    await quiet();
    expect(since(before)).toEqual(['PATCH /api/links/' + a.id]);
    expect(requests.at(-1)!.body).toEqual({ title: 'A, better' });
    expect(server.links.get(a.id)!.title).toBe('A, better');
  });

  it('a new address is a new link: saved in the same hub, and the old one archived', async () => {
    const { a, dev, before } = await synced();
    person().update(bookmarkIn(dev, 'A').id, { url: 'https://a2.com/' });
    await quiet();
    expect(since(before)).toEqual([`PATCH /api/links/${a.id}`, 'POST /api/links']);
    expect(server.links.get(a.id)!.status).toBe('archived');
    expect(server.view(server.byUrl('https://a2.com/'))).toMatchObject({ title: 'A', status: 'active', hubs: ['dev'] });
  });

  it('moving a bookmark between hub folders changes the link’s hubs', async () => {
    const { a, dev, rust, before } = await synced();
    person().move(bookmarkIn(dev, 'A').id, { parentId: rust });
    await quiet();
    expect(since(before)).toEqual([`PATCH /api/links/${a.id}`]);
    expect(requests.at(-1)!.body).toEqual({ hubs: ['rust'] });
    expect(server.view(a)!.hubs).toEqual(['rust']);
  });

  it('moving one of a link’s two bookmarks into Unsorted leaves it in its other hub', async () => {
    const { b, dev, unsorted } = await synced();
    person().move(bookmarkIn(dev, 'B').id, { parentId: unsorted });
    await quiet();
    expect(server.view(b)!.hubs).toEqual(['rust']);
  });

  it('a bookmark moved in from elsewhere is sent; one moved out is let go as if deleted', async () => {
    const { a, dev } = await synced();
    const outside = person().create({ parentId: '1', title: 'From the bar', url: 'https://bar.com/' });
    person().move(outside.id, { parentId: dev });
    person().move(bookmarkIn(dev, 'A').id, { parentId: '1' });
    await quiet();
    expect(server.view(server.byUrl('https://bar.com/'))!.hubs).toEqual(['dev']);
    expect(server.links.get(a.id)!.status).toBe('archived');
    expect(tree().child('1', 'A')).toBeDefined();
  });

  it('a folder made in the bukmark folder is a new hub, and bookmarks made in it are filed there', async () => {
    const { before } = await synced();
    const ops = person().create({ parentId: root().id, title: 'ops' });
    person().create({ parentId: ops.id, title: 'Runbook', url: 'https://runbook.com/' });
    await quiet();
    expect(since(before)).toEqual(['POST /api/hubs', 'POST /api/links']);
    expect(server.hubByName('ops')).toBeDefined();
    expect(server.view(server.byUrl('https://runbook.com/'))!.hubs).toEqual(['ops']);
  });

  it('Chrome’s “New folder”, named straight after, becomes a hub under the name it was given', async () => {
    await synced();
    const made = person().create({ parentId: root().id, title: 'New folder' });
    person().update(made.id, { title: 'reading' });
    await quiet();
    expect(server.hubByName('reading')).toBeDefined();
    expect(server.hubByName('New folder')).toBeUndefined();
    expect(state().hubFolders.reading).toBe(made.id);
  });

  it('renaming a hub folder renames the hub, and the links keep it', async () => {
    const { a, dev } = await synced();
    const hub = server.hubByName('dev')!;
    person().update(dev, { title: 'code' });
    await quiet();
    expect(requests.slice(-2).map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(['GET /api/hubs', `PATCH /api/hubs/${hub.id}`]);
    expect(server.hubs.get(hub.id)!.name).toBe('code');
    expect(server.view(a)!.hubs).toEqual(['code']);
    // The next pull finds nothing to change in the folder.
    const count = requests.length;
    await ask('pull');
    expect(since(count)).toEqual(['GET /api/links/changes']);
    expect(tree().at('bukmark', 'code')!.id).toBe(dev);
  });

  it('a hub folder renamed while no event came through is renamed on the server at the next pull', async () => {
    const { a, dev } = await synced();
    const hub = server.hubByName('dev')!;
    stopBackground(chrome);
    person().update(dev, { title: 'code' });
    await quiet();
    await startBackground(chrome);
    await ask('pull');
    expect(server.hubs.get(hub.id)!.name).toBe('code');
    expect(server.view(a)!.hubs).toEqual(['code']);
    expect(tree().at('bukmark', 'code')!.id).toBe(dev);
  });

  it('a hub folder renamed to another hub’s name is named back on the next pull', async () => {
    const { dev, before } = await synced();
    person().update(dev, { title: 'rust' });
    await quiet();
    expect(since(before)).toEqual([]);
    await ask('pull');
    expect(tree().at('bukmark', 'dev')!.id).toBe(dev);
  });

  it('reordering a bookmark inside its folder sends nothing, so hubs added on the server meanwhile stay', async () => {
    const { a, dev, before } = await synced();
    server.edit(a, { hubs: ['dev', 'reading'] });
    person().move(bookmarkIn(dev, 'A').id, { parentId: dev, index: 2 });
    await quiet();
    expect(since(before)).toEqual([]);
    expect(server.view(a)!.hubs).toEqual(['dev', 'reading']);
  });

  it('a bookmark made where the link is already filed elsewhere adds the hub', async () => {
    const { a, rust } = await synced();
    person().create({ parentId: rust, title: 'A again', url: 'https://a.com/' });
    await quiet();
    expect(server.view(a)!.hubs).toEqual(['dev', 'rust']);
    await ask('pull');
    expect(folder().rust).toEqual({ '*': ['B → https://b.com/', 'A again → https://a.com/'] });
  });
});

describe('deleting in the browser (S4)', () => {
  const deletes = () => requests.filter((r) => r.method === 'DELETE' || (r.body as { action?: string })?.action === 'delete');

  it('deleting a link’s only bookmark archives the link, and deletes nothing', async () => {
    const { a, dev, before } = await synced();
    person().remove(bookmarkIn(dev, 'A').id);
    await quiet();
    expect(since(before)).toEqual([`PATCH /api/links/${a.id}`]);
    expect(requests.at(-1)!.body).toEqual({ status: 'archived' });
    expect(server.links.get(a.id)!.status).toBe('archived');
    expect(deletes()).toEqual([]);
    expect(state().links[a.id]).toBeUndefined();
  });

  it('deleting one of a link’s bookmarks, while another hub folder still has it, takes off only that hub', async () => {
    const { b, rust } = await synced();
    person().remove(bookmarkIn(rust, 'B').id);
    await quiet();
    expect(requests.at(-1)!.body).toEqual({ hubs: ['dev'] });
    expect(server.view(b)).toMatchObject({ status: 'active', hubs: ['dev'] });
  });

  it.each(['chrome', 'firefox'] as const)(
    'deleting a hub folder (%s) archives the hub and takes it off its links, which stay',
    async (browser) => {
      const { a, b, dev } = await synced(browser);
      const hub = server.hubByName('dev')!;
      person().remove(dev, true);
      await quiet();
      expect(server.hubs.get(hub.id)!.status).toBe('archived');
      expect(requests.at(-1)!.body).toEqual({ ids: [a.id, b.id], action: 'unassign', hubId: hub.id });
      expect(server.view(a)).toMatchObject({ status: 'active', hubs: [] });
      expect(server.view(b)).toMatchObject({ status: 'active', hubs: ['rust'] });
      expect(deletes()).toEqual([]);
      // The next pull shows A in Unsorted, and no dev folder.
      await ask('pull');
      expect(folder()).toEqual({
        rust: { '*': ['B → https://b.com/'] },
        Unsorted: { '*': ['C → https://c.com/', 'A → https://a.com/'] },
      });
    },
  );

  it('moving a hub folder out of the bukmark folder counts as deleting it', async () => {
    const { a, dev } = await synced();
    person().move(dev, { parentId: '1' });
    await quiet();
    expect(server.hubByName('dev')!.status).toBe('archived');
    expect(server.view(a)!.hubs).toEqual([]);
    expect(tree().child('1', 'dev')).toBeDefined();
  });

  it('deleting Unsorted archives the links in it', async () => {
    const { c, unsorted } = await synced();
    person().remove(unsorted, true);
    await quiet();
    expect(server.links.get(c.id)!.status).toBe('archived');
    expect(server.hubs.size).toBe(2);
  });

  it('deleting the whole bukmark folder changes nothing on the server', async () => {
    const { before } = await synced();
    person().remove(root().id, true);
    await quiet();
    expect(since(before)).toEqual([]);
    expect([...server.links.values()].every((l) => l.status === 'active')).toBe(true);
  });

  it('a hub folder made again after being deleted brings the archived hub back', async () => {
    const { dev } = await synced();
    person().remove(dev, true);
    await quiet();
    person().create({ parentId: root().id, title: 'dev' });
    await quiet();
    expect(server.hubByName('dev')!.status).toBe('active');
  });
});

describe('echo suppression: a pull’s own writes are never sent back', () => {
  it('a full pull, and every pull after it, sends nothing but the feed request', async () => {
    const { before } = await synced();
    expect(sent().slice(0, before).filter((r) => r !== 'GET /api/links/changes')).toEqual([]);
    for (const hub of ['dev', 'rust']) server.renameHub(server.hubByName(hub)!, `${hub}2`);
    server.edit(server.byUrl('https://c.com/')!, { title: 'C2', hubs: ['dev2'] });
    server.add('https://new.com/', 'New', ['ops']);
    server.edit(server.byUrl('https://a.com/')!, { status: 'archived' });
    await ask('pull');
    await ask('pull');
    expect(since(before)).toEqual(['GET /api/links/changes', 'GET /api/links/changes']);
    expect(folder()).toEqual({
      dev2: { '*': ['B → https://b.com/', 'C2 → https://c.com/'] },
      rust2: { '*': ['B → https://b.com/'] },
      ops: { '*': ['New → https://new.com/'] },
    });
    // Nothing is left waiting to swallow a later edit.
    expect(Object.keys(chrome.storage.session.data).filter((k) => k.startsWith('syncEcho:'))).toEqual([]);
  });

  it('a worker restarted mid-pull still knows the events of the old one’s writes', async () => {
    const { a, before } = await synced();
    server.edit(a, { title: 'A2', hubs: ['rust'] });
    server.add('https://new.com/', 'New', ['ops']);
    // The pull's events wait while the worker is replaced.
    tree().hold();
    await ask('pull');
    stopBackground(chrome);
    await startBackground(chrome);
    tree().release();
    await quiet();
    expect(since(before)).toEqual(['GET /api/links/changes']);
    // The new worker still sends the person's own edits.
    person().update(bookmarkIn(tree().at('bukmark', 'rust')!.id, 'A2').id, { title: 'Mine' });
    await quiet();
    expect(since(before)).toEqual(['GET /api/links/changes', `PATCH /api/links/${a.id}`]);
  });

  it('a pull cut short by a stopped worker is picked up without making anything twice', async () => {
    await start();
    server.pageSize = 2;
    for (const n of [1, 2, 3, 4, 5]) server.add(`https://${n}.com/`, `L${n}`, ['dev']);
    // The second page never comes: the worker is stopped waiting for it.
    let pages = 0;
    requests = stubFetch((req) => (req.url.includes('/changes') && ++pages === 2 ? new Promise(() => {}) : server.route(req)));
    void chrome.runtime.sendMessage({ type: 'sync', action: 'enable' });
    await quiet();
    expect(tree().outline(tree().at('bukmark', 'dev')!.id)['*']).toHaveLength(2);
    stopBackground(chrome);

    await startBackground(chrome);
    fireAlarm(chrome, 'bukmark-sync');
    await quiet();
    expect(tree().outline(tree().at('bukmark', 'dev')!.id)['*']).toEqual(
      ['L1 → https://1.com/', 'L2 → https://2.com/', 'L3 → https://3.com/', 'L4 → https://4.com/', 'L5 → https://5.com/'],
    );
    expect(sent().filter((r) => r !== 'GET /api/links/changes')).toEqual([]);
    expect(state()).toMatchObject({ full: false, error: null });
  });
});

describe('when the server can’t be reached', () => {
  it('queues the change, says so, and sends it on the next alarm before pulling', async () => {
    const { dev, before } = await synced();
    server.offline = true;
    const made = person().create({ parentId: dev, title: 'Offline', url: 'https://offline.com/' });
    await quiet();
    expect(state().queue).toEqual([{ kind: 'save', bookmarkId: made.id, url: 'https://offline.com/', title: 'Offline', hub: 'dev' }]);
    expect(state().error).toBe("Couldn't reach nas.lan:3000 — sync will try again in a few minutes.");
    expect(since(before)).toEqual(['POST /api/links']);

    server.offline = false;
    fireAlarm(chrome, 'bukmark-sync');
    await quiet();
    expect(since(before + 1)).toEqual(['POST /api/links', 'GET /api/links/changes']);
    expect(state().queue).toEqual([]);
    expect(state().error).toBeNull();
    expect(tree().outline(dev)['*']).toEqual(['A → https://a.com/', 'B → https://b.com/', 'Offline → https://offline.com/']);
  });

  it('keeps later changes behind the first, and a pull waits for them rather than undoing them', async () => {
    const { a, dev, rust, before } = await synced();
    server.offline = true;
    person().move(bookmarkIn(dev, 'A').id, { parentId: rust });
    person().update(bookmarkIn(rust, 'A').id, { title: 'A moved' });
    await quiet();
    expect(await ask('pull')).toMatchObject({ ok: false });
    expect(state().queue.map((c) => c.kind)).toEqual(['hubs', 'title']);
    expect(tree().child(rust, 'A moved')).toBeDefined();

    server.offline = false;
    expect(await ask('pull')).toEqual({ ok: true });
    expect(server.view(a)).toMatchObject({ title: 'A moved', hubs: ['rust'] });
    expect(tree().child(rust, 'A moved')).toBeDefined();
    // Tried with each edit and each pull while offline, then sent in order.
    expect(requests.filter((r) => r.method === 'PATCH').slice(-2).map((r) => r.body)).toEqual([{ hubs: ['rust'] }, { title: 'A moved' }]);
    expect(since(before).filter((r) => r === 'POST /api/links')).toEqual([]);
  });

  it('a bookmark made and changed while offline is sent once, as it ended up', async () => {
    const { dev, rust, before } = await synced();
    server.offline = true;
    const made = person().create({ parentId: dev, title: 'Draft', url: 'https://draft.com/' });
    person().update(made.id, { title: 'Final' });
    person().move(made.id, { parentId: rust });
    const gone = person().create({ parentId: dev, title: 'Gone', url: 'https://gone.com/' });
    person().remove(gone.id);
    await quiet();
    server.offline = false;
    const count = requests.length;
    await ask('pull');
    expect(since(count)).toEqual(['POST /api/links', 'GET /api/links/changes']);
    expect(requests[count]!.body).toEqual({ url: 'https://draft.com/', title: 'Final', hub: 'rust' });
    expect(server.byUrl('https://gone.com/')).toBeUndefined();
    // Offline, only the save was tried: nothing for the bookmark made and deleted.
    expect(new Set(since(before))).toEqual(new Set(['POST /api/links', 'GET /api/links/changes']));
  });

  it('tries again later when the server is busy, and drops a change it refuses', async () => {
    const { a, dev } = await synced();
    server.failWith = 503;
    person().update(bookmarkIn(dev, 'A').id, { title: 'Busy' });
    await quiet();
    expect(state().queue).toHaveLength(1);

    server.failWith = 400;
    const count = requests.length;
    await ask('pull');
    expect(since(count)).toEqual([`PATCH /api/links/${a.id}`, 'GET /api/links/changes']);
    expect(state().queue).toEqual([]);
    server.failWith = null;
    // The refused change is not tried again, and a full pull brings the server's title back.
    expect(state().full).toBe(true);
    const next = requests.length;
    await ask('pull');
    expect(since(next)).toEqual(['GET /api/links/changes']);
    expect(new URL(requests.at(-1)!.url).searchParams.get('since')).toBeNull();
    expect(tree().outline(dev)['*']).toContain('A → https://a.com/');
  });
});

describe('a change for a link the server no longer has', () => {
  it('is dropped without telling the person to update the server', async () => {
    const { a, dev } = await synced();
    server.remove(a);
    person().remove(bookmarkIn(dev, 'A').id);
    await quiet();
    expect(state().queue).toEqual([]);
    expect(state().error).toBe('Sync failed: link not found');
    expect(state().enabled).toBe(true);
  });
});

describe('turning sync off', () => {
  it('stops pulling and pushing, and leaves the folder as it is', async () => {
    const { dev } = await synced();
    const outline = folder();
    expect(await ask('disable')).toEqual({ ok: true });
    expect(chrome.alarms.data.has('bukmark-sync')).toBe(false);
    const count = requests.length;
    person().create({ parentId: dev, title: 'Off', url: 'https://off.com/' });
    await quiet();
    expect(await ask('pull')).toEqual({ ok: false, error: 'Sync is off.' });
    expect(requests).toHaveLength(count);
    expect(folder()).toEqual({ ...outline, dev: { '*': ['A → https://a.com/', 'B → https://b.com/', 'Off → https://off.com/'] } });
  });

  it('turns off when logging out, and the folder stays', async () => {
    await synced();
    await chrome.storage.local.remove('auth');
    await quiet();
    expect(state()).toMatchObject({ enabled: false, queue: [] });
    expect(chrome.alarms.data.has('bukmark-sync')).toBe(false);
    expect(Object.keys(folder())).toEqual(['dev', 'rust', 'Unsorted']);
  });

  it('turns off when logged in to another server, and starts afresh with it', async () => {
    await synced();
    await chrome.storage.sync.set({ baseUrl: 'http://other.lan:3000' });
    await chrome.storage.local.set({ auth: { ...AUTH, server: 'http://other.lan:3000' } });
    await quiet();
    expect(state().enabled).toBe(false);
    const other = new FakeServer();
    other.add('https://z.com/', 'Z', ['zed']);
    requests = stubFetch((req) => other.route(req));
    await ask('enable');
    // The same folder, now matched to the other server: what it had there is sent.
    expect(state().server).toBe('http://other.lan:3000');
    expect(Object.keys(folder())).toContain('zed');
    expect(other.byUrl('https://a.com/')).toBeDefined();
  });

  it('turns off, and says why, when the server ends the session', async () => {
    await synced();
    requests = stubFetch(() => ({ status: 401, body: { error: 'Not authenticated' } }));
    expect(await ask('pull')).toEqual({ ok: false, error: 'Your session ended — log in again.' });
    expect(state()).toMatchObject({ enabled: false, error: 'Your session ended — log in again.' });
    expect(chrome.storage.local.data.auth).toBeUndefined();
  });

  it('turns off when the browser takes the bookmarks permission back', async () => {
    await synced();
    delete (chrome as Partial<FakeChrome>).bookmarks;
    expect(await ask('pull')).toEqual({
      ok: false, error: 'Sync is off: the browser no longer lets bukmark use your bookmarks.',
    });
    expect(state().enabled).toBe(false);
  });

  it('turns off when Chrome takes the permission back but leaves chrome.bookmarks in the running worker', async () => {
    await synced();
    // Seen in Chrome: the API stays, and its calls fail with "not available in this context".
    chrome.permissions.contains.mockImplementation(async (p) => !(p as { permissions?: string[] }).permissions?.includes('bookmarks'));
    const count = requests.length;
    expect(await ask('pull')).toEqual({
      ok: false, error: 'Sync is off: the browser no longer lets bukmark use your bookmarks.',
    });
    expect(state().enabled).toBe(false);
    expect(chrome.alarms.data.has('bukmark-sync')).toBe(false);
    expect(since(count)).toEqual([]);
  });
});

describe('Firefox’s consent to share bookmarks with the server', () => {
  const sharing = (p: unknown) => !(p as { data_collection?: string[] }).data_collection?.includes('bookmarksInfo');

  it('is asked for along with the bookmarks permission', async () => {
    await synced('firefox');
    expect(chrome.permissions.contains).toHaveBeenCalledWith({ permissions: ['bookmarks'], data_collection: ['bookmarksInfo'] });
  });

  it('taken back in about:addons, turns sync off: nothing more is pulled or sent', async () => {
    const { dev } = await synced('firefox');
    chrome.permissions.contains.mockImplementation(async (p) => sharing(p));
    const count = requests.length;
    person().create({ parentId: dev, title: 'After', url: 'https://after.com/' });
    await quiet();
    expect(since(count)).toEqual([]);
    expect(state().enabled).toBe(false);
    expect(await ask('pull')).toEqual({ ok: false, error: 'Sync is off.' });
    expect(since(count)).toEqual([]);
  });

  it('is not asked about in Chrome, which has no such consent', async () => {
    await synced('chrome');
    for (const [p] of chrome.permissions.contains.mock.calls) expect(p).not.toHaveProperty('data_collection');
  });
});

describe('comparableUrl', () => {
  it.each([
    'https://www.Example.com/a?utm_source=x&b=1#frag',
    'http://example.com',
    'https://example.com/?fbclid=1',
    'https://example.com/path?ref=home&q=2',
    'https://EXAMPLE.com:8443/x/?UTM_Medium=y',
  ])('matches the server’s normalization of %s, fragment aside', async (url) => {
    const { comparableUrl } = await import('./sync');
    const norm = normalizeUrl(url);
    expect(norm.ok && comparableUrl(url)).toBe(norm.ok && norm.url);
  });
});

describe('the background, as it starts', () => {
  it('listens to the four bookmark events at once, so that an edit wakes it', async () => {
    await start();
    for (const event of ['onCreated', 'onChanged', 'onMoved', 'onRemoved'] as const) {
      expect(chrome.bookmarks[event].listeners).toHaveLength(1);
    }
    expect(chrome.alarms.onAlarm.listeners).toHaveLength(1);
    expect(chrome.runtime.onStartup.listeners).toHaveLength(1);
  });

  it('listens once bookmarks are granted, when sync is turned on without a restart', async () => {
    chrome = fakeChrome({ local: { auth: AUTH }, sync: { baseUrl: SERVER }, without: ['bookmarks'] });
    vi.stubGlobal('chrome', chrome);
    const granted = fakeChrome().bookmarks;
    server = new FakeServer();
    requests = stubFetch(server.route);
    await startBackground(chrome);
    // Granted from the settings page: the API appears in the running background.
    (chrome as Partial<FakeChrome>).bookmarks = granted;
    await ask('enable');
    expect(granted.onCreated.listeners).toHaveLength(1);
    const count = requests.length;
    granted.tree.create({ parentId: tree().at('bukmark')!.id, title: 'N', url: 'https://n.com/' });
    await quiet();
    expect(since(count)).toEqual(['POST /api/links']);
  });

  it('starts in Safari, which has neither bookmarks nor alarms', async () => {
    chrome = fakeChrome({ browser: 'safari', local: { auth: AUTH }, sync: { baseUrl: SERVER } });
    vi.stubGlobal('chrome', chrome);
    await expect(startBackground(chrome)).resolves.toBeUndefined();
    expect(await ask('enable')).toEqual({ ok: false, error: 'Not turned on — access to your bookmarks was declined.' });
  });
});
