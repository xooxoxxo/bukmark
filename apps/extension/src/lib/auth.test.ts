import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REDIRECT_URI,
  fakeChrome,
  settle,
  stubFetch,
  type FakeChrome,
  type FakeRequest,
} from '../test/chrome';
import {
  AuthRequiredError,
  LoginError,
  authFor,
  clearAuth,
  generateState,
  generateVerifier,
  loadAuth,
  loginFlow,
  logout,
  pkceS256,
  saveAuth,
  type Auth,
} from './auth';

const SERVER = 'http://nas.lan:3000';

function auth(over: Partial<Auth> = {}): Auth {
  return { token: 'bkm_live', tokenId: 't1', server: SERVER, name: 'bukmark capture', createdAt: 1, ...over };
}

async function failure(promise: Promise<unknown>): Promise<LoginError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(LoginError);
  return err as LoginError;
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

describe('loginFlow', () => {
  let chrome: FakeChrome;
  let requests: FakeRequest[];

  beforeEach(() => {
    chrome = fakeChrome();
    vi.stubGlobal('chrome', chrome);
    vi.stubGlobal('setInterval', vi.fn(() => 42));
    vi.stubGlobal('clearInterval', vi.fn());
    requests = stubFetch(({ url }) =>
      url.endsWith('/api/auth/token')
        ? { body: { token: 'bkm_new', tokenId: 'id-new', name: 'bukmark capture' } }
        : { status: 404 },
    );
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

  it('exchanges the code at the same server, with the verifier behind the challenge', async () => {
    await loginFlow(SERVER);
    expect(requests).toHaveLength(1);
    const exchange = requests[0]!;
    expect(exchange).toMatchObject({ method: 'POST', url: `${SERVER}/api/auth/token` });
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
    expect(requests).toHaveLength(0);
    expect(chrome.storage.local.data.auth).toBeUndefined();
  });

  it('rejects a reply without a state', async () => {
    chrome.identity.launchWebAuthFlow.mockResolvedValue(`${REDIRECT_URI}?code=the-code`);
    expect((await failure(loginFlow(SERVER))).message).toMatch(/didn't match this login attempt/);
    expect(requests).toHaveLength(0);
  });

  it('maps a Deny in the window to a readable error', async () => {
    chrome.identity.launchWebAuthFlow.mockImplementation(async ({ url }) =>
      `${REDIRECT_URI}?error=access_denied&state=${new URL(url).searchParams.get('state')}`);
    expect((await failure(loginFlow(SERVER))).message).toBe('Access was denied in the bukmark window.');
    expect(requests).toHaveLength(0);
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
    stubFetch(() => ({ status: 429, body: { error: 'Too many token exchange attempts', code: 'rate_limited' } }));
    expect((await failure(loginFlow(SERVER))).message).toBe('Login failed (HTTP 429).');
    expect(chrome.storage.local.data.auth).toBeUndefined();
  });

  it('says so when the exchange cannot reach the server', async () => {
    stubFetch(() => new TypeError('Failed to fetch'));
    expect((await failure(loginFlow(SERVER))).message).toBe("Login failed — couldn't reach nas.lan:3000.");
  });

  it('rejects an exchange reply that carries no token', async () => {
    stubFetch(() => ({ body: { ok: true } }));
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
    expect(requests.map((r) => r.url)).toEqual([`${SERVER}/api/auth/token`]);
  });
});

describe('AuthRequiredError', () => {
  it('is an Error with its own name', () => {
    const err = new AuthRequiredError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AuthRequiredError');
  });
});
