import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Auth } from '../lib/auth';
import type { LoginRequest } from '../lib/login';
import {
  STATUS,
  approve,
  closeTab,
  fakeChrome,
  navigate,
  replied,
  settle,
  startBackground,
  stubFetch,
  type FakeChrome,
  type FakeRequest,
  type FakeSeed,
} from '../test/chrome';
import { loadPage } from '../test/dom';

const SERVER = 'http://nas.lan:3000';
const SESSION_ENDED = 'Your session ended — log in again.';
const FINISH_IN_WINDOW = 'Finish signing in in the bukmark window.';
const TOKEN = 'bkm_AbCdEfGh0123456789abcdefghijklmnopqrstuvwxyz';

function auth(over: Partial<Auth> = {}): Auth {
  return { token: 'bkm_live', tokenId: 't1', server: SERVER, name: 'bukmark capture', createdAt: 1, ...over };
}

let chrome: FakeChrome;
let requests: FakeRequest[];
let win: { close: Mock; location: { reload: Mock } };

function arrange(seed: FakeSeed = {}): void {
  chrome = fakeChrome(seed);
  vi.stubGlobal('chrome', chrome);
}

/** Opens the popup against the current chrome state, as a click on the toolbar button does. */
async function openPopup() {
  const page = loadPage('popup.html');
  win = { close: vi.fn(), location: { reload: vi.fn() } };
  vi.stubGlobal('document', page.document);
  vi.stubGlobal('window', win);
  vi.resetModules();
  await import('./main');
  await settle();
  return page;
}

/** A current server that accepts `token` as a bearer, if one is given. */
const NOTHING_KNOWN = { saved: null, domain: { host: 'example.com', links: 0, hubs: [] } };

function server(token?: string, known: unknown = NOTHING_KNOWN) {
  return stubFetch(({ url, headers }) =>
    url.endsWith('/api/hubs') ? { body: { items: [{ id: 'h1', name: 'rust', linkCount: 2 }] } }
      : url.includes('/api/links/lookup') ? { body: known }
      : url.endsWith('/api/auth/status')
        ? { body: { ...STATUS, authenticated: token !== undefined && headers.get('authorization') === `Bearer ${token}` } }
      : url.endsWith('/api/auth/token') ? { body: { token: 'bkm_new', tokenId: 'id-new', name: 'bukmark capture' } }
      : { body: { outcome: 'created', link: { dupeCount: 1 } } },
  );
}

beforeEach(() => {
  vi.stubGlobal('setTimeout', vi.fn());
  vi.stubGlobal('setInterval', vi.fn(() => 1));
  vi.stubGlobal('clearInterval', vi.fn());
  requests = server(TOKEN);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('popup, logged out', () => {
  it('shows only the login form, prefilled with the default server', async () => {
    arrange();
    const page = await openPopup();
    expect(page.el('loginForm').hidden).toBe(false);
    expect(page.el('saveForm').hidden).toBe(true);
    expect(page.el('serverInput').value).toBe('http://localhost:3000');
    expect(page.el('tokenForm').hidden).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('treats a token from another server as logged out and sends it nowhere', async () => {
    arrange({ local: { auth: auth({ server: 'http://a.lan:3000' }) }, sync: { baseUrl: 'http://b.lan:3000' } });
    const page = await openPopup();
    expect(page.el('loginForm').hidden).toBe(false);
    expect(page.el('serverInput').value).toBe('http://b.lan:3000');
    expect(requests).toHaveLength(0);
  });

  it('logs in to the server typed in the field, and is logged in there afterwards', async () => {
    arrange();
    const { handleLogin } = await import('../background/handlers');
    chrome.runtime.sendMessage.mockImplementation(async (m) => handleLogin((m as LoginRequest).baseUrl));

    const page = await openPopup();
    page.el('serverInput').value = `${SERVER}/`;
    page.el('loginButton').click();
    await replied(chrome);

    const order = (fn: Mock) => fn.mock.invocationCallOrder[0]!;
    expect(order(chrome.permissions.request)).toBeLessThan(order(chrome.storage.sync.set));
    expect(order(chrome.storage.sync.set)).toBeLessThan(order(chrome.runtime.sendMessage));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.storage.sync.data.baseUrl).toBe(SERVER);
    expect(chrome.storage.local.data.auth).toMatchObject({ server: SERVER, token: 'bkm_new' });
    // Once, though both the reply and the stored login announce it.
    expect(win.location.reload).toHaveBeenCalledTimes(1);

    const reopened = await openPopup();
    expect(reopened.el('saveForm').hidden).toBe(false);
    expect(reopened.el('loginForm').hidden).toBe(true);
    const hubs = requests.find((r) => r.url === `${SERVER}/api/hubs`);
    expect(hubs?.headers.get('authorization')).toBe('Bearer bkm_new');
  });

  it('shows an error the background replies with, once, and lets you retry', async () => {
    arrange();
    chrome.runtime.sendMessage.mockImplementation(async () => {
      await chrome.storage.session.set({ lastAuthError: 'Login cancelled.' });
      return { ok: false, error: 'Login cancelled.' };
    });
    const page = await openPopup();
    page.el('loginButton').click();
    await settle();

    expect(page.el('loginStatus').textContent).toBe('Login cancelled.');
    expect(page.el('loginStatus').classList.contains('error')).toBe(true);
    expect(page.el('loginButton').disabled).toBe(false);
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();
  });

  it('shows the error left by a login whose popup had closed, then forgets it', async () => {
    arrange({ session: { lastAuthError: 'Access was denied in the bukmark window.' } });
    const page = await openPopup();
    expect(page.el('loginStatus').textContent).toBe('Access was denied in the bukmark window.');
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();

    const reopened = await openPopup();
    expect(reopened.el('loginStatus').textContent).toBe('');
  });

  it('says why, after the keyboard shortcut was used while logged out', async () => {
    arrange();
    const { saveActiveTab } = await import('../background/handlers');
    await saveActiveTab();
    const page = await openPopup();
    expect(page.el('loginStatus').textContent)
      .toBe('Log in first — the keyboard shortcut saves nothing while you are logged out.');
  });

  it('changes nothing when the host permission is declined', async () => {
    arrange();
    chrome.permissions.request.mockResolvedValue(false);
    const page = await openPopup();
    page.el('serverInput').value = SERVER;
    page.el('loginButton').click();
    await settle();

    expect(page.el('loginStatus').textContent).toBe('Not logged in — access to that address was declined.');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(page.el('loginButton').disabled).toBe(false);
  });
});

describe('popup, using an access token', () => {
  it('offers a token field instead of logging in', async () => {
    arrange();
    const page = await openPopup();
    page.el('showToken').click();
    expect(page.el('tokenForm').hidden).toBe(false);
    expect(page.el('showToken').hidden).toBe(true);
    expect(page.el('tokenInput').focused).toBe(true);
  });

  it('logs in with a token the server accepts, and saves with it afterwards', async () => {
    arrange();
    const page = await openPopup();
    page.el('serverInput').value = SERVER;
    page.el('showToken').click();
    page.el('tokenInput').value = TOKEN;
    page.el('useToken').click();
    await settle();

    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['http://nas.lan/*'] });
    expect(chrome.storage.local.data.auth).toMatchObject({ token: TOKEN, server: SERVER });
    expect(win.location.reload).toHaveBeenCalled();

    const reopened = await openPopup();
    reopened.el('save').click();
    await settle();
    const save = requests.find((r) => r.method === 'POST' && r.url === `${SERVER}/api/links`);
    expect(save?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('says so when the server refuses the token, and lets you try again', async () => {
    arrange();
    const page = await openPopup();
    page.el('serverInput').value = SERVER;
    page.el('showToken').click();
    page.el('tokenInput').value = 'bkm_wrong';
    page.el('useToken').click();
    await settle();

    expect(page.el('loginStatus').textContent).toMatch(/^nas\.lan:3000 didn't accept that token/);
    expect(page.el('loginStatus').classList.contains('error')).toBe(true);
    expect(page.el('useToken').disabled).toBe(false);
    expect(chrome.storage.local.data.auth).toBeUndefined();
    expect(win.location.reload).not.toHaveBeenCalled();
  });
});

describe('popup in Firefox', () => {
  beforeEach(() => arrange({ browser: 'firefox' }));

  it('sends a new server to the settings page instead of prompting over the popup', async () => {
    chrome.permissions.contains.mockResolvedValue(false);
    const page = await openPopup();
    page.el('serverInput').value = SERVER;
    page.el('loginButton').click();
    await settle();

    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
    expect(chrome.storage.session.data.serverToGrant).toBe(SERVER);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('logs in to a server it already has access to, without a prompt', async () => {
    const page = await openPopup();
    page.el('serverInput').value = SERVER;
    page.el('loginButton').click();
    await settle();

    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login', baseUrl: SERVER });
  });
});

describe('popup, logged in', () => {
  beforeEach(() => {
    arrange({ local: { auth: auth() }, sync: { baseUrl: SERVER } });
  });

  it('shows the save form with the hubs by name, and no footer', async () => {
    const page = await openPopup();
    expect(page.el('saveForm').hidden).toBe(false);
    expect(page.el('loginForm').hidden).toBe(true);
    expect(page.el('title').value).toBe('An article');
    expect(page.el('hub').children.map((o) => o.textContent)).toEqual(['rust']);
    // The server and the shortcut are on the settings page.
    for (const id of ['serverHost', 'openSettings', 'shortcutHint']) expect(() => page.el(id)).toThrow();
  });

  it.each(['file:///Users/someone/notes.txt', 'chrome://extensions/', 'about:blank', 'moz-extension://x/options.html'])(
    'never sends %s anywhere, not even to ask, and says only web pages can be saved',
    async (url) => {
      chrome.tabs.query.mockResolvedValue([{ url, title: 'Local' }]);
      const page = await openPopup();
      expect(requests).toHaveLength(0);
      expect(page.el('status').textContent).toBe('Only web pages (http or https) can be saved.');
      expect(page.el('save').disabled).toBe(true);
    },
  );

  it('says what leaves the browser, on the login form', () => {
    const html = readFileSync(new URL('../../popup.html', import.meta.url), 'utf8');
    const login = html.slice(html.indexOf('id="loginForm"'), html.indexOf('id="saveForm"'));
    expect(login).toContain('Saving a page sends its address and title to this server, and nowhere else.');
    expect(login).toContain('Opening this popup on a page sends its address there too');
  });

  it('asks the server what it knows of the page, with the token', async () => {
    await openPopup();
    const lookup = requests.find((r) => r.url.includes('/api/links/lookup'));
    expect(lookup?.url).toBe(`${SERVER}/api/links/lookup?url=${encodeURIComponent('https://example.com/article')}`);
    expect(lookup?.headers.get('authorization')).toBe('Bearer bkm_live');
  });

  it('says nothing more for a page and site never saved', async () => {
    const page = await openPopup();
    expect(page.el('known').hidden).toBe(true);
    expect(page.el('hub').value).toBe('');
  });

  it('says a page is already saved and where, and keeps it filed there', async () => {
    requests = server(TOKEN, { saved: { hubs: ['rust'] }, domain: { host: 'example.com', links: 3, hubs: [] } });
    const page = await openPopup();
    expect(page.el('known').hidden).toBe(false);
    expect(page.el('known').textContent).toBe('Already saved — in rust');
    expect(page.el('hub').value).toBe('rust');
  });

  it('names the hub most of the site is in, without filing the page there', async () => {
    requests = server(TOKEN, {
      saved: null,
      domain: { host: 'example.com', links: 4, hubs: [{ name: 'rust', links: 3 }] },
    });
    const page = await openPopup();
    expect(page.el('known').textContent).toBe('4 links from example.com saved — most in rust');
    expect(page.el('hub').value).toBe('');
  });

  it('still saves when the server cannot say what it knows', async () => {
    requests = stubFetch(({ url }) =>
      url.endsWith('/api/hubs') ? { body: { items: [] } }
        : url.includes('/api/links/lookup') ? { status: 500, body: { error: 'boom' } }
        : { body: { outcome: 'created', link: { dupeCount: 1 } } });
    const page = await openPopup();
    expect(page.el('known').hidden).toBe(true);
    expect(page.el('status').textContent).toBe('');
    page.el('save').click();
    await settle();
    expect(page.el('status').textContent).toBe('Saved');
  });

  it('saves the page to the token’s server, with the token', async () => {
    const page = await openPopup();
    page.el('note').value = 'why it matters';
    page.el('save').click();
    await settle();

    const save = requests.find((r) => r.method === 'POST');
    expect(save).toMatchObject({
      url: `${SERVER}/api/links`,
      body: { url: 'https://example.com/article', title: 'An article', note: 'why it matters' },
    });
    expect(save!.headers.get('authorization')).toBe('Bearer bkm_live');
    expect(page.el('status').textContent).toBe('Saved');
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 700);
  });

  it('says why the last keyboard save failed, once', async () => {
    stubFetch(({ method, url }) =>
      method === 'POST' ? { status: 500, body: { error: 'boom' } }
        : url.endsWith('/api/hubs') ? { body: { items: [] } } : { status: 404 });
    const { saveActiveTab } = await import('../background/handlers');
    await saveActiveTab();

    const page = await openPopup();
    expect(page.el('status').textContent).toBe("The keyboard shortcut couldn't save that page: boom");
    expect(page.el('status').classList.contains('error')).toBe(true);
    const reopened = await openPopup();
    expect(reopened.el('status').textContent).toBe('');
  });

  it('switches to a working login form when the token was revoked', async () => {
    stubFetch(() => ({ status: 401, body: { error: 'Not authenticated' } }));
    const page = await openPopup();

    expect(page.el('loginForm').hidden).toBe(false);
    expect(page.el('saveForm').hidden).toBe(true);
    expect(page.el('loginStatus').textContent).toBe(SESSION_ENDED);
    expect(page.el('serverInput').value).toBe(SERVER);
    expect(chrome.storage.local.data.auth).toBeUndefined();

    page.el('loginButton').click();
    await settle();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login', baseUrl: SERVER });
  });

  it('does the same when Save gets a 401', async () => {
    stubFetch(({ method }) =>
      method === 'POST' ? { status: 401, body: { error: 'Not authenticated' } } : { body: { items: [] } });
    const page = await openPopup();
    page.el('save').click();
    await settle();

    expect(page.el('loginForm').hidden).toBe(false);
    expect(page.el('loginStatus').textContent).toBe(SESSION_ENDED);
    page.el('loginButton').click();
    await settle();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login', baseUrl: SERVER });
  });
});

describe('popup where the browser has no shortcuts (Firefox for Android)', () => {
  it('opens on the save form', async () => {
    arrange({ local: { auth: auth() }, sync: { baseUrl: SERVER }, browser: 'firefox', without: ['commands'] });
    const page = await openPopup();
    expect(page.el('saveForm').hidden).toBe(false);
  });
});

describe('popup where logins run in a tab (Safari)', () => {
  beforeEach(async () => {
    arrange({ browser: 'safari' });
    await startBackground(chrome);
  });

  /** Log in from the popup: the background opens the server's page in a window of its own. */
  async function logInFromPopup() {
    const page = await openPopup();
    page.el('serverInput').value = SERVER;
    page.el('loginButton').click();
    await replied(chrome);
    const [tab] = [...chrome.tabs.data.values()];
    return { page, tab: tab! };
  }

  async function reopenPopup() {
    const page = await openPopup();
    await replied(chrome);
    return page;
  }

  it('says where to finish after Log in, and keeps the form usable', async () => {
    const { page } = await logInFromPopup();
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
    expect(page.el('loginStatus').textContent).toBe(FINISH_IN_WINDOW);
    expect(page.el('loginStatus').classList.contains('error')).toBe(false);
    expect(page.el('loginButton').disabled).toBe(false);
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('switches the popup that clicked Log in to the save form once Allow finishes the login', async () => {
    const { page, tab } = await logInFromPopup();
    navigate(chrome, tab.id, approve(tab.url));
    await replied(chrome);

    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(page.el('loginStatus').classList.contains('error')).toBe(false);
  });

  it('shows the popup that clicked Log in why the login ended, and only there', async () => {
    const { page, tab } = await logInFromPopup();
    closeTab(chrome, tab.id);
    await replied(chrome);

    expect(page.el('loginStatus').textContent).toBe('Login cancelled.');
    expect(page.el('loginStatus').classList.contains('error')).toBe(true);
    expect(page.el('loginButton').disabled).toBe(false);
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();
  });

  it('on opening, finishes a login whose tab already shows the reply, and is ready to save', async () => {
    const { tab } = await logInFromPopup();
    // Allowed in the bukmark window while the background was unloaded: no event came (iOS).
    chrome.tabs.data.get(tab.id)!.url = approve(tab.url);

    const page = await reopenPopup();
    expect(page.el('saveForm').hidden).toBe(false);
    expect(page.el('loginForm').hidden).toBe(true);
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
    expect(chrome.tabs.data.has(tab.id)).toBe(false);
    const hubs = requests.find((r) => r.url === `${SERVER}/api/hubs`);
    expect(hubs?.headers.get('authorization')).toBe('Bearer bkm_new');
  });

  it('on opening while the login waits, says where to finish', async () => {
    await logInFromPopup();
    const page = await reopenPopup();
    expect(page.el('loginForm').hidden).toBe(false);
    expect(page.el('loginStatus').textContent).toBe(FINISH_IN_WINDOW);
    expect(page.el('loginStatus').classList.contains('error')).toBe(false);
    expect(chrome.storage.session.data.pendingLogin).toBeDefined();
  });

  it('on opening after the login’s tab closed unseen, says it was cancelled, once', async () => {
    const { tab } = await logInFromPopup();
    chrome.tabs.data.delete(tab.id);

    const page = await reopenPopup();
    expect(page.el('loginStatus').textContent).toBe('Login cancelled.');
    expect(page.el('loginStatus').classList.contains('error')).toBe(true);
    const again = await reopenPopup();
    expect(again.el('loginStatus').textContent).toBe('');
  });
});
