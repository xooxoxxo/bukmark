import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Auth } from '../lib/auth';
import type { LoginRequest } from '../lib/login';
import { fakeChrome, settle, stubFetch, type FakeChrome, type FakeRequest } from '../test/chrome';
import { loadPage } from '../test/dom';

const SERVER = 'http://nas.lan:3000';
const SESSION_ENDED = 'Your session ended — log in again.';

function auth(over: Partial<Auth> = {}): Auth {
  return { token: 'bkm_live', tokenId: 't1', server: SERVER, name: 'bukmark capture', createdAt: 1, ...over };
}

let chrome: FakeChrome;
let requests: FakeRequest[];
let win: { close: Mock; location: { reload: Mock } };

function arrange(seed: Parameters<typeof fakeChrome>[0] = {}): void {
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

beforeEach(() => {
  vi.stubGlobal('setTimeout', vi.fn());
  vi.stubGlobal('setInterval', vi.fn(() => 1));
  vi.stubGlobal('clearInterval', vi.fn());
  requests = stubFetch(({ url }) =>
    url.endsWith('/api/hubs') ? { body: { items: [{ id: 'h1', name: 'rust', linkCount: 2 }] } }
      : url.endsWith('/api/auth/token') ? { body: { token: 'bkm_new', tokenId: 'id-new', name: 'bukmark capture' } }
      : { body: { outcome: 'created', link: { dupeCount: 1 } } },
  );
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('popup, logged out', () => {
  it('shows only the login form, prefilled with the default server', async () => {
    arrange();
    const page = await openPopup();
    expect(page.el('loginForm').hidden).toBe(false);
    expect(page.el('saveForm').hidden).toBe(true);
    expect(page.el('serverInput').value).toBe('http://localhost:3000');
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
    chrome.permissions.contains.mockResolvedValue(false);
    const { handleLogin } = await import('../background/handlers');
    chrome.runtime.sendMessage.mockImplementation(async (m) => handleLogin((m as LoginRequest).baseUrl));

    const page = await openPopup();
    page.el('serverInput').value = `${SERVER}/`;
    page.el('loginButton').click();
    await settle();

    const order = (fn: Mock) => fn.mock.invocationCallOrder[0]!;
    expect(order(chrome.permissions.request)).toBeLessThan(order(chrome.storage.sync.set));
    expect(order(chrome.storage.sync.set)).toBeLessThan(order(chrome.runtime.sendMessage));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.storage.sync.data.baseUrl).toBe(SERVER);
    expect(chrome.storage.local.data.auth).toMatchObject({ server: SERVER, token: 'bkm_new' });
    expect(win.location.reload).toHaveBeenCalled();

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

  it('changes nothing when the host permission is declined', async () => {
    arrange();
    chrome.permissions.contains.mockResolvedValue(false);
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

describe('popup, logged in', () => {
  beforeEach(() => {
    arrange({ local: { auth: auth() }, sync: { baseUrl: SERVER } });
  });

  it('shows the save form with the hubs and a footer naming the server', async () => {
    const page = await openPopup();
    expect(page.el('saveForm').hidden).toBe(false);
    expect(page.el('loginForm').hidden).toBe(true);
    expect(page.el('title').value).toBe('An article');
    expect(page.el('hub').children.map((o) => o.textContent)).toEqual(['rust (2)']);
    expect(page.el('serverHost').textContent).toBe('nas.lan:3000');
  });

  it('opens the options page from the footer’s Settings', async () => {
    const page = await openPopup();
    page.el('openSettings').click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
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
