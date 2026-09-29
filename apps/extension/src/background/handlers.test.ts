import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../lib/auth';
import { STATUS, approve, fakeChrome, installed, runCommand, settle, stubFetch, type FakeChrome, type FakeRequest, type FakeSeed } from '../test/chrome';

const SERVER = 'http://nas.lan:3000';
const LOGGED_OUT = { title: 'Log in to bukmark first' };
const DEFAULT_TITLE = { title: 'Save to bukmark' };
const BADGE = { saved: { text: '✓' }, failed: { text: '!' }, loggedOut: { text: '?' } };

function auth(over: Partial<Auth> = {}): Auth {
  return { token: 'bkm_live', tokenId: 't1', server: SERVER, name: 'bukmark capture', createdAt: 1, ...over };
}

let chrome: FakeChrome;
let requests: FakeRequest[];

function arrange(seed: FakeSeed = {}): void {
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
    url.endsWith('/api/auth/status') ? { body: STATUS }
      : url.endsWith('/api/auth/token') ? { body: { token: 'bkm_new', tokenId: 'id-new', name: 'bukmark capture' } }
      : { body: { outcome: 'created', link: { dupeCount: 1 } } },
  );
});

// A background that started in the test may still be registering its menu
// (two turns each): let it finish before chrome goes away.
afterEach(async () => { await settle(); vi.unstubAllGlobals(); });

describe('first install', () => {
  it('opens the settings page with the setup steps, from the background as it starts', async () => {
    arrange();
    vi.resetModules();
    await import('./index');
    installed(chrome);
    await settle();
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: chrome.runtime.getURL('options.html?welcome') });
  });

  it.each(['update', 'chrome_update', 'shared_module_update'])('opens nothing on %s', async (reason) => {
    arrange();
    await (await handlers()).welcome({ reason });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});

describe('saveActiveTab (keyboard save)', () => {
  it('when logged out: flags it on the badge and the title, with no request, and leaves word for the popup', async () => {
    arrange();
    await (await handlers()).saveActiveTab();
    expect(requests).toHaveLength(0);
    expect(chrome.action.setTitle).toHaveBeenCalledWith(LOGGED_OUT);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith(BADGE.loggedOut);
    expect(chrome.storage.session.data.lastAuthError)
      .toBe('Log in first — the keyboard shortcut saves nothing while you are logged out.');
  });

  it('saves nothing, and sends nothing, for a page that is not on the web', async () => {
    arrange({ local: { auth: auth() }, sync: { baseUrl: SERVER } });
    chrome.tabs.query.mockResolvedValue([{ url: 'file:///Users/someone/secret.pdf', title: 'x' }]);
    await (await handlers()).saveActiveTab();
    expect(requests).toHaveLength(0);
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
  });

  it('never sends a token to a server other than the one that issued it', async () => {
    arrange({ local: { auth: auth({ server: 'http://a.lan:3000' }) }, sync: { baseUrl: 'http://b.lan:3000' } });
    await (await handlers()).saveActiveTab();
    expect(requests).toHaveLength(0);
    expect(chrome.action.setTitle).toHaveBeenCalledWith(LOGGED_OUT);
  });

  it('saves the tab to the token’s server, with the token', async () => {
    arrange({ local: { auth: auth() }, sync: { baseUrl: SERVER }, session: { lastSaveError: 'an old failure' } });
    await (await handlers()).saveActiveTab();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: `${SERVER}/api/links`,
      body: { url: 'https://example.com/article', title: 'An article' },
    });
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer bkm_live');
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith(BADGE.saved);
    expect(chrome.action.setTitle).toHaveBeenCalledWith(DEFAULT_TITLE);
    expect(chrome.storage.session.data.lastSaveError).toBeUndefined();
  });

  it('saves with the server kept in storage.local where there is no sync area (Opera)', async () => {
    arrange({ local: { auth: auth(), baseUrl: SERVER }, without: ['sync'] });
    await (await handlers()).saveActiveTab();
    expect(requests.map((r) => r.url)).toEqual([`${SERVER}/api/links`]);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith(BADGE.saved);
  });

  it('on a 401: forgets the token and says to log in', async () => {
    arrange({ local: { auth: auth() }, sync: { baseUrl: SERVER } });
    stubFetch(() => ({ status: 401, body: { error: 'Not authenticated' } }));
    await (await handlers()).saveActiveTab();
    expect(chrome.storage.local.data.auth).toBeUndefined();
    expect(chrome.action.setTitle).toHaveBeenCalledWith(LOGGED_OUT);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith(BADGE.loggedOut);
    expect(chrome.storage.session.data.lastAuthError).toBe('Your session ended — log in again.');
  });

  it('on any other failure: flags it without claiming the login is gone, and keeps the reason for the popup', async () => {
    arrange({ local: { auth: auth() }, sync: { baseUrl: SERVER } });
    stubFetch(() => ({ status: 500, body: { error: 'boom' } }));
    await (await handlers()).saveActiveTab();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith(BADGE.failed);
    expect(chrome.action.setTitle).not.toHaveBeenCalledWith(LOGGED_OUT);
    expect(chrome.storage.local.data.auth).toBeDefined();
    expect(chrome.storage.session.data.lastSaveError).toBe("The keyboard shortcut couldn't save that page: boom");
  });

  it('shows each outcome as different text, since Safari ignores the colour', () => {
    const texts = Object.values(BADGE).map((b) => b.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe('handleLogin', () => {
  it('on success: stores the token, clears a stale error, restores the title, flashes ✓', async () => {
    arrange({ session: { lastAuthError: 'Login cancelled.' } });
    await expect((await handlers()).handleLogin(SERVER)).resolves.toEqual({ ok: true });
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();
    expect(chrome.action.setTitle).toHaveBeenCalledWith(DEFAULT_TITLE);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith(BADGE.saved);
  });

  it('on failure: replies with the readable error and keeps it for the next popup', async () => {
    arrange();
    chrome.identity.launchWebAuthFlow.mockRejectedValue(new Error('The user did not approve access.'));
    await expect((await handlers()).handleLogin(SERVER)).resolves.toEqual({ ok: false, error: 'Login cancelled.' });
    expect(chrome.storage.session.data.lastAuthError).toBe('Login cancelled.');
  });

  it('keeps an unreachable server’s error for the next popup, having opened no window', async () => {
    arrange();
    stubFetch(() => new TypeError('Failed to fetch'));
    const error = "Couldn't reach nas.lan:3000 — check the address and that the server is running.";
    await expect((await handlers()).handleLogin(SERVER)).resolves.toEqual({ ok: false, error });
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
    expect(chrome.storage.session.data.lastAuthError).toBe(error);
  });

  it('does not show internal error text', async () => {
    arrange();
    chrome.identity.getRedirectURL.mockImplementation(() => { throw new TypeError('internal detail'); });
    await expect((await handlers()).handleLogin(SERVER)).resolves.toEqual({ ok: false, error: 'Login failed.' });
  });

  it('refuses a second login while a window is open, and allows one after', async () => {
    arrange();
    let allow: () => void = () => {};
    let opened: () => void = () => {};
    const open = new Promise<void>((resolve) => { opened = resolve; });
    chrome.identity.launchWebAuthFlow.mockImplementation(({ url }) =>
      new Promise((resolve) => { allow = () => resolve(approve(url)); opened(); }));
    const { handleLogin } = await handlers();

    const first = handleLogin(SERVER);
    await open;
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
  async function listeners(seed: FakeSeed = {}) {
    arrange(seed);
    vi.resetModules();
    await import('./index');
    return {
      onMessage: chrome.runtime.onMessage.addListener.mock.calls[0]![0],
      onCommand: (command: string) => runCommand(chrome, command),
    };
  }

  it('answers a login message asynchronously', async () => {
    const { onMessage } = await listeners();
    const reply = new Promise((sendResponse) => {
      expect(onMessage({ type: 'login', baseUrl: SERVER }, {}, sendResponse)).toBe(true);
    });
    await expect(reply).resolves.toEqual({ ok: true });
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

  it('still answers logins where there are no shortcuts (Firefox for Android), in a tab', async () => {
    arrange({ browser: 'firefox', without: ['commands', 'identity', 'bookmarks', 'windows'] });
    vi.resetModules();
    await expect(import('./index')).resolves.toBeDefined();
    const onMessage = chrome.runtime.onMessage.addListener.mock.calls[0]![0];
    const reply = new Promise((sendResponse) => {
      expect(onMessage({ type: 'login', baseUrl: SERVER }, {}, sendResponse)).toBe(true);
    });
    await expect(reply).resolves.toEqual({ ok: true, pending: true });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: expect.stringMatching(/^http:\/\/nas\.lan:3000\/authorize\?/) });
  });

  it('answers a page asking about a login in a tab', async () => {
    const { onMessage } = await listeners();
    const reply = new Promise((sendResponse) => {
      expect(onMessage({ type: 'resumeLogin' }, {}, sendResponse)).toBe(true);
    });
    await expect(reply).resolves.toBeNull();
  });
});
