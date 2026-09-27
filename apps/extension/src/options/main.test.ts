import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../lib/auth';
import type { LoginRequest } from '../lib/login';
import { fakeChrome, settle, stubFetch, type FakeChrome } from '../test/chrome';
import { loadPage } from '../test/dom';

const S1 = 'http://s1.lan:3000';
const S2 = 'http://s2.lan:3000';
const S3 = 'http://s3.lan:3000';
const UNREACHABLE =
  "Logged out here. The server could not be reached — revoke 'bukmark capture' under Access tokens in the web app.";

function auth(over: Partial<Auth> = {}): Auth {
  return { token: 'bkm_s1', tokenId: 't1', server: S1, name: 'bukmark capture', createdAt: 1, ...over };
}

let chrome: FakeChrome;

function arrange(seed: Parameters<typeof fakeChrome>[0] = {}): void {
  chrome = fakeChrome(seed);
  vi.stubGlobal('chrome', chrome);
}

async function openOptions() {
  const page = loadPage('options.html');
  vi.stubGlobal('document', page.document);
  vi.resetModules();
  await import('./main');
  await settle();
  return page;
}

const revokes = (requests: Array<{ url: string; headers: Headers }>) =>
  requests.map((r) => [r.url, r.headers.get('authorization')]);

beforeEach(() => {
  vi.stubGlobal('setTimeout', vi.fn());
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('options, logged out', () => {
  beforeEach(() => arrange({ sync: { baseUrl: S1 } }));

  it('offers Log in, and keeps Import disabled with a hint', async () => {
    const page = await openOptions();
    expect(page.el('baseUrl').value).toBe(S1);
    expect(page.el('login').hidden).toBe(false);
    expect(page.el('logout').hidden).toBe(true);
    expect(page.el('account').hidden).toBe(true);
    expect(page.el('import').disabled).toBe(true);
    expect(page.el('importHint').hidden).toBe(false);

    page.el('import').click();
    await settle();
    expect(chrome.bookmarks.getTree).not.toHaveBeenCalled();
  });

  it('logs in through the background worker, never in the page', async () => {
    const page = await openOptions();
    page.el('login').click();
    await settle();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login', baseUrl: S1 });
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it('logs in to the address in the field, saved first, and shows the result', async () => {
    chrome.runtime.sendMessage.mockImplementation(async (m) => {
      await chrome.storage.local.set({ auth: auth({ server: (m as LoginRequest).baseUrl, token: 'bkm_s2' }) });
      return { ok: true };
    });
    const page = await openOptions();
    page.el('baseUrl').value = `${S2}/`;
    page.el('login').click();
    await settle();

    expect(chrome.storage.sync.data.baseUrl).toBe(S2);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login', baseUrl: S2 });
    expect(page.el('account').textContent).toBe('Signed in to s2.lan:3000 as bukmark capture');
    expect(page.el('login').hidden).toBe(true);
    expect(page.el('import').disabled).toBe(false);
  });

  it('says why a login failed', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'Access was denied in the bukmark window.' });
    const page = await openOptions();
    page.el('login').click();
    await settle();
    expect(page.el('authStatus').textContent).toBe('Access was denied in the bukmark window.');
    expect(page.el('authStatus').classList.contains('error')).toBe(true);
    expect(page.el('login').disabled).toBe(false);
  });

  it('updates when a login started from the popup finishes', async () => {
    const page = await openOptions();
    await chrome.storage.local.set({ auth: auth() });
    await settle();
    expect(page.el('account').textContent).toBe('Signed in to s1.lan:3000 as bukmark capture');
    expect(page.el('logout').hidden).toBe(false);
    expect(page.el('import').disabled).toBe(false);
    expect(page.el('importHint').hidden).toBe(true);
  });

  it('shows a server saved from the popup', async () => {
    const page = await openOptions();
    await chrome.storage.sync.set({ baseUrl: S2 });
    await settle();
    expect(page.el('baseUrl').value).toBe(S2);
  });
});

describe('options, logged in', () => {
  beforeEach(() => arrange({ local: { auth: auth() }, sync: { baseUrl: S1 } }));

  it('names the server and the token, with Log out and Import available', async () => {
    const page = await openOptions();
    expect(page.el('account').hidden).toBe(false);
    expect(page.el('account').textContent).toBe('Signed in to s1.lan:3000 as bukmark capture');
    expect(page.el('logout').hidden).toBe(false);
    expect(page.el('login').hidden).toBe(true);
    expect(page.el('import').disabled).toBe(false);
    expect(page.el('importHint').hidden).toBe(true);
  });

  it('Log out revokes the token at its server and forgets it here', async () => {
    const requests = stubFetch(() => ({ body: { ok: true } }));
    const page = await openOptions();
    page.el('logout').click();
    await settle();

    expect(requests.map((r) => r.method)).toEqual(['POST']);
    expect(revokes(requests)).toEqual([[`${S1}/api/auth/logout`, 'Bearer bkm_s1']]);
    expect(chrome.storage.local.data.auth).toBeUndefined();
    expect(page.el('authStatus').textContent).toBe('');
    expect(page.el('login').hidden).toBe(false);
    expect(page.el('import').disabled).toBe(true);
  });

  it.each([
    ['answers with an error', { status: 502 }],
    ['cannot be reached', new TypeError('Failed to fetch')],
  ])('Log out when the server %s: logged out here, and told to revoke by hand', async (_case, reply) => {
    stubFetch(() => reply);
    const page = await openOptions();
    page.el('logout').click();
    await settle();

    expect(chrome.storage.local.data.auth).toBeUndefined();
    expect(page.el('authStatus').textContent).toBe(UNREACHABLE);
    expect(page.el('login').hidden).toBe(false);
  });

  it('asks for a new server’s host before anything else, and a refusal changes nothing', async () => {
    chrome.permissions.contains.mockResolvedValue(false);
    chrome.permissions.request.mockResolvedValue(false);
    const requests = stubFetch(() => ({ body: { ok: true } }));
    const page = await openOptions();
    page.el('baseUrl').value = S2;
    page.el('saveUrl').click();
    await settle();

    expect(page.el('urlStatus').textContent).toBe('Not saved — access to that address was declined');
    expect(requests).toHaveLength(0);
    expect(chrome.storage.local.data.auth).toMatchObject({ server: S1 });
    expect(chrome.storage.sync.data.baseUrl).toBe(S1);
  });

  it('prompts for the host while the click is fresh: before the logout request', async () => {
    chrome.permissions.contains.mockResolvedValue(false);
    stubFetch(() => ({ body: { ok: true } }));
    const page = await openOptions();
    page.el('baseUrl').value = S2;
    page.el('saveUrl').click();
    await settle();

    const prompted = chrome.permissions.request.mock.invocationCallOrder[0]!;
    expect(vi.mocked(fetch).mock.invocationCallOrder[0]).toBeGreaterThan(prompted);
  });

  it('logs out of the old server on every change of server, not only the first', async () => {
    const requests = stubFetch(() => ({ body: { ok: true } }));
    const page = await openOptions();

    page.el('baseUrl').value = S2;
    page.el('saveUrl').click();
    await settle();
    expect(revokes(requests)).toEqual([[`${S1}/api/auth/logout`, 'Bearer bkm_s1']]);
    expect(chrome.storage.sync.data.baseUrl).toBe(S2);
    expect(chrome.storage.local.data.auth).toBeUndefined();

    // Then logged in to the second server, from the popup.
    await chrome.storage.local.set({ auth: auth({ server: S2, token: 'bkm_s2' }) });
    await settle();

    page.el('baseUrl').value = S3;
    page.el('saveUrl').click();
    await settle();
    expect(revokes(requests)).toEqual([
      [`${S1}/api/auth/logout`, 'Bearer bkm_s1'],
      [`${S2}/api/auth/logout`, 'Bearer bkm_s2'],
    ]);
    expect(chrome.storage.local.data.auth).toBeUndefined();
    expect(chrome.storage.sync.data.baseUrl).toBe(S3);
  });

  it('warns when the old server could not revoke the token, and still switches', async () => {
    stubFetch(() => new TypeError('Failed to fetch'));
    const page = await openOptions();
    page.el('baseUrl').value = S2;
    page.el('saveUrl').click();
    await settle();

    expect(page.el('authStatus').textContent).toBe(UNREACHABLE);
    expect(chrome.storage.local.data.auth).toBeUndefined();
    expect(chrome.storage.sync.data.baseUrl).toBe(S2);
  });

  it('keeps the login when the address saved is the same server', async () => {
    const requests = stubFetch(() => ({ body: { ok: true } }));
    const page = await openOptions();
    page.el('baseUrl').value = `${S1}/`;
    page.el('saveUrl').click();
    await settle();

    expect(requests).toHaveLength(0);
    expect(chrome.storage.local.data.auth).toMatchObject({ server: S1 });
    expect(page.el('urlStatus').textContent).toBe('Saved');
  });

  it('imports with the token, to its server', async () => {
    chrome.bookmarks.getTree.mockResolvedValue([
      { id: '0', title: '', children: [{ id: '1', title: 'Bar', children: [{ id: '2', title: 'A', url: 'https://a.com' }] }] },
    ]);
    const requests = stubFetch(({ url }) =>
      url.endsWith('/import')
        ? { body: { created: 1, updated: 0, skippedDeleted: 0, invalid: [] } }
        : { body: { processed: 0, remaining: 0 } });
    const page = await openOptions();
    page.el('import').click();
    await settle();

    expect(requests.map((r) => r.url)).toEqual([`${S1}/api/links/import`, `${S1}/api/links/og-backfill`]);
    for (const r of requests) expect(r.headers.get('authorization')).toBe('Bearer bkm_s1');
    expect(page.el('importStatus').textContent).toBe('1 added, 0 already known. Preview images fetched for 0.');
    expect(page.el('import').disabled).toBe(false);
  });

  it('shows the logged-out state when the token is revoked mid-import', async () => {
    chrome.bookmarks.getTree.mockResolvedValue([{ id: '0', title: '', children: [{ id: '2', title: 'A', url: 'https://a.com' }] }]);
    stubFetch(() => ({ status: 401, body: { error: 'Not authenticated' } }));
    const page = await openOptions();
    page.el('import').click();
    await settle();

    expect(page.el('importStatus').textContent).toBe('Your session ended — log in again.');
    expect(chrome.storage.local.data.auth).toBeUndefined();
    expect(page.el('login').hidden).toBe(false);
    expect(page.el('logout').hidden).toBe(true);
    expect(page.el('import').disabled).toBe(true);
    expect(page.el('importHint').hidden).toBe(false);
  });
});
