import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { STATUS, fakeChrome, settle, stubFetch, type FakeChrome, type FakeSeed } from '../test/chrome';
import type { Auth } from './auth';
import { requestLogin, useAccessToken } from './login';
import { popupHostAccess } from './permissions';

const SERVER = 'http://nas.lan:3000';
const TOKEN = 'bkm_AbCdEfGh0123456789abcdefghijklmnopqrstuvwxyz';

let chrome: FakeChrome;

function arrange(seed: FakeSeed = {}): void {
  chrome = fakeChrome(seed);
  vi.stubGlobal('chrome', chrome);
}

beforeEach(() => arrange());

afterEach(() => { vi.unstubAllGlobals(); });

const firstCall = (fn: Mock) => fn.mock.invocationCallOrder[0] ?? Infinity;

/** No storage read or write before `mark`: the click still counts as a gesture. */
function nothingStoredBefore(mark: Mock): void {
  for (const area of [chrome.storage.local, chrome.storage.sync, chrome.storage.session]) {
    for (const fn of [area.get, area.set, area.remove]) expect(firstCall(fn)).toBeGreaterThan(firstCall(mark));
  }
}

describe('requestLogin', () => {
  it('asks for the host, saves it as the server, then has the background log in', async () => {
    await expect(requestLogin(' http://nas.lan:3000/ ')).resolves.toEqual({ ok: true });

    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['http://nas.lan/*'] });
    expect(chrome.storage.sync.data.baseUrl).toBe('http://nas.lan:3000');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login', baseUrl: 'http://nas.lan:3000' });
    expect(firstCall(chrome.permissions.request)).toBeLessThan(firstCall(chrome.storage.sync.set));
    expect(firstCall(chrome.storage.sync.set)).toBeLessThan(firstCall(chrome.runtime.sendMessage));
  });

  it('asks for the host before anything else, even when access was granted before', async () => {
    const pending = requestLogin('http://nas.lan:3000');
    expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
    await pending;
    expect(chrome.permissions.contains).not.toHaveBeenCalled();
    nothingStoredBefore(chrome.permissions.request);
  });

  it('changes nothing when the prompt is declined', async () => {
    chrome.permissions.request.mockResolvedValue(false);
    await expect(requestLogin('http://nas.lan:3000')).resolves.toEqual({
      ok: false,
      error: 'Not logged in — access to that address was declined.',
    });
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('turns away an address that is not http(s) without prompting', async () => {
    const result = await requestLogin('nas.lan:3000');
    expect(result).toEqual({ ok: false, error: 'Enter the server address, starting with http:// or https://' });
    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it('returns the background’s error and drops the copy kept for the next popup', async () => {
    chrome.storage.session.data.lastAuthError = 'Login cancelled.';
    chrome.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'Login cancelled.' });
    await expect(requestLogin('http://nas.lan:3000')).resolves.toEqual({ ok: false, error: 'Login cancelled.' });
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();
  });

  it('treats a missing reply as a failed login', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(undefined);
    await expect(requestLogin('http://nas.lan:3000')).resolves.toEqual({ ok: false, error: 'Login failed.' });
  });
});

describe('requestLogin from Firefox’s popup', () => {
  beforeEach(() => arrange({ browser: 'firefox' }));

  it('logs in to a server already granted, without a prompt Firefox would refuse', async () => {
    await expect(requestLogin(SERVER, popupHostAccess)).resolves.toEqual({ ok: true });
    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login', baseUrl: SERVER });
  });

  it('hands a new server to the options page, which can show the prompt', async () => {
    chrome.permissions.contains.mockResolvedValue(false);
    const result = await requestLogin(`${SERVER}/`, popupHostAccess);
    expect(result).toEqual({
      ok: false,
      error: 'Firefox asks for access to a new server on the settings page — continue there.',
    });
    expect(chrome.storage.session.data.serverToGrant).toBe(SERVER);
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe('useAccessToken', () => {
  function server(authenticated = true) {
    return stubFetch(({ url }) =>
      url.endsWith('/api/auth/status') ? { body: { ...STATUS, authenticated } } : { body: { ok: true } });
  }

  it('checks the token with its server, then keeps it like a login, bound to that server', async () => {
    const requests = server();
    await expect(useAccessToken(`${SERVER}/`, `  ${TOKEN}\n`)).resolves.toEqual({ ok: true });

    expect(requests.map((r) => [r.method, r.url, r.headers.get('authorization')]))
      .toEqual([['GET', `${SERVER}/api/auth/status`, `Bearer ${TOKEN}`]]);
    expect(chrome.storage.local.data.auth).toMatchObject({ token: TOKEN, server: SERVER });
    expect(chrome.storage.sync.data.baseUrl).toBe(SERVER);
  });

  it('asks for the host first, before any request', async () => {
    server();
    const pending = useAccessToken(SERVER, TOKEN);
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['http://nas.lan/*'] });
    await pending;
    expect(firstCall(chrome.permissions.request)).toBeLessThan(firstCall(vi.mocked(fetch)));
    nothingStoredBefore(chrome.permissions.request);
  });

  it('changes nothing when the server refuses the token', async () => {
    server(false);
    chrome.storage.sync.data.baseUrl = 'http://old.lan:3000';
    const result = await useAccessToken(SERVER, TOKEN);
    expect(result).toEqual({
      ok: false,
      error: "nas.lan:3000 didn't accept that token — copy it again, or create a new one in the web app under Settings › Access tokens.",
    });
    expect(chrome.storage.local.data.auth).toBeUndefined();
    expect(chrome.storage.sync.data.baseUrl).toBe('http://old.lan:3000');
  });

  it('says when the server cannot be reached', async () => {
    stubFetch(() => new TypeError('Failed to fetch'));
    await expect(useAccessToken(SERVER, TOKEN)).resolves.toEqual({
      ok: false,
      error: "Couldn't reach nas.lan:3000 — check the address and that the server is running.",
    });
  });

  it.each([
    ['nothing', '   ', 'Paste an access token first.'],
    ['a token broken across lines', 'bkm_abc\ndef', "That doesn't look like an access token — copy it again from the web app."],
  ])('turns away %s without prompting or sending it', async (_case, token, error) => {
    const requests = server();
    await expect(useAccessToken(SERVER, token)).resolves.toEqual({ ok: false, error });
    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it('sends nothing when access to the server is declined', async () => {
    const requests = server();
    chrome.permissions.request.mockResolvedValue(false);
    await expect(useAccessToken(SERVER, TOKEN)).resolves.toEqual({
      ok: false,
      error: 'Not logged in — access to that address was declined.',
    });
    expect(requests).toHaveLength(0);
  });

  it('revokes the token it replaces, as a login does', async () => {
    const old: Auth = { token: 'bkm_old', tokenId: 't0', server: 'http://old.lan:3000', name: 'bukmark capture', createdAt: 1 };
    chrome.storage.local.data.auth = old;
    const requests = server();
    await useAccessToken(SERVER, TOKEN);
    await settle();
    const revoke = requests.find((r) => r.url.endsWith('/api/auth/logout'));
    expect(revoke).toMatchObject({ method: 'POST', url: 'http://old.lan:3000/api/auth/logout' });
    expect(revoke!.headers.get('authorization')).toBe('Bearer bkm_old');
  });

  it('works from Firefox’s popup for a server already granted', async () => {
    arrange({ browser: 'firefox' });
    server();
    await expect(useAccessToken(SERVER, TOKEN, popupHostAccess)).resolves.toEqual({ ok: true });
    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(chrome.storage.local.data.auth).toMatchObject({ token: TOKEN, server: SERVER });
  });
});
