/**
 * Logging in where the browser has no identity window to catch the reply
 * (Safari, Firefox for Android): the server's /authorize page opens in a window
 * or tab of the browser's own, and its reply lands on the server's
 * /authorize/done page, where that tab's events find it. The background can be
 * unloaded between those events, so the login waits in storage.session.
 */
import {
  LoginError,
  buildAuthorizeRequest,
  checkServer,
  finishLogin,
  timingSafeEqual,
  type LoginAttempt,
} from './auth';
import type { LoginResult } from './login';
import { normalizeBaseUrl } from './settings';

/** chrome.storage.session key: the tab login waiting for its reply. */
export const PENDING_LOGIN = 'pendingLogin';

export interface PendingLogin extends LoginAttempt {
  /** The tab showing the /authorize page. */
  tabId: number;
  /** Epoch ms after which the reply is no longer taken. */
  expiresAt: number;
}

const AUTHORIZE_PATH = '/authorize';
const DONE_PATH = '/authorize/done';
const WAIT_MS = 10 * 60_000;
const CANCELLED = 'Login cancelled.';
const TIMED_OUT = 'Login timed out — log in again.';
const NOT_OPENED = "The browser didn't open the bukmark login window — try again.";

// Changes to the pending login run one at a time: a tab's events come in
// bursts, and a page can ask about the same login meanwhile, but a reply's code
// must be redeemed once.
let turn: Promise<unknown> = Promise.resolve();

function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const run = turn.then(task);
  turn = run.catch(() => {});
  return run;
}

async function loadPending(): Promise<PendingLogin | null> {
  const { [PENDING_LOGIN]: pending } = await chrome.storage.session.get(PENDING_LOGIN);
  return (pending as PendingLogin | undefined) ?? null;
}

// Addresses are compared parsed, never by prefix: the browser reports the
// address it loaded with the host lowercased and a default port dropped.
function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** The login's own reply: its redirect page with its state. Foreign ones are ignored. */
function isReplyTo(pending: PendingLogin, url: string): boolean {
  const reply = parse(url);
  const expected = new URL(pending.redirectUri);
  return reply !== null
    && reply.origin === expected.origin
    && reply.pathname === expected.pathname
    && timingSafeEqual(reply.searchParams.get('state') ?? '', pending.state);
}

/** The login's pages: its server's /authorize page, and the reply page, whatever the state. */
function showsLogin(pending: PendingLogin, url: string): boolean {
  const page = parse(url);
  const authorize = new URL(`${pending.server}${AUTHORIZE_PATH}`);
  const done = new URL(pending.redirectUri);
  return page !== null
    && page.origin === authorize.origin
    && (page.pathname === authorize.pathname || page.pathname === done.pathname);
}

/**
 * An address that tells nothing of the page: none, as Chrome reports before a
 * tab's first page arrives and Safari for a site the extension has no access
 * to, or the about:blank Firefox reports before the first page arrives.
 */
function unseen(url: string | undefined): boolean {
  return !url || url === 'about:blank';
}

/** Forgets the login, and leaves its tab as it is. */
async function forget(error: string): Promise<LoginResult> {
  await chrome.storage.session.remove(PENDING_LOGIN);
  return { ok: false, error };
}

/** Forgets the login, then closes its tab, which still shows the login. */
async function abandon(pending: PendingLogin, error: string): Promise<LoginResult> {
  const result = await forget(error);
  await chrome.tabs.remove(pending.tabId).catch(() => {});
  return result;
}

/**
 * Takes the login out of storage first, so its code is redeemed once and the
 * tab's own closing is no cancel, then closes the tab and trades the code for a
 * token at the login's own server.
 */
async function finish(pending: PendingLogin, replyUrl: string): Promise<LoginResult> {
  await chrome.storage.session.remove(PENDING_LOGIN);
  await chrome.tabs.remove(pending.tabId).catch(() => {});
  try {
    await finishLogin(pending, replyUrl);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof LoginError ? err.message : 'Login failed.' };
  }
}

/**
 * The pending login checked against its tab, which may have moved on while
 * nothing was listening: finished when the tab already shows the reply,
 * dropped when it expired, its tab is gone, or a login for another `server`
 * was asked for. Null when none is pending.
 *
 * The tab is the login's only while it shows the login's pages, or nothing the
 * extension can see. People reuse tabs, and phones open the login in an
 * ordinary one: a tab taken anywhere else ends the login and stays open.
 */
async function checkPending(server?: string): Promise<LoginResult | null> {
  const pending = await loadPending();
  if (!pending) return null;
  const tab = await chrome.tabs.get(pending.tabId).catch(() => null);
  if (!tab) return forget(CANCELLED);
  const url = tab.url ?? '';
  const seen = !unseen(url);
  if (seen && !showsLogin(pending, url)) return forget(CANCELLED);
  const drop = (error: string) => (seen ? abandon(pending, error) : forget(error));
  if (server !== undefined && server !== pending.server) return drop(CANCELLED);
  if (Date.now() >= pending.expiresAt) return drop(TIMED_OUT);
  if (isReplyTo(pending, url)) return finish(pending, url);
  return { ok: true, pending: true };
}

/** A popup window where the browser has windows; a tab on Firefox for Android and Safari on iOS/iPadOS. */
async function openLoginTab(url: string): Promise<number> {
  const windows = chrome.windows as typeof chrome.windows | undefined;
  if (typeof windows?.create === 'function') {
    // Safari refuses ("not implemented") where its app opens no windows.
    const win = await windows.create({ url, type: 'popup', width: 480, height: 640 }).catch(() => undefined);
    const tabId = win?.tabs?.[0]?.id;
    if (tabId !== undefined) return tabId;
  }
  const tab = await chrome.tabs.create({ url }).catch(() => undefined);
  if (tab?.id === undefined) throw new LoginError(NOT_OPENED);
  return tab.id;
}

/**
 * Checks the server, opens its /authorize page in a window or tab of its own,
 * and returns at once: the reply arrives later, as that tab's events. One login
 * at a time: while one for the same server waits, this answers how it stands
 * and opens nothing. One for another server gives way — the page that asked
 * has already made this one the configured server, and a token only counts
 * there. Failures before the tab opens are LoginErrors.
 */
export function startTabLogin(baseUrl: string): Promise<LoginResult> {
  const server = normalizeBaseUrl(baseUrl);
  return inTurn(async () => {
    const earlier = await checkPending(server);
    if (earlier?.ok) return earlier;

    await checkServer(server, 'tab');
    const { url, ...attempt } = await buildAuthorizeRequest(server, `${server}${DONE_PATH}`);
    const tabId = await openLoginTab(url);
    const pending: PendingLogin = { ...attempt, tabId, expiresAt: Date.now() + WAIT_MS };
    await chrome.storage.session.set({ [PENDING_LOGIN]: pending });
    return { ok: true, pending: true };
  });
}

/**
 * tabs.onUpdated: the login's tab reaching its reply finishes the login. Null
 * for everything else — any other tab, page, server or state.
 */
export function tabLoginUpdated(tabId: number, url: string | undefined): Promise<LoginResult | null> {
  // Every page load in every tab comes through here; only a reply page is worth a storage read.
  if (!url?.includes(DONE_PATH)) return Promise.resolve(null);
  return inTurn(async () => {
    const pending = await loadPending();
    if (pending?.tabId !== tabId || !isReplyTo(pending, url)) return null;
    if (Date.now() >= pending.expiresAt) return abandon(pending, TIMED_OUT);
    return finish(pending, url);
  });
}

/** tabs.onRemoved: closing the login's tab cancels it. Null for any other tab. */
export function tabLoginRemoved(tabId: number): Promise<LoginResult | null> {
  return inTurn(async () => {
    const pending = await loadPending();
    if (pending?.tabId !== tabId) return null;
    return forget(CANCELLED);
  });
}

/**
 * For a page that found a login pending. The events of its tab may have come
 * while no background was listening (iOS), so the tab itself is checked.
 */
export function resumeTabLogin(): Promise<LoginResult | null> {
  return inTurn(() => checkPending());
}
