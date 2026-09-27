import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../lib/auth';
import { approve, fakeChrome, settle, stubFetch, type FakeChrome, type FakeRequest } from '../test/chrome';

const SERVER = 'http://nas.lan:3000';
const LOGGED_OUT = { title: 'Log in to bukmark first' };
const DEFAULT_TITLE = { title: 'Save to bukmark' };

function auth(over: Partial<Auth> = {}): Auth {
  return { token: 'bkm_live', tokenId: 't1', server: SERVER, name: 'bukmark capture', createdAt: 1, ...over };
}

let chrome: FakeChrome;
let requests: FakeRequest[];

function arrange(seed: Parameters<typeof fakeChrome>[0] = {}): void {
  chrome = fakeChrome(seed);
  vi.stubGlobal('chrome', chrome);
}

async function handlers() {
  vi.resetModules();
  return import('./handlers');
}

beforeEach(() => {
  vi.stubGlobal('setTimeout', vi.fn());
  vi.stubGlobal('setInterval', vi.fn(() => 1));
  vi.stubGlobal('clearInterval', vi.fn());
  requests = stubFetch(({ url }) =>
    url.endsWith('/api/auth/token')
      ? { body: { token: 'bkm_new', tokenId: 'id-new', name: 'bukmark capture' } }
      : { body: { outcome: 'created', link: { dupeCount: 1 } } },
  );
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('saveActiveTab (keyboard save)', () => {
  it('when logged out: flags it on the badge and the title, with no request', async () => {
    arrange();
    await (await handlers()).saveActiveTab();
    expect(requests).toHaveLength(0);
    expect(chrome.action.setTitle).toHaveBeenCalledWith(LOGGED_OUT);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
  });

  it('never sends a token to a server other than the one that issued it', async () => {
    arrange({ local: { auth: auth({ server: 'http://a.lan:3000' }) }, sync: { baseUrl: 'http://b.lan:3000' } });
    await (await handlers()).saveActiveTab();
    expect(requests).toHaveLength(0);
    expect(chrome.action.setTitle).toHaveBeenCalledWith(LOGGED_OUT);
  });

  it('saves the tab to the token’s server, with the token', async () => {
    arrange({ local: { auth: auth() }, sync: { baseUrl: SERVER } });
    await (await handlers()).saveActiveTab();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: `${SERVER}/api/links`,
      body: { url: 'https://example.com/article', title: 'An article' },
    });
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer bkm_live');
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '✓' });
    expect(chrome.action.setTitle).toHaveBeenCalledWith(DEFAULT_TITLE);
  });

  it('on a 401: forgets the token and says to log in', async () => {
    arrange({ local: { auth: auth() }, sync: { baseUrl: SERVER } });
    stubFetch(() => ({ status: 401, body: { error: 'Not authenticated' } }));
    await (await handlers()).saveActiveTab();
    expect(chrome.storage.local.data.auth).toBeUndefined();
    expect(chrome.action.setTitle).toHaveBeenCalledWith(LOGGED_OUT);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
  });

  it('on any other failure: flags it without claiming the login is gone', async () => {
    arrange({ local: { auth: auth() }, sync: { baseUrl: SERVER } });
    stubFetch(() => ({ status: 500, body: { error: 'boom' } }));
    await (await handlers()).saveActiveTab();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
    expect(chrome.action.setTitle).not.toHaveBeenCalledWith(LOGGED_OUT);
    expect(chrome.storage.local.data.auth).toBeDefined();
  });
});

describe('handleLogin', () => {
  it('on success: stores the token, clears a stale error, restores the title, flashes ✓', async () => {
    arrange({ session: { lastAuthError: 'Login cancelled.' } });
    await expect((await handlers()).handleLogin(SERVER)).resolves.toEqual({ ok: true });
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();
    expect(chrome.action.setTitle).toHaveBeenCalledWith(DEFAULT_TITLE);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '✓' });
  });

  it('on failure: replies with the readable error and keeps it for the next popup', async () => {
    arrange();
    chrome.identity.launchWebAuthFlow.mockRejectedValue(new Error('The user did not approve access.'));
    await expect((await handlers()).handleLogin(SERVER)).resolves.toEqual({ ok: false, error: 'Login cancelled.' });
    expect(chrome.storage.session.data.lastAuthError).toBe('Login cancelled.');
  });

  it('does not show internal error text', async () => {
    arrange();
    chrome.identity.getRedirectURL.mockImplementation(() => { throw new TypeError('internal detail'); });
    await expect((await handlers()).handleLogin(SERVER)).resolves.toEqual({ ok: false, error: 'Login failed.' });
  });

  it('refuses a second login while a window is open, and allows one after', async () => {
    arrange();
    let allow: () => void = () => {};
    chrome.identity.launchWebAuthFlow.mockImplementation(({ url }) =>
      new Promise((resolve) => { allow = () => resolve(approve(url)); }));
    const { handleLogin } = await handlers();

    const first = handleLogin(SERVER);
    await settle();
    await expect(handleLogin(SERVER)).resolves.toEqual({
      ok: false,
      error: 'A bukmark login window is already open.',
    });
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1);

    allow();
    await expect(first).resolves.toEqual({ ok: true });
    chrome.identity.launchWebAuthFlow.mockImplementation(async ({ url }) => approve(url));
    await expect(handleLogin(SERVER)).resolves.toEqual({ ok: true });
  });
});

describe('background wiring', () => {
  async function listeners() {
    arrange();
    vi.resetModules();
    await import('./index');
    return {
      onMessage: chrome.runtime.onMessage.addListener.mock.calls[0]![0],
      onCommand: chrome.commands.onCommand.addListener.mock.calls[0]![0],
    };
  }

  it('answers a login message asynchronously', async () => {
    const { onMessage } = await listeners();
    const sendResponse = vi.fn();
    expect(onMessage({ type: 'login', baseUrl: SERVER }, {}, sendResponse)).toBe(true);
    await settle();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it('ignores anything that is not a well-formed login message', async () => {
    const { onMessage } = await listeners();
    const sendResponse = vi.fn();
    expect(onMessage({ type: 'login' }, {}, sendResponse)).toBeUndefined();
    expect(onMessage({ type: 'other', baseUrl: SERVER }, {}, sendResponse)).toBeUndefined();
    expect(onMessage(undefined, {}, sendResponse)).toBeUndefined();
    await settle();
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it('runs the keyboard save on its command only', async () => {
    const { onCommand } = await listeners();
    onCommand('something-else');
    await settle();
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    onCommand('save-current-tab');
    await settle();
    expect(chrome.action.setTitle).toHaveBeenCalledWith(LOGGED_OUT);
  });
});
