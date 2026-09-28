import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STATUS,
  approve,
  closeTab,
  fakeChrome,
  navigate,
  settle,
  startBackground,
  stopBackground,
  stubFetch,
  updateTab,
  type FakeChrome,
  type FakeRequest,
  type FakeSeed,
  type FakeTab,
} from '../test/chrome';
import { pkceS256 } from './auth';
import type { PendingLogin } from './tabLogin';

const SERVER = 'http://nas.lan:3000';
const DONE = `${SERVER}/authorize/done`;
const OTHER = 'http://other.lan:3000';
const ELSEWHERE = 'https://news.example/story';
const SAFARI: FakeSeed = { browser: 'safari' };
const FIREFOX_ANDROID: FakeSeed = { browser: 'firefox', without: ['identity', 'bookmarks', 'commands', 'windows'] };
const CANCELLED = 'Login cancelled.';
const TIMED_OUT = 'Login timed out — log in again.';

// What a tab shows the extension before its first page arrives, or on a site
// the extension has no access to.
const UNSEEN = [
  ['no address (Safari, for a site it keeps from the extension)', ''],
  ['about:blank (Firefox, before the page arrives)', 'about:blank'],
];

let chrome: FakeChrome;
let requests: FakeRequest[];

/** A current server: every redirect kind, and a token for any code. */
function server(status: { status?: number; body?: unknown } | Error = { body: STATUS }): void {
  requests = stubFetch(({ url }) =>
    url.endsWith('/api/auth/status') ? status
      : url.endsWith('/api/auth/token') ? { body: { token: 'bkm_new', tokenId: 'id-new', name: 'bukmark capture' } }
      : { body: { ok: true } });
}

/** A browser with the extension's background started in it. */
async function arrange(seed: FakeSeed): Promise<void> {
  chrome = fakeChrome(seed);
  vi.stubGlobal('chrome', chrome);
  await startBackground(chrome);
}

/** What the popup or options page sends on Log in, once it has host access. */
function logIn(baseUrl = SERVER): Promise<unknown> {
  return chrome.runtime.sendMessage({ type: 'login', baseUrl });
}

/** What the popup or options page sends on opening while a login waits. */
function resume(): Promise<unknown> {
  return chrome.runtime.sendMessage({ type: 'resumeLogin' });
}

/** The tab the login opened, with the /authorize address it opened there. */
function loginTab(): FakeTab & { authorize: URL } {
  const tabs = [...chrome.tabs.data.values()];
  expect(tabs).toHaveLength(1);
  return { ...tabs[0]!, authorize: new URL(tabs[0]!.url) };
}

const pending = () => chrome.storage.session.data.pendingLogin as PendingLogin | undefined;
const exchanges = () => requests.filter((r) => r.url.endsWith('/api/auth/token'));
const body = (req: FakeRequest) => req.body as Record<string, string>;

beforeEach(() => {
  vi.stubGlobal('setTimeout', vi.fn());
  server();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tab login where the browser has no identity window (Safari)', () => {
  beforeEach(() => arrange(SAFARI));

  it('opens the server’s /authorize page in a popup window, and answers at once that it waits there', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await expect(logIn()).resolves.toEqual({ ok: true, pending: true });

    expect(chrome.windows.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'popup' }));
    const { id, authorize } = loginTab();
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${SERVER}/authorize`);
    expect(authorize.searchParams.get('response_type')).toBe('code');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('redirect_uri')).toBe(DONE);
    expect(pending()).toEqual({
      server: SERVER,
      redirectUri: DONE,
      state: authorize.searchParams.get('state'),
      verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      tabId: id,
      expiresAt: 1_000_000 + 10 * 60_000,
    });
    expect(await pkceS256(pending()!.verifier)).toBe(authorize.searchParams.get('code_challenge'));
    expect(requests.map((r) => r.url)).toEqual([`${SERVER}/api/auth/status`]);
    // Not logged in yet: the badge and any earlier word for the popup stay as they are.
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    expect(chrome.action.setTitle).not.toHaveBeenCalled();
  });

  it.each([
    [
      'does not take tab logins',
      { body: { ...STATUS, redirectKinds: ['chromium', 'firefox'] } },
      "Update your bukmark server — nas.lan:3000 can't log in this browser yet.",
    ],
    [
      'cannot be reached',
      new TypeError('Failed to fetch'),
      "Couldn't reach nas.lan:3000 — check the address and that the server is running.",
    ],
  ])('opens nothing when the server %s', async (_case, status, error) => {
    server(status);
    await expect(logIn()).resolves.toEqual({ ok: false, error });
    expect(chrome.windows.create).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(pending()).toBeUndefined();
    expect(chrome.storage.session.data.lastAuthError).toBe(error);
  });

  it('finishes when its tab reaches the reply: closes the tab, trades the code at the same server, keeps the token bound to it', async () => {
    await logIn();
    const { id, authorize } = loginTab();
    navigate(chrome, id, approve(authorize.href));
    await settle();

    expect(chrome.tabs.data.has(id)).toBe(false);
    expect(exchanges()).toHaveLength(1);
    const [exchange] = exchanges();
    expect(exchange).toMatchObject({ method: 'POST', url: `${SERVER}/api/auth/token` });
    expect(body(exchange!)).toMatchObject({ grant_type: 'authorization_code', code: 'the-code', redirect_uri: DONE });
    expect(await pkceS256(body(exchange!).code_verifier!)).toBe(authorize.searchParams.get('code_challenge'));
    expect(chrome.tabs.remove.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(fetch).mock.invocationCallOrder[exchanges().length]!);
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', tokenId: 'id-new', server: SERVER });
    expect(pending()).toBeUndefined();
    // Closing the tab itself is no cancel.
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '✓' });
  });

  it('finishes on a later update of its tab when the change of address itself went unseen', async () => {
    await logIn();
    const { id, authorize } = loginTab();
    chrome.tabs.data.get(id)!.url = approve(authorize.href);
    updateTab(chrome, id, { status: 'complete' });
    await settle();
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
  });

  it('redeems a reply once, however often it is reported', async () => {
    await logIn();
    const { id, authorize } = loginTab();
    navigate(chrome, id, approve(authorize.href));
    navigate(chrome, id, approve(authorize.href));
    const asked = resume();
    await settle();

    expect(exchanges()).toHaveLength(1);
    await expect(asked).resolves.not.toEqual(expect.objectContaining({ ok: false }));
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();
  });

  it('ignores a reply with a state it did not create, and still takes its own', async () => {
    await logIn();
    const { id, authorize } = loginTab();
    navigate(chrome, id, `${DONE}?code=planted&state=${'x'.repeat(43)}`);
    navigate(chrome, id, `${DONE}?code=planted`);
    await settle();
    expect(exchanges()).toHaveLength(0);
    expect(chrome.tabs.data.has(id)).toBe(true);
    expect(pending()).toBeDefined();
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();

    navigate(chrome, id, approve(authorize.href));
    await settle();
    expect(exchanges().map((r) => body(r).code)).toEqual(['the-code']);
  });

  it('ignores its own reply page in any other tab', async () => {
    await logIn();
    const { authorize } = loginTab();
    chrome.tabs.data.set(99, { id: 99, windowId: 1, url: 'https://example.com/' });
    navigate(chrome, 99, approve(authorize.href));
    await settle();
    expect(exchanges()).toHaveLength(0);
    expect(chrome.tabs.data.has(99)).toBe(true);
    expect(pending()).toBeDefined();
  });

  it.each([
    ['another port', (reply: string) => reply.replace(SERVER, 'http://nas.lan:3001')],
    ['another host', (reply: string) => reply.replace(SERVER, 'http://evil.example')],
    ['https', (reply: string) => reply.replace('http:', 'https:')],
    ['a longer path', (reply: string) => reply.replace('/authorize/done', '/authorize/done/x')],
  ])('ignores an /authorize/done on %s in its tab', async (_case, foreign) => {
    await logIn();
    const { id, authorize } = loginTab();
    navigate(chrome, id, foreign(approve(authorize.href)));
    await settle();
    expect(exchanges()).toHaveLength(0);
    expect(pending()).toBeDefined();
  });

  it('ends on a Deny with the reason, having redeemed nothing', async () => {
    await logIn();
    const { id, authorize } = loginTab();
    navigate(chrome, id, `${DONE}?error=access_denied&state=${authorize.searchParams.get('state')}`);
    await settle();
    expect(chrome.storage.session.data.lastAuthError).toBe('Access was denied in the bukmark window.');
    expect(exchanges()).toHaveLength(0);
    expect(chrome.tabs.data.has(id)).toBe(false);
    expect(pending()).toBeUndefined();
  });

  it('is cancelled when its tab is closed, and a new login can start', async () => {
    await logIn();
    closeTab(chrome, loginTab().id);
    await settle();
    expect(chrome.storage.session.data.lastAuthError).toBe('Login cancelled.');
    expect(pending()).toBeUndefined();
    expect(exchanges()).toHaveLength(0);

    await expect(logIn()).resolves.toEqual({ ok: true, pending: true });
    expect(chrome.windows.create).toHaveBeenCalledTimes(2);
  });

  it('carries on when any other tab closes', async () => {
    await logIn();
    chrome.tabs.data.set(99, { id: 99, windowId: 1, url: 'https://example.com/' });
    closeTab(chrome, 99);
    await settle();
    expect(pending()).toBeDefined();
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();
  });

  it('runs one at a time: Log in while its window is open says so and opens no other, even clicked twice at once', async () => {
    const [first, second] = await Promise.all([logIn(), logIn()]);
    expect([first, second]).toEqual([{ ok: true, pending: true }, { ok: true, pending: true }]);
    const { state } = pending()!;
    await expect(logIn()).resolves.toEqual({ ok: true, pending: true });
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
    expect(pending()).toMatchObject({ tabId: loginTab().id, state });
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();
  });

  it('is not held up by a login whose tab closed while nothing listened', async () => {
    await logIn();
    chrome.tabs.data.delete(loginTab().id);
    await expect(logIn()).resolves.toEqual({ ok: true, pending: true });
    expect(chrome.windows.create).toHaveBeenCalledTimes(2);
    expect(pending()?.tabId).toBe(loginTab().id);
  });

  it('finishes on Log in a login whose reply arrived while nothing listened', async () => {
    await logIn();
    const { id, authorize } = loginTab();
    chrome.tabs.data.get(id)!.url = approve(authorize.href);
    await expect(logIn()).resolves.toEqual({ ok: true });
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
  });

  it('still waits while its tab moves through the login’s own pages', async () => {
    await logIn();
    const { id } = loginTab();
    // Sign in posts the form back to /authorize, with no query.
    navigate(chrome, id, 'http://NAS.lan:3000/authorize');
    await expect(resume()).resolves.toEqual({ ok: true, pending: true });
    navigate(chrome, id, `${DONE}?code=planted&state=${'x'.repeat(43)}`);
    await expect(resume()).resolves.toEqual({ ok: true, pending: true });
    expect(pending()?.tabId).toBe(id);
    expect(chrome.tabs.data.has(id)).toBe(true);
  });

  it.each(UNSEEN)('still waits on a tab that shows %s, and opens no other', async (_case, url) => {
    await logIn();
    const { id } = loginTab();
    chrome.tabs.data.get(id)!.url = url;
    await expect(resume()).resolves.toEqual({ ok: true, pending: true });
    await expect(logIn()).resolves.toEqual({ ok: true, pending: true });
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
    expect(pending()?.tabId).toBe(id);
  });

  it('reads nothing on the page loads of other tabs', async () => {
    chrome.tabs.data.set(99, { id: 99, windowId: 1, url: 'about:blank' });
    navigate(chrome, 99, 'https://example.com/article');
    await settle();
    expect(chrome.storage.session.get).not.toHaveBeenCalled();
  });
});

describe('tab login, knowing its reply however the browser spells the address', () => {
  beforeEach(() => arrange(SAFARI));

  it.each([
    ['an uppercase host', 'http://NAS.lan:3000', (reply: string) => reply.replace('NAS.lan', 'nas.lan')],
    ['a default port', 'https://bukmark.example:443', (reply: string) => reply.replace(':443', '')],
  ])('takes a reply to %s, and redeems it with the address as sent', async (_case, typed, asLoaded) => {
    await logIn(`${typed}/`);
    const { id, authorize } = loginTab();
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${typed}/authorize/done`);
    navigate(chrome, id, asLoaded(approve(authorize.href)));
    await settle();
    expect(exchanges().map((r) => [r.url, body(r).redirect_uri]))
      .toEqual([[`${typed}/api/auth/token`, `${typed}/authorize/done`]]);
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: typed });
  });
});

describe('tab login after 10 minutes', () => {
  let expiresAt: number;

  beforeEach(async () => {
    await arrange(SAFARI);
    await logIn();
    expiresAt = pending()!.expiresAt;
  });

  it('still takes a reply just before', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(expiresAt - 1);
    const { id, authorize } = loginTab();
    navigate(chrome, id, approve(authorize.href));
    await settle();
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
  });

  it('takes no reply: closes its tab and says why', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(expiresAt);
    const { id, authorize } = loginTab();
    navigate(chrome, id, approve(authorize.href));
    await settle();
    expect(exchanges()).toHaveLength(0);
    expect(chrome.storage.local.data.auth).toBeUndefined();
    expect(chrome.tabs.data.has(id)).toBe(false);
    expect(pending()).toBeUndefined();
    expect(chrome.storage.session.data.lastAuthError).toBe(TIMED_OUT);
  });

  it('holds up no new login, and closes its own tab', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(expiresAt);
    const { id } = loginTab();
    await expect(logIn()).resolves.toEqual({ ok: true, pending: true });
    expect(chrome.tabs.data.has(id)).toBe(false);
    expect(chrome.windows.create).toHaveBeenCalledTimes(2);
  });

  it('is reported to a page that asks', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(expiresAt);
    await expect(resume()).resolves.toEqual({ ok: false, error: TIMED_OUT });
    expect(pending()).toBeUndefined();
  });

  it.each([
    ['a page that asks', resume],
    ['a new Log in', () => logIn()],
  ])('never closes a tab the person took elsewhere, when %s finds it', async (_case, check) => {
    const { id } = loginTab();
    navigate(chrome, id, ELSEWHERE);
    await settle();
    vi.spyOn(Date, 'now').mockReturnValue(expiresAt);
    await check();
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
    expect(chrome.tabs.data.get(id)?.url).toBe(ELSEWHERE);
    expect(pending()?.tabId).not.toBe(id);
  });

  it.each(UNSEEN)('drops one whose tab shows %s, and leaves the tab open', async (_case, url) => {
    const { id } = loginTab();
    chrome.tabs.data.get(id)!.url = url;
    vi.spyOn(Date, 'now').mockReturnValue(expiresAt);
    await expect(resume()).resolves.toEqual({ ok: false, error: TIMED_OUT });
    expect(chrome.tabs.data.has(id)).toBe(true);
    expect(pending()).toBeUndefined();
  });
});

describe('a page asking about a tab login', () => {
  beforeEach(() => arrange(SAFARI));

  it('has the background finish one whose reply arrived while nothing listened (iOS)', async () => {
    await logIn();
    const { id, authorize } = loginTab();
    chrome.tabs.data.get(id)!.url = approve(authorize.href);

    await expect(resume()).resolves.toEqual({ ok: true });
    expect(exchanges()).toHaveLength(1);
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
    expect(chrome.tabs.data.has(id)).toBe(false);
    expect(pending()).toBeUndefined();
  });

  it('hears that it still waits', async () => {
    await logIn();
    await expect(resume()).resolves.toEqual({ ok: true, pending: true });
    expect(pending()).toBeDefined();
    expect(exchanges()).toHaveLength(0);
  });

  it('hears it was cancelled when its tab closed while nothing listened, and so does the next popup', async () => {
    await logIn();
    chrome.tabs.data.delete(loginTab().id);
    await expect(resume()).resolves.toEqual({ ok: false, error: 'Login cancelled.' });
    expect(pending()).toBeUndefined();
    expect(chrome.storage.session.data.lastAuthError).toBe('Login cancelled.');
  });

  it('hears nothing when no login waits', async () => {
    await expect(resume()).resolves.toBeNull();
  });
});

describe('a login tab the person took elsewhere (phones open the login in an ordinary tab, and tabs get reused)', () => {
  beforeEach(() => arrange(FIREFOX_ANDROID));

  /** Log in, then the person types another address into the login's tab. */
  async function wanderOff(): Promise<number> {
    await logIn();
    const { id } = loginTab();
    navigate(chrome, id, ELSEWHERE);
    await settle();
    return id;
  }

  it('holds up no new login: Log in opens another tab, and leaves that one where the person took it', async () => {
    const id = await wanderOff();
    await expect(logIn()).resolves.toEqual({ ok: true, pending: true });
    expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
    expect(chrome.tabs.data.get(id)?.url).toBe(ELSEWHERE);

    const next = chrome.tabs.data.get(pending()!.tabId)!;
    expect(next.id).not.toBe(id);
    navigate(chrome, next.id, approve(next.url));
    await settle();
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
    expect(chrome.tabs.data.get(id)?.url).toBe(ELSEWHERE);
  });

  it('is cancelled for a page that asks, and the tab stays open', async () => {
    const id = await wanderOff();
    await expect(resume()).resolves.toEqual({ ok: false, error: CANCELLED });
    expect(pending()).toBeUndefined();
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
    expect(chrome.tabs.data.get(id)?.url).toBe(ELSEWHERE);
  });

  it('counts the server’s other pages as elsewhere too', async () => {
    await logIn();
    const { id } = loginTab();
    navigate(chrome, id, `${SERVER}/`);
    await expect(resume()).resolves.toEqual({ ok: false, error: CANCELLED });
    expect(chrome.tabs.data.has(id)).toBe(true);
  });
});

describe('Log in for another server while a tab login waits', () => {
  beforeEach(() => arrange(SAFARI));

  it('replaces it: closes the first server’s window, and logs in to the server asked for', async () => {
    await logIn();
    const first = loginTab();
    await expect(logIn(OTHER)).resolves.toEqual({ ok: true, pending: true });

    expect(chrome.tabs.data.has(first.id)).toBe(false);
    expect(chrome.windows.create).toHaveBeenCalledTimes(2);
    const next = loginTab();
    expect(`${next.authorize.origin}${next.authorize.pathname}`).toBe(`${OTHER}/authorize`);
    expect(pending()).toMatchObject({ server: OTHER, redirectUri: `${OTHER}/authorize/done`, tabId: next.id });
    // The first window's closing cancels nothing.
    await settle();
    expect(pending()?.tabId).toBe(next.id);
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();

    navigate(chrome, next.id, approve(next.authorize.href));
    await settle();
    expect(exchanges().map((r) => r.url)).toEqual([`${OTHER}/api/auth/token`]);
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: OTHER });
  });

  it('ignores a reply the first server’s window gets afterwards', async () => {
    await logIn();
    const first = loginTab();
    // Not seen to show the login, so it is not closed.
    chrome.tabs.data.get(first.id)!.url = '';
    await logIn(OTHER);
    expect(chrome.tabs.data.has(first.id)).toBe(true);

    navigate(chrome, first.id, approve(first.authorize.href));
    await settle();
    expect(exchanges()).toHaveLength(0);
    expect(chrome.storage.local.data.auth).toBeUndefined();
    expect(pending()).toMatchObject({ server: OTHER });
  });

  it('still keeps to one login for the same server', async () => {
    await logIn();
    await expect(logIn(`${SERVER}/`)).resolves.toEqual({ ok: true, pending: true });
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
  });
});

describe('tab login where there are no windows', () => {
  it('opens a tab in Firefox for Android (and Safari on iOS), and finishes there', async () => {
    await arrange(FIREFOX_ANDROID);
    await expect(logIn()).resolves.toEqual({ ok: true, pending: true });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: expect.stringMatching(/^http:\/\/nas\.lan:3000\/authorize\?/) });
    const { id, authorize } = loginTab();
    navigate(chrome, id, approve(authorize.href));
    await settle();
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
  });

  it('opens a tab when the browser refuses a window', async () => {
    await arrange(SAFARI);
    chrome.windows.create.mockRejectedValue(new Error('windows.create() is not implemented.'));
    await expect(logIn()).resolves.toEqual({ ok: true, pending: true });
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(pending()?.tabId).toBe(loginTab().id);
  });

  it('says so when no tab opens either, and keeps nothing', async () => {
    await arrange(FIREFOX_ANDROID);
    chrome.tabs.create.mockRejectedValue(new Error('Illegal URL'));
    await expect(logIn()).resolves.toEqual({
      ok: false,
      error: "The browser didn't open the bukmark login window — try again.",
    });
    expect(pending()).toBeUndefined();
  });
});

describe('choosing how to log in', () => {
  it('uses the identity window where there is one, and opens no tab', async () => {
    await arrange({});
    await expect(logIn()).resolves.toEqual({ ok: true });
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1);
    expect(chrome.windows.create).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(pending()).toBeUndefined();
  });

  it('falls back to a tab, once, when the identity window says it is unsupported, and finishes there', async () => {
    await arrange({});
    chrome.identity.launchWebAuthFlow.mockRejectedValue(new Error('This function is not supported on this browser.'));
    await expect(logIn()).resolves.toEqual({ ok: true, pending: true });
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1);
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);

    const { id, authorize } = loginTab();
    expect(authorize.searchParams.get('redirect_uri')).toBe(DONE);
    navigate(chrome, id, approve(authorize.href));
    await settle();
    expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
    expect(body(exchanges()[0]!).redirect_uri).toBe(DONE);
  });

  it('falls back to a tab when the identity window redirects where no server accepts', async () => {
    chrome = fakeChrome();
    chrome.identity.getRedirectURL.mockReturnValue('https://orion.example/oauth/bukmark');
    vi.stubGlobal('chrome', chrome);
    await startBackground(chrome);
    await expect(logIn()).resolves.toEqual({ ok: true, pending: true });
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
    expect(loginTab().authorize.searchParams.get('redirect_uri')).toBe(DONE);
  });

  it.each([
    ['Chrome', {}],
    ['Firefox', { browser: 'firefox' }],
    ['Safari', SAFARI],
    ['Firefox for Android', FIREFOX_ANDROID],
  ] satisfies Array<[string, FakeSeed]>)('listens for login tabs from startup in %s, and only then', async (_case, seed) => {
    await arrange(seed);
    expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.onRemoved.addListener).toHaveBeenCalledTimes(1);

    chrome.identity?.launchWebAuthFlow.mockRejectedValue(new Error('Unsupported'));
    await logIn();
    closeTab(chrome, loginTab().id);
    await settle();
    await logIn();
    expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.onRemoved.addListener).toHaveBeenCalledTimes(1);
  });
});

describe('a tab login across a restart of the background', () => {
  it.each([
    ['Safari', SAFARI, () => {}],
    ['Chrome, whose identity window says it is unsupported', {}, () => {
      chrome.identity.launchWebAuthFlow.mockRejectedValue(new Error('This function is not supported on this browser.'));
    }],
    ['Firefox, whose identity window redirects where no server accepts', { browser: 'firefox' }, () => {
      chrome.identity.getRedirectURL.mockReturnValue('https://login.example.org/bukmark');
    }],
  ] satisfies Array<[string, FakeSeed, () => void]>)(
    'finishes in %s after the browser unloaded the background mid-login',
    async (_case, seed, identity) => {
      await arrange(seed);
      identity();
      await expect(logIn()).resolves.toEqual({ ok: true, pending: true });
      const { id, authorize } = loginTab();

      // The person takes longer than 30 s to sign in; the reply then wakes the
      // background, which starts again before the event is delivered.
      stopBackground(chrome);
      await startBackground(chrome);
      navigate(chrome, id, approve(authorize.href));
      await settle();

      expect(chrome.storage.local.data.auth).toMatchObject({ token: 'bkm_new', server: SERVER });
      expect(chrome.tabs.data.has(id)).toBe(false);
      expect(pending()).toBeUndefined();
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '✓' });
    },
  );

  it('still hears its tab closing after a restart, where the identity window fell back to a tab', async () => {
    await arrange({});
    chrome.identity.launchWebAuthFlow.mockRejectedValue(new Error('This function is not supported on this browser.'));
    await logIn();
    stopBackground(chrome);
    await startBackground(chrome);
    closeTab(chrome, loginTab().id);
    await settle();
    expect(pending()).toBeUndefined();
    expect(chrome.storage.session.data.lastAuthError).toBe(CANCELLED);
  });
});
