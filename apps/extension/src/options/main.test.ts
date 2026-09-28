import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../lib/auth';
import type { LoginRequest } from '../lib/login';
import {
  STATUS,
  approve,
  closeTab,
  fakeChrome,
  fireAlarm,
  navigate,
  replied,
  settle,
  startBackground,
  stubFetch,
  type FakeChrome,
  type FakeSeed,
} from '../test/chrome';
import { loadPage } from '../test/dom';
import { FakeServer } from '../test/server';

const S1 = 'http://s1.lan:3000';
const S2 = 'http://s2.lan:3000';
const S3 = 'http://s3.lan:3000';
const UNREACHABLE =
  "Logged out here. The server could not be reached — revoke 'bukmark capture' under Access tokens in the web app.";
const FINISH_IN_WINDOW = 'Finish signing in in the bukmark window.';

function auth(over: Partial<Auth> = {}): Auth {
  return { token: 'bkm_s1', tokenId: 't1', server: S1, name: 'bukmark capture', createdAt: 1, ...over };
}

let chrome: FakeChrome;

function arrange(seed: FakeSeed = {}): void {
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

describe('options opened as the setup page after install', () => {
  it('shows the setup steps only when opened as the welcome page', async () => {
    arrange({ sync: { baseUrl: S1 } });
    expect((await openOptions()).el('welcome').hidden).toBe(true);

    vi.stubGlobal('location', { search: '?welcome' });
    const page = await openOptions();
    expect(page.el('welcome').hidden).toBe(false);
    expect(page.el('stepLogin').classList.contains('done')).toBe(false);
    expect(page.el('welcomeDone').hidden).toBe(true);
    expect(page.el('login').hidden).toBe(false);
  });

  it('names the assigned shortcut in the last step', async () => {
    arrange({ sync: { baseUrl: S1 } });
    vi.stubGlobal('location', { search: '?welcome' });
    const page = await openOptions();
    expect(page.el('welcomeShortcut').hidden).toBe(false);
    expect(page.el('welcomeKey').textContent).toBe('Alt+Shift+K');
  });

  it('says setup is done once a login finishes, without reloading', async () => {
    arrange({ sync: { baseUrl: S1 } });
    vi.stubGlobal('location', { search: '?welcome' });
    const page = await openOptions();
    await chrome.storage.local.set({ auth: auth() });
    await settle();
    expect(page.el('stepLogin').classList.contains('done')).toBe(true);
    expect(page.el('welcomeDone').hidden).toBe(false);
    expect(page.el('welcomeDone').textContent).toContain('Signed in to s1.lan:3000');
  });
});

describe('options: what leaves the browser, and store-neutral wording', () => {
  it('says what saving, the popup, Import and sync send, where it is decided', () => {
    const html = readFileSync(new URL('../../options.html', import.meta.url), 'utf8');
    expect(html).toContain('Saving a page sends its address and title to this server, and nowhere else.');
    expect(html).toContain("Import sends every bookmark's address, title and folder to your server.");
    expect(html).toContain(
      'Sync keeps the bukmark folder in your bookmarks and your server the same, both ways. Only that folder is read or changed.',
    );
  });

  it('names Safari’s shortcut settings only in Safari', async () => {
    arrange({ sync: { baseUrl: S1 } });
    expect((await openOptions()).el('shortcutWhere').textContent).not.toContain('Safari');
    arrange({ sync: { baseUrl: S1 }, browser: 'safari', without: ['bookmarks', 'identity'] });
    expect((await openOptions()).el('shortcutWhere').textContent).toBe('Change it in Safari under Settings › Extensions.');
  });
});

describe('options on Firefox for Android', () => {
  it('points to the web app’s file import instead of an Import button that cannot work', async () => {
    arrange({ sync: { baseUrl: S1 }, browser: 'firefox', without: ['bookmarks'] });
    chrome.runtime.getPlatformInfo.mockResolvedValue({ os: 'android', arch: 'arm' });
    const page = await openOptions();
    expect(page.el('importSection').hidden).toBe(true);
    expect(page.el('importElsewhere').hidden).toBe(false);
  });
});

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
    // Bookmarks are optional: asked for in the click, before anything is read.
    expect(chrome.permissions.request).toHaveBeenCalledWith({ permissions: ['bookmarks'] });
    expect(chrome.permissions.request.mock.invocationCallOrder[0])
      .toBeLessThan(chrome.bookmarks.getTree.mock.invocationCallOrder[0]!);
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

describe('options, using an access token', () => {
  const TOKEN = 'bkm_AbCdEfGh0123456789abcdefghijklmnopqrstuvwxyz';

  beforeEach(() => arrange({ sync: { baseUrl: S1 } }));

  function server() {
    return stubFetch(({ url, headers }) => url.endsWith('/api/auth/status')
      ? { body: { ...STATUS, authenticated: headers.get('authorization') === `Bearer ${TOKEN}` } }
      : { body: { ok: true } });
  }

  it('offers it while logged out, and logs in with a token the server accepts', async () => {
    const requests = server();
    const page = await openOptions();
    expect(page.el('showToken').hidden).toBe(false);
    page.el('showToken').click();
    expect(page.el('tokenForm').hidden).toBe(false);
    page.el('baseUrl').value = `${S2}/`;
    page.el('tokenInput').value = TOKEN;
    page.el('useToken').click();
    await settle();

    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['http://s2.lan/*'] });
    expect(revokes(requests)).toEqual([[`${S2}/api/auth/status`, `Bearer ${TOKEN}`]]);
    expect(chrome.storage.sync.data.baseUrl).toBe(S2);
    expect(page.el('account').textContent).toBe('Signed in to s2.lan:3000 as access token bkm_AbCdEfGh…');
    expect(page.el('tokenInput').value).toBe('');
    expect(page.el('tokenForm').hidden).toBe(true);
    expect(page.el('showToken').hidden).toBe(true);
    expect(page.el('import').disabled).toBe(false);
  });

  it('says so when the server refuses it, and changes nothing', async () => {
    server();
    const page = await openOptions();
    page.el('showToken').click();
    page.el('tokenInput').value = 'bkm_wrong';
    page.el('useToken').click();
    await settle();

    expect(page.el('authStatus').textContent).toMatch(/^s1\.lan:3000 didn't accept that token/);
    expect(page.el('authStatus').classList.contains('error')).toBe(true);
    expect(chrome.storage.local.data.auth).toBeUndefined();
    expect(page.el('useToken').disabled).toBe(false);
    expect(page.el('tokenForm').hidden).toBe(false);
  });

  it('is not offered while logged in', async () => {
    arrange({ local: { auth: auth() }, sync: { baseUrl: S1 } });
    const page = await openOptions();
    expect(page.el('showToken').hidden).toBe(true);
    expect(page.el('tokenForm').hidden).toBe(true);
  });
});

describe('options, taking over a server from Firefox’s popup', () => {
  beforeEach(() => arrange({ browser: 'firefox', sync: { baseUrl: S1 }, session: { serverToGrant: S2 } }));

  it('fills in the server the popup could not reach, and asks for it on Log in', async () => {
    const page = await openOptions();
    expect(page.el('baseUrl').value).toBe(S2);
    expect(page.el('authStatus').textContent).toBe('Log in here to let Firefox reach s2.lan:3000, or use an access token.');
    expect(chrome.storage.session.data.serverToGrant).toBeUndefined();

    page.el('login').click();
    await settle();
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['http://s2.lan/*'] });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login', baseUrl: S2 });
  });

  it('takes it over when the page was already open', async () => {
    arrange({ browser: 'firefox', sync: { baseUrl: S1 } });
    const page = await openOptions();
    expect(page.el('baseUrl').value).toBe(S1);
    await chrome.storage.session.set({ serverToGrant: S3 });
    await settle();
    expect(page.el('baseUrl').value).toBe(S3);
  });
});

describe('options in Firefox, importing', () => {
  beforeEach(() => arrange({ browser: 'firefox', local: { auth: auth() }, sync: { baseUrl: S1 } }));

  it('asks for bookmarks and to share them with the server before reading any', async () => {
    chrome.bookmarks.getTree.mockResolvedValue([{ id: '0', title: '', children: [{ id: '2', title: 'A', url: 'https://a.com' }] }]);
    const requests = stubFetch(({ url }) =>
      url.endsWith('/import')
        ? { body: { created: 1, updated: 0, skippedDeleted: 0, invalid: [] } }
        : { body: { processed: 0, remaining: 0 } });
    const page = await openOptions();
    page.el('import').click();
    await settle();

    expect(chrome.permissions.request).toHaveBeenCalledWith({ permissions: ['bookmarks'], data_collection: ['bookmarksInfo'] });
    expect(chrome.permissions.request.mock.invocationCallOrder[0])
      .toBeLessThan(chrome.bookmarks.getTree.mock.invocationCallOrder[0]!);
    expect(requests.map((r) => r.url)).toEqual([`${S1}/api/links/import`, `${S1}/api/links/og-backfill`]);
  });

  it('reads and sends nothing when that is declined', async () => {
    chrome.permissions.request.mockResolvedValue(false);
    const requests = stubFetch(() => ({ body: {} }));
    const page = await openOptions();
    page.el('import').click();
    await settle();

    expect(chrome.bookmarks.getTree).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
    expect(page.el('importStatus').textContent)
      .toBe('Not imported — access to your bookmarks was declined.');
    expect(page.el('import').disabled).toBe(false);
  });
});

describe('options without a bookmarks API (Safari)', () => {
  it('points to the web app’s file import instead of offering Import', async () => {
    arrange({ browser: 'safari', local: { auth: auth() }, sync: { baseUrl: S1 } });
    const page = await openOptions();
    expect(page.el('importSection').hidden).toBe(true);
    expect(page.el('importElsewhere').hidden).toBe(false);
    expect(page.el('webApp').href).toBe(`${S1}/`);
  });

  it('links the saved server’s web app while logged out', async () => {
    arrange({ browser: 'safari', sync: { baseUrl: S2 } });
    const page = await openOptions();
    expect(page.el('webApp').href).toBe(`${S2}/`);
  });

  it('keeps Import where the API exists', async () => {
    arrange({ sync: { baseUrl: S1 } });
    const page = await openOptions();
    expect(page.el('importSection').hidden).toBe(false);
    expect(page.el('importElsewhere').hidden).toBe(true);
  });
});

describe('options without storage.sync (Opera)', () => {
  it('keeps the server in storage.local and follows a change made there', async () => {
    arrange({ without: ['sync'], local: { baseUrl: S1 } });
    const page = await openOptions();
    expect(page.el('baseUrl').value).toBe(S1);

    await chrome.storage.local.set({ baseUrl: S2 });
    await settle();
    expect(page.el('baseUrl').value).toBe(S2);

    page.el('baseUrl').value = S3;
    page.el('saveUrl').click();
    await settle();
    expect(chrome.storage.local.data.baseUrl).toBe(S3);
  });
});

describe('options, keyboard shortcut', () => {
  it('shows the key the browser assigned, and opens Chrome’s shortcut page to change it', async () => {
    arrange({ sync: { baseUrl: S1 } });
    const page = await openOptions();
    expect(page.el('shortcutSection').hidden).toBe(false);
    expect(page.el('shortcutKey').textContent).toBe('Alt+Shift+K');
    expect(page.el('shortcutSet').hidden).toBe(false);
    expect(page.el('shortcutUnset').hidden).toBe(true);

    page.el('changeShortcut').click();
    await settle();
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts' });
  });

  it('says when no key is assigned', async () => {
    arrange({ sync: { baseUrl: S1 } });
    chrome.commands.getAll.mockResolvedValue([{ name: 'save-current-tab', description: '', shortcut: '' }]);
    const page = await openOptions();
    expect(page.el('shortcutSet').hidden).toBe(true);
    expect(page.el('shortcutUnset').hidden).toBe(false);
  });

  it('uses Firefox’s own shortcut settings there', async () => {
    arrange({ browser: 'firefox', sync: { baseUrl: S1 } });
    const page = await openOptions();
    page.el('changeShortcut').click();
    await settle();
    expect(chrome.commands.openShortcutSettings).toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('offers no button where the browser has no way to open its settings (Safari)', async () => {
    arrange({ browser: 'safari', sync: { baseUrl: S1 } });
    const page = await openOptions();
    expect(page.el('shortcutSection').hidden).toBe(false);
    expect(page.el('changeShortcut').hidden).toBe(true);
  });

  it('says so when the settings page will not open', async () => {
    arrange({ sync: { baseUrl: S1 } });
    chrome.tabs.create.mockRejectedValue(new Error('Cannot navigate to a chrome:// URL'));
    const page = await openOptions();
    page.el('changeShortcut').click();
    await settle();
    expect(page.el('shortcutStatus').textContent)
      .toBe("Couldn't open the shortcut settings — open your browser's extensions page instead.");
  });

  it('is hidden where the browser has no shortcuts (Firefox for Android)', async () => {
    arrange({ browser: 'firefox', without: ['commands'], sync: { baseUrl: S1 } });
    const page = await openOptions();
    expect(page.el('shortcutSection').hidden).toBe(true);
  });
});

describe('options where logins run in a tab (Safari)', () => {
  beforeEach(async () => {
    arrange({ browser: 'safari', sync: { baseUrl: S1 } });
    await startBackground(chrome);
    stubFetch(({ url }) =>
      url.endsWith('/api/auth/status') ? { body: STATUS }
        : url.endsWith('/api/auth/token') ? { body: { token: 'bkm_new', tokenId: 'id-new', name: 'bukmark capture' } }
        : { body: { ok: true } });
  });

  async function logInFromOptions() {
    const page = await openOptions();
    page.el('login').click();
    await replied(chrome);
    const [tab] = [...chrome.tabs.data.values()];
    return { page, tab: tab! };
  }

  it('says where to finish after Log in, then shows the account when the tab brings the reply', async () => {
    const { page, tab } = await logInFromOptions();
    expect(page.el('authStatus').textContent).toBe(FINISH_IN_WINDOW);
    expect(page.el('authStatus').classList.contains('error')).toBe(false);
    expect(page.el('login').disabled).toBe(false);

    navigate(chrome, tab.id, approve(tab.url));
    await settle();
    expect(page.el('account').textContent).toBe('Signed in to s1.lan:3000 as bukmark capture');
    expect(page.el('authStatus').textContent).toBe('');
    expect(page.el('login').hidden).toBe(true);
  });

  it('says why when the login in the tab ends without a token, and the next popup does not repeat it', async () => {
    const { page, tab } = await logInFromOptions();
    closeTab(chrome, tab.id);
    await settle();
    expect(page.el('authStatus').textContent).toBe('Login cancelled.');
    expect(page.el('authStatus').classList.contains('error')).toBe(true);
    expect(page.el('login').hidden).toBe(false);
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();
  });

  it('on opening while a login waits, says where to finish', async () => {
    await logInFromOptions();
    const page = await openOptions();
    await replied(chrome);
    expect(page.el('authStatus').textContent).toBe(FINISH_IN_WINDOW);
  });

  it('shows no failure it did not wait for', async () => {
    const page = await openOptions();
    await chrome.storage.session.set({ lastAuthError: 'Log in first — the keyboard shortcut saves nothing while you are logged out.' });
    await settle();
    expect(page.el('authStatus').textContent).toBe('');
    expect(chrome.storage.session.data.lastAuthError).toBeDefined();
  });
});

describe('options, bookmark sync', () => {
  const SYNC = 'bkm_sync';
  let server: FakeServer;

  async function withBackground(seed: FakeSeed = {}): Promise<void> {
    arrange({ local: { auth: auth({ token: SYNC }) }, sync: { baseUrl: S1 }, ...seed });
    server = new FakeServer();
    server.add('https://a.com/', 'A', ['dev']);
    stubFetch(server.route);
    await startBackground(chrome);
  }

  async function quiet(): Promise<void> {
    for (let i = 0; i < 100; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  }

  const lastSynced = () => {
    const at = (chrome.storage.local.data.sync as { lastSync: number }).lastSync;
    return `Last synced ${new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
  };

  it.each([
    ['Safari', { browser: 'safari' as const }],
    ['Firefox for Android', { browser: 'firefox' as const, android: true }],
  ])('is not offered where there are no bookmarks to sync (%s)', async (_name, { browser, ...rest }) => {
    arrange({ browser, local: { auth: auth() }, sync: { baseUrl: S1 } });
    if ('android' in rest) chrome.runtime.getPlatformInfo.mockResolvedValue({ os: 'android', arch: 'arm' });
    const page = await openOptions();
    expect(page.el('syncSection').hidden).toBe(true);
  });

  it('is off, and can’t be turned on, while logged out', async () => {
    arrange({ sync: { baseUrl: S1 } });
    const page = await openOptions();
    expect(page.el('syncSection').hidden).toBe(false);
    expect(page.el('syncToggle').checked).toBe(false);
    expect(page.el('syncToggle').disabled).toBe(true);
    expect(page.el('syncHint').hidden).toBe(false);
    expect(page.el('syncNow').hidden).toBe(true);
  });

  it('turning it on asks for bookmarks first, in the click, then fills the folder and says how it went', async () => {
    await withBackground();
    const page = await openOptions();
    expect(page.el('syncToggle').disabled).toBe(false);
    expect(page.el('syncHint').hidden).toBe(true);

    page.el('syncToggle').click();
    expect(page.el('syncStatus').textContent).toBe('');
    await quiet();

    expect(chrome.permissions.request).toHaveBeenCalledWith({ permissions: ['bookmarks'] });
    expect(chrome.permissions.request.mock.invocationCallOrder[0])
      .toBeLessThan(chrome.runtime.sendMessage.mock.invocationCallOrder[0]!);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sync', action: 'enable' });
    expect(chrome.bookmarks.tree.at('bukmark', 'dev')).toBeDefined();
    expect(page.el('syncToggle').checked).toBe(true);
    expect(page.el('syncToggle').disabled).toBe(false);
    expect(page.el('syncInfo').hidden).toBe(false);
    expect(page.el('syncInfo').textContent).toBe(`${lastSynced()} · 1 link in the bukmark folder.`);
    expect(page.el('syncNow').hidden).toBe(false);
    expect(page.el('syncStatus').textContent).toBe('');
  });

  it('in Firefox, asks to share bookmarks with the server in the same prompt', async () => {
    await withBackground({ browser: 'firefox' });
    const page = await openOptions();
    page.el('syncToggle').click();
    await quiet();
    expect(chrome.permissions.request).toHaveBeenCalledWith({ permissions: ['bookmarks'], data_collection: ['bookmarksInfo'] });
    expect(page.el('syncToggle').checked).toBe(true);
  });

  it('stays off, sending and reading nothing, when bookmarks are declined', async () => {
    await withBackground();
    chrome.permissions.request.mockResolvedValue(false);
    const page = await openOptions();
    page.el('syncToggle').click();
    await quiet();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(page.el('syncToggle').checked).toBe(false);
    expect(page.el('syncStatus').textContent).toBe('Not turned on — access to your bookmarks was declined.');
    expect(page.el('syncStatus').classList.contains('error')).toBe(true);
    expect(chrome.bookmarks.tree.at('bukmark')).toBeUndefined();
  });

  it('Sync now pulls, and follows pulls made elsewhere', async () => {
    await withBackground();
    const page = await openOptions();
    page.el('syncToggle').click();
    await quiet();
    server.add('https://b.com/', 'B');
    page.el('syncNow').click();
    expect(page.el('syncStatus').textContent).toBe('Syncing…');
    expect(page.el('syncNow').disabled).toBe(true);
    await quiet();
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({ type: 'sync', action: 'pull' });
    expect(page.el('syncInfo').textContent).toBe(`${lastSynced()} · 2 links in the bukmark folder.`);
    expect(page.el('syncNow').disabled).toBe(false);

    // The alarm's pull, in the background, shows here too.
    server.add('https://c.com/', 'C');
    fireAlarm(chrome, 'bukmark-sync');
    await quiet();
    expect(page.el('syncInfo').textContent).toContain('3 links in the bukmark folder.');
  });

  it('shows what went wrong, and changes waiting to be sent, until a sync works', async () => {
    await withBackground();
    const page = await openOptions();
    page.el('syncToggle').click();
    await quiet();
    server.offline = true;
    chrome.bookmarks.tree.create({ parentId: chrome.bookmarks.tree.at('bukmark', 'dev')!.id, title: 'N', url: 'https://n.com/' });
    await quiet();
    expect(page.el('syncStatus').textContent).toBe("Couldn't reach s1.lan:3000 — sync will try again in a few minutes.");
    expect(page.el('syncStatus').classList.contains('error')).toBe(true);
    expect(page.el('syncInfo').textContent).toContain('1 link in the bukmark folder, 1 change waiting to be sent.');

    server.offline = false;
    page.el('syncNow').click();
    await quiet();
    expect(page.el('syncStatus').textContent).toBe('');
    expect(page.el('syncInfo').textContent).toBe(`${lastSynced()} · 2 links in the bukmark folder.`);
  });

  it('warns when Chrome’s own sync carries the folder to other browsers, where bukmark may sync it too', async () => {
    await withBackground();
    const page = await openOptions();
    page.el('syncToggle').click();
    await quiet();
    expect(page.el('syncWarning').hidden).toBe(true);
    chrome.bookmarks.tree.syncing = true;
    page.el('syncNow').click();
    await quiet();
    expect(page.el('syncWarning').hidden).toBe(false);
    expect(readFileSync(new URL('../../options.html', import.meta.url), 'utf8'))
      .toMatch(/<p id="syncWarning"[^>]*>Your browser syncs this folder too\. Turn bukmark sync on in one browser only\.<\/p>/);
    page.el('syncToggle').click();
    await quiet();
    expect(page.el('syncWarning').hidden).toBe(true);
  });

  it('turning it off tells the background, and leaves the folder', async () => {
    await withBackground();
    const page = await openOptions();
    page.el('syncToggle').click();
    await quiet();
    page.el('syncToggle').click();
    await quiet();
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({ type: 'sync', action: 'disable' });
    expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
    expect(page.el('syncToggle').checked).toBe(false);
    expect(page.el('syncNow').hidden).toBe(true);
    expect(page.el('syncInfo').hidden).toBe(true);
    expect(chrome.bookmarks.tree.at('bukmark', 'dev')).toBeDefined();
  });

  it('shows sync off after Log out', async () => {
    await withBackground();
    stubFetch((req) => (req.url.endsWith('/api/auth/logout') ? { body: { ok: true } } : server.route(req)));
    const page = await openOptions();
    page.el('syncToggle').click();
    await quiet();
    page.el('logout').click();
    await quiet();
    expect(page.el('syncToggle').checked).toBe(false);
    expect(page.el('syncToggle').disabled).toBe(true);
    expect((chrome.storage.local.data.sync as { enabled: boolean }).enabled).toBe(false);
  });
});
