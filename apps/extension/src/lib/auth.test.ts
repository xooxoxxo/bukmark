import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXTENSION_ID,
  REDIRECT_URI,
  STATUS,
  approve,
  fakeChrome,
  firefoxRedirectURL,
  settle,
  stubFetch,
  type FakeChrome,
  type FakeRequest,
  type FakeSeed,
} from '../test/chrome';
import {
  AuthRequiredError,
  IdentityUnsupportedError,
  LoginError,
  adopt,
  authFor,
  buildAuthorizeRequest,
  clearAuth,
  finishLogin,
  generateState,
  generateVerifier,
  identityFlowAvailable,
  identityRedirectKind,
  loadAuth,
  loginFlow,
  logout,
  pkceS256,
  saveAuth,
  verifyToken,
  type Auth,
} from './auth';

const SERVER = 'http://nas.lan:3000';
const UPDATE_SERVER = "Update your bukmark server — nas.lan:3000 can't log in this browser yet.";
const UNREACHABLE = "Couldn't reach nas.lan:3000 — check the address and that the server is running.";

function auth(over: Partial<Auth> = {}): Auth {
  return { token: 'bkm_live', tokenId: 't1', server: SERVER, name: 'bukmark capture', createdAt: 1, ...over };
}

async function failure(promise: Promise<unknown>): Promise<LoginError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(LoginError);
  return err as LoginError;
}

/** A current server: status with every redirect kind, and a token for any code. */
function server(over: { status?: { status?: number; body?: unknown } | Error } = {}) {
  return stubFetch(({ url }) => {
    if (url.endsWith('/api/auth/status')) return over.status ?? { body: STATUS };
    if (url.endsWith('/api/auth/token')) return { body: { token: 'bkm_new', tokenId: 'id-new', name: 'bukmark capture' } };
    return { status: 404 };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('generateVerifier', () => {
  it('generates a 43-character base64url string', () => {
    expect(generateVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('generates different values each time', () => {
    expect(generateVerifier()).not.toBe(generateVerifier());
  });
});

describe('pkceS256', () => {
  it('matches the RFC 7636 appendix B vector', async () => {
    await expect(pkceS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('generateState', () => {
  it('generates a 43-character base64url string, different each time', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateState()).not.toBe(generateState());
  });
});

describe('loadAuth, saveAuth, clearAuth', () => {
  it('round-trips the auth through chrome.storage.local', async () => {
    const chrome = fakeChrome();
    vi.stubGlobal('chrome', chrome);
    await expect(loadAuth()).resolves.toBeNull();
    await saveAuth(auth());
    await expect(loadAuth()).resolves.toEqual(auth());
    await clearAuth();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('auth');
    await expect(loadAuth()).resolves.toBeNull();
  });
});

describe('authFor', () => {
  it('returns the auth for the server that issued it, ignoring a trailing slash', async () => {
    vi.stubGlobal('chrome', fakeChrome({ local: { auth: auth() } }));
    await expect(authFor(SERVER)).resolves.toEqual(auth());
    await expect(authFor(`${SERVER}/`)).resolves.toEqual(auth());
  });

  it('is logged out when the configured server is not the token’s own', async () => {
    vi.stubGlobal('chrome', fakeChrome({ local: { auth: auth() } }));
    await expect(authFor('http://localhost:3000')).resolves.toBeNull();
  });

  it('is logged out with nothing stored', async () => {
    vi.stubGlobal('chrome', fakeChrome());
    await expect(authFor(SERVER)).resolves.toBeNull();
  });
});

describe('logout', () => {
  let chrome: FakeChrome;

  beforeEach(() => {
    chrome = fakeChrome({ local: { auth: auth() } });
    vi.stubGlobal('chrome', chrome);
  });

  it('revokes the token at its own server, with a timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const requests = stubFetch(() => ({ body: { ok: true } }));
    await expect(logout(auth())).resolves.toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', url: `${SERVER}/api/auth/logout` });
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer bkm_live');
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(requests[0]!.signal).toBe(timeout.mock.results[0]!.value);
    expect(chrome.storage.local.data.auth).toBeUndefined();
  });

  it('logs out here before the server has answered', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    void logout(auth());
    await settle();
    expect(chrome.storage.local.data.auth).toBeUndefined();
  });

  it('still logs out here when the server cannot be reached, and says so', async () => {
    stubFetch(() => new TypeError('Failed to fetch'));
    await expect(logout(auth())).resolves.toBe(false);
    expect(chrome.storage.local.data.auth).toBeUndefined();
  });

  it('does not count an error response as revoked', async () => {
    stubFetch(() => ({ status: 502 }));
    await expect(logout(auth())).resolves.toBe(false);
    expect(chrome.storage.local.data.auth).toBeUndefined();
  });

  it('counts a 401 as revoked: the server already rejects the token', async () => {
    stubFetch(() => ({ status: 401, body: { error: 'Not authenticated' } }));
    await expect(logout(auth())).resolves.toBe(true);
  });
});

describe('identityRedirectKind', () => {
  it.each([
    [REDIRECT_URI, 'chromium'],
    [firefoxRedirectURL('bukmark'), 'firefox'],
    [REDIRECT_URI.replace('https:', 'http:'), null],
    [firefoxRedirectURL('bukmark').replace(/\/\/([0-9a-f]+)\./, (_m, h: string) => `//${h.toUpperCase()}.`), null],
    [firefoxRedirectURL('bukmark').replace(/\/\/[0-9a-f]/, '//'), null],
    [`https://${EXTENSION_ID}q.chromiumapp.org/bukmark`, null],
    [`${REDIRECT_URI}?x=1`, null],
    ['https://bukmark.example.org/authorize/done', null],
    ['not a url', null],
  ])('classifies %s as %s, like the server does', (uri, kind) => {
    expect(identityRedirectKind(uri)).toBe(kind);
  });
});

describe('loginFlow', () => {
  let chrome: FakeChrome;
  let requests: FakeRequest[];

  beforeEach(() => {
    chrome = fakeChrome();
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('setInterval', vi.fn(() => 42));
    vi.stubGlobal('clearInterval', vi.fn());
    requests = server();
  });

  function authorizeUrl(): URL {
    return new URL(chrome.identity.launchWebAuthFlow.mock.calls[0]![0].url);
  }

  it('opens the server’s /authorize page with an S256 PKCE request', async () => {
    await loginFlow(`${SERVER}/`);
    const url = authorizeUrl();
    expect(`${url.origin}${url.pathname}`).toBe(`${SERVER}/authorize`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_name')).toBe('bukmark capture');
    expect(chrome.identity.getRedirectURL).toHaveBeenCalledWith('bukmark');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(chrome.identity.launchWebAuthFlow.mock.calls[0]![0].interactive).toBe(true);
  });

  it('checks the server answers before any window opens', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await loginFlow(SERVER);
    expect(requests[0]).toMatchObject({ method: 'GET', url: `${SERVER}/api/auth/status` });
    expect(requests[0]!.headers.get('authorization')).toBeNull();
    expect(requests[0]!.signal).toBe(timeout.mock.results[0]!.value);
    expect(vi.mocked(fetch).mock.invocationCallOrder[0])
      .toBeLessThan(chrome.identity.launchWebAuthFlow.mock.invocationCallOrder[0]!);
  });

  it.each([
    ['cannot be reached', new TypeError('Failed to fetch'), UNREACHABLE],
    ['predates logins (404)', { status: 404 }, UPDATE_SERVER],
    ['lists no redirect kinds', { body: { setupComplete: true, authenticated: false } }, UPDATE_SERVER],
    ['does not accept this browser’s redirect', { body: { ...STATUS, redirectKinds: ['firefox', 'tab'] } }, UPDATE_SERVER],
    ['fails', { status: 500 }, 'Login failed — nas.lan:3000 answered HTTP 500.'],
    ['answers something else', { body: 'hello' }, 'Login failed — unexpected reply from the server.'],
  ])('opens no window when the server %s', async (_case, status, message) => {
    requests = server({ status });
    expect((await failure(loginFlow(SERVER))).message).toBe(message);
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
    expect(requests.map((r) => r.url)).toEqual([`${SERVER}/api/auth/status`]);
  });

  it('exchanges the code at the same server, with the verifier behind the challenge', async () => {
    await loginFlow(SERVER);
    expect(requests.map((r) => r.url)).toEqual([`${SERVER}/api/auth/status`, `${SERVER}/api/auth/token`]);
    const exchange = requests[1]!;
    expect(exchange.method).toBe('POST');
    const body = exchange.body as Record<string, string>;
    expect(body).toMatchObject({ grant_type: 'authorization_code', code: 'the-code', redirect_uri: REDIRECT_URI });
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await pkceS256(body.code_verifier!)).toBe(authorizeUrl().searchParams.get('code_challenge'));
  });

  it('stores the token bound to the normalized server', async () => {
    const result = await loginFlow(`  ${SERVER}/  `);
    const stored = { token: 'bkm_new', tokenId: 'id-new', name: 'bukmark capture', server: SERVER };
    expect(result).toMatchObject(stored);
    expect(chrome.storage.local.data.auth).toMatchObject(stored);
  });

  it('rejects a reply whose state does not match, before any exchange', async () => {
    chrome.identity.launchWebAuthFlow.mockResolvedValue(`${REDIRECT_URI}?code=the-code&state=forged`);
    expect((await failure(loginFlow(SERVER))).message).toMatch(/didn't match this login attempt/);
    expect(requests.map((r) => r.url)).not.toContain(`${SERVER}/api/auth/token`);
    expect(chrome.storage.local.data.auth).toBeUndefined();
  });

  it('rejects a reply without a state', async () => {
    chrome.identity.launchWebAuthFlow.mockResolvedValue(`${REDIRECT_URI}?code=the-code`);
    expect((await failure(loginFlow(SERVER))).message).toMatch(/didn't match this login attempt/);
    expect(requests.map((r) => r.url)).not.toContain(`${SERVER}/api/auth/token`);
  });

  it('maps a Deny in the window to a readable error', async () => {
    chrome.identity.launchWebAuthFlow.mockImplementation(async ({ url }) =>
      `${REDIRECT_URI}?error=access_denied&state=${new URL(url).searchParams.get('state')}`);
    expect((await failure(loginFlow(SERVER))).message).toBe('Access was denied in the bukmark window.');
    expect(requests.map((r) => r.url)).not.toContain(`${SERVER}/api/auth/token`);
  });

  it.each([
    ['The user did not approve access.', 'Login cancelled.'],
    [
      'Authorization page could not be loaded.',
      "Couldn't open nas.lan:3000/authorize — check the address and that the server runs bukmark 0.2+ (or too many sign-in attempts).",
    ],
    ['Only one web auth flow is allowed at a time.', 'A bukmark login window is already open.'],
    ['Identity API is disabled in incognito windows.', 'Login failed: Identity API is disabled in incognito windows.'],
  ])('explains Chrome’s "%s"', async (fromChrome, shown) => {
    chrome.identity.launchWebAuthFlow.mockRejectedValue(new Error(fromChrome));
    expect((await failure(loginFlow(SERVER))).message).toBe(shown);
  });

  it('reports the HTTP status of a failed exchange instead of a grant code', async () => {
    stubFetch(({ url }) => url.endsWith('/api/auth/status')
      ? { body: STATUS }
      : { status: 429, body: { error: 'Too many token exchange attempts', code: 'rate_limited' } });
    expect((await failure(loginFlow(SERVER))).message).toBe('Login failed (HTTP 429).');
    expect(chrome.storage.local.data.auth).toBeUndefined();
  });

  it('says so when the exchange cannot reach the server', async () => {
    stubFetch(({ url }) => url.endsWith('/api/auth/status') ? { body: STATUS } : new TypeError('Failed to fetch'));
    expect((await failure(loginFlow(SERVER))).message).toBe("Login failed — couldn't reach nas.lan:3000.");
  });

  it('rejects an exchange reply that carries no token', async () => {
    stubFetch(({ url }) => ({ body: url.endsWith('/api/auth/status') ? STATUS : { ok: true } }));
    expect((await failure(loginFlow(SERVER))).message).toBe('Login failed — unexpected reply from the server.');
    expect(chrome.storage.local.data.auth).toBeUndefined();
  });

  it('pings the worker every 20 s while the window is open, then stops', async () => {
    await loginFlow(SERVER);
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 20_000);
    (vi.mocked(setInterval).mock.calls[0]![0] as () => void)();
    expect(chrome.runtime.getPlatformInfo).toHaveBeenCalled();
    expect(clearInterval).toHaveBeenCalledWith(42);
  });

  it('stops the keepalive when the login fails, too', async () => {
    chrome.identity.launchWebAuthFlow.mockRejectedValue(new Error('The user did not approve access.'));
    await failure(loginFlow(SERVER));
    expect(clearInterval).toHaveBeenCalledWith(42);
  });

  it('revokes a token it replaces, at that token’s own server', async () => {
    chrome.storage.local.data.auth = auth({ server: 'http://old.lan:3000', token: 'bkm_old' });
    await loginFlow(SERVER);
    await settle();
    const revoke = requests.find((r) => r.url.endsWith('/api/auth/logout'));
    expect(revoke).toMatchObject({ method: 'POST', url: 'http://old.lan:3000/api/auth/logout' });
    expect(revoke!.headers.get('authorization')).toBe('Bearer bkm_old');
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
  });

  it('sends nothing anywhere else when there was no token to replace', async () => {
    await loginFlow(SERVER);
    await settle();
    expect(requests.map((r) => r.url)).toEqual([`${SERVER}/api/auth/status`, `${SERVER}/api/auth/token`]);
  });
});

describe('loginFlow in Firefox', () => {
  let chrome: FakeChrome;
  let requests: FakeRequest[];
  const REDIRECT = firefoxRedirectURL('bukmark');

  beforeEach(() => {
    chrome = fakeChrome({ browser: 'firefox' });
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('setInterval', vi.fn(() => 42));
    vi.stubGlobal('clearInterval', vi.fn());
    requests = server();
  });

  it('logs in through the add-on’s allizom redirect, end to end', async () => {
    await loginFlow(SERVER);
    const authorize = new URL(chrome.identity.launchWebAuthFlow.mock.calls[0]![0].url);
    expect(authorize.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect((requests[1]!.body as Record<string, string>).redirect_uri).toBe(REDIRECT);
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
  });

  it('needs a server that accepts Firefox redirects', async () => {
    requests = server({ status: { body: { ...STATUS, redirectKinds: ['chromium'] } } });
    expect((await failure(loginFlow(SERVER))).message).toBe(UPDATE_SERVER);
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
  });

  // toolkit/components/extensions/{child,parent}/ext-identity.js
  it.each([
    ['User cancelled or denied access.', 'Login cancelled.'],
    ['redirect_uri not allowed', UPDATE_SERVER],
    ['Requires user interaction', "The browser didn't open the bukmark login window — try again."],
  ])('explains Firefox’s "%s"', async (fromFirefox, shown) => {
    chrome.identity.launchWebAuthFlow.mockRejectedValue(new Error(fromFirefox));
    expect((await failure(loginFlow(SERVER))).message).toBe(shown);
  });

  it('reads a rejection that is a plain { message } object', async () => {
    chrome.identity.launchWebAuthFlow.mockRejectedValue({ message: 'User cancelled or denied access.' });
    expect((await failure(loginFlow(SERVER))).message).toBe('Login cancelled.');
  });
});

describe('loginFlow without the usual identity API', () => {
  beforeEach(() => {
    vi.stubGlobal('setInterval', vi.fn(() => 42));
    vi.stubGlobal('clearInterval', vi.fn());
  });

  it('builds Chromium’s redirect itself where only launchWebAuthFlow exists (Opera)', async () => {
    const chrome = fakeChrome({ without: ['getRedirectURL'] });
    vi.stubGlobal('chrome', chrome);
    const requests = server();
    await loginFlow(SERVER);
    const authorize = new URL(chrome.identity.launchWebAuthFlow.mock.calls[0]![0].url);
    expect(authorize.searchParams.get('redirect_uri')).toBe(`https://${EXTENSION_ID}.chromiumapp.org/bukmark`);
    expect((requests[1]!.body as Record<string, string>).redirect_uri).toBe(REDIRECT_URI);
  });

  async function unsupported(promise: Promise<unknown>): Promise<void> {
    await expect(promise).rejects.toBeInstanceOf(IdentityUnsupportedError);
  }

  it('leaves a browser without an identity window (Safari) to the tab login, asking nothing of the server', async () => {
    vi.stubGlobal('chrome', fakeChrome({ browser: 'safari' }));
    const requests = server();
    await unsupported(loginFlow(SERVER));
    expect(requests).toHaveLength(0);
  });

  it('leaves a browser whose redirect no server accepts to the tab login, opening nothing', async () => {
    const chrome = fakeChrome();
    chrome.identity.getRedirectURL.mockReturnValue('https://orion.example/oauth/bukmark');
    vi.stubGlobal('chrome', chrome);
    const requests = server();
    await unsupported(loginFlow(SERVER));
    expect(requests).toHaveLength(0);
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it.each([
    'launchWebAuthFlow is not supported on this platform.',
    'Unsupported',
    'windows.create() is not implemented',
  ])('leaves an identity window that answers "%s" to the tab login', async (fromBrowser) => {
    const chrome = fakeChrome();
    chrome.identity.launchWebAuthFlow.mockRejectedValue(new Error(fromBrowser));
    vi.stubGlobal('chrome', chrome);
    server();
    await unsupported(loginFlow(SERVER));
    expect(clearInterval).toHaveBeenCalledWith(42);
    expect(chrome.storage.local.data.auth).toBeUndefined();
  });
});

describe('identityFlowAvailable', () => {
  it.each<[string, FakeSeed, boolean]>([
    ['Chrome', {}, true],
    ['Firefox', { browser: 'firefox' }, true],
    ['Opera, without getRedirectURL', { without: ['getRedirectURL'] }, true],
    ['Safari', { browser: 'safari' }, false],
    ['Firefox for Android', { browser: 'firefox', without: ['identity', 'bookmarks', 'commands', 'windows'] }, false],
  ])('tells whether %s has an identity window', (_browser, seed, available) => {
    vi.stubGlobal('chrome', fakeChrome(seed));
    expect(identityFlowAvailable()).toBe(available);
  });
});

describe('buildAuthorizeRequest and finishLogin, with a reply caught some other way', () => {
  const DONE = `${SERVER}/authorize/done`;
  let chrome: FakeChrome;
  let requests: FakeRequest[];

  beforeEach(() => {
    chrome = fakeChrome({ browser: 'safari' });
    vi.stubGlobal('chrome', chrome);
    requests = server();
  });

  it('finish a login from plain data kept between the two steps', async () => {
    const request = structuredClone(await buildAuthorizeRequest(`${SERVER}/`, DONE));
    expect(request).toMatchObject({ server: SERVER, redirectUri: DONE });
    expect(new URL(request.url).searchParams.get('redirect_uri')).toBe(DONE);

    await expect(finishLogin(request, approve(request.url, 'tab-code'))).resolves.toMatchObject({ token: 'bkm_new' });
    expect(requests[0]!.body).toMatchObject({ code: 'tab-code', redirect_uri: DONE, code_verifier: request.verifier });
    expect(await pkceS256(request.verifier)).toBe(new URL(request.url).searchParams.get('code_challenge'));
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
  });

  it('refuse a reply meant for another login', async () => {
    const mine = await buildAuthorizeRequest(SERVER, DONE);
    const theirs = await buildAuthorizeRequest(SERVER, DONE);
    expect((await failure(finishLogin(mine, approve(theirs.url)))).message).toMatch(/didn't match this login attempt/);
    expect(requests).toHaveLength(0);
  });
});

describe('verifyToken', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', fakeChrome());
  });

  it('asks the token’s server whether it accepts the token, and binds it there', async () => {
    const requests = stubFetch(() => ({ body: { ...STATUS, authenticated: true } }));
    const result = await verifyToken(`${SERVER}/`, 'bkm_AbCdEfGh12345');
    expect(requests.map((r) => [r.method, r.url, r.headers.get('authorization')]))
      .toEqual([['GET', `${SERVER}/api/auth/status`, 'Bearer bkm_AbCdEfGh12345']]);
    expect(result).toMatchObject({ token: 'bkm_AbCdEfGh12345', server: SERVER, name: 'access token bkm_AbCdEfGh…' });
  });

  it.each([
    [
      'refuses it',
      { body: { ...STATUS, authenticated: false } },
      "nas.lan:3000 didn't accept that token — copy it again, or create a new one in the web app under Settings › Access tokens.",
    ],
    ['predates logins', { status: 404 }, UPDATE_SERVER],
    ['cannot be reached', new TypeError('Failed to fetch'), UNREACHABLE],
  ])('fails when the server %s', async (_case, reply, message) => {
    stubFetch(() => reply);
    expect((await failure(verifyToken(SERVER, 'bkm_x'))).message).toBe(message);
  });
});

describe('adopt', () => {
  let chrome: FakeChrome;

  beforeEach(() => {
    chrome = fakeChrome({ local: { auth: auth({ server: 'http://old.lan:3000', token: 'bkm_old' }) } });
    vi.stubGlobal('chrome', chrome);
  });

  it('stores the new login and revokes the token it replaces', async () => {
    const requests = stubFetch(() => ({ body: { ok: true } }));
    await adopt(auth({ token: 'bkm_new' }));
    await settle();
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
    expect(requests.map((r) => [r.url, r.headers.get('authorization')]))
      .toEqual([['http://old.lan:3000/api/auth/logout', 'Bearer bkm_old']]);
  });

  it('revokes nothing when the same token is stored again', async () => {
    const requests = stubFetch(() => ({ body: { ok: true } }));
    await adopt(auth({ server: 'http://old.lan:3000', token: 'bkm_old' }));
    await settle();
    expect(requests).toHaveLength(0);
  });
});

describe('AuthRequiredError', () => {
  it('is an Error with its own name', () => {
    const err = new AuthRequiredError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AuthRequiredError');
  });
});
