/**
 * Logging the extension in to a bukmark server: an authorization code flow with
 * PKCE (RFC 7636, S256 only) against the server's /authorize page, in three
 * steps — build the request, capture the reply, finish. The browser's identity
 * window captures the reply here; lib/tabLogin.ts captures it in a tab where
 * there is no such window. Or an access token pasted from the web app, checked
 * with its server.
 *
 * A token is bound to the server that issued it. Requests are built from
 * `auth.server`, never from settings, so a token cannot reach another host.
 */
import { normalizeBaseUrl } from './settings';

export interface Auth {
  token: string;
  tokenId: string;
  /** Normalized base URL of the server that issued the token. */
  server: string;
  name: string;
  createdAt: number;
}

export class AuthRequiredError extends Error {
  constructor() {
    super('Not authenticated');
    this.name = 'AuthRequiredError';
  }
}

/** A failed login, worded for the person who clicked Log in. */
export class LoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginError';
  }
}

/**
 * The browser's identity window can't run this login: there is none, it
 * redirects somewhere no bukmark server accepts, or the browser says it is
 * unsupported. A login in a tab can (lib/tabLogin.ts).
 */
export class IdentityUnsupportedError extends Error {
  constructor() {
    super("This browser's identity window can't run a bukmark login");
    this.name = 'IdentityUnsupportedError';
  }
}

const CLIENT_NAME = 'bukmark capture';
const KEEPALIVE_MS = 20_000;
const LOGOUT_TIMEOUT_MS = 5_000;
const STATUS_TIMEOUT_MS = 10_000;
const MISMATCH = "Login failed — the reply didn't match this login attempt. Try again.";
const BAD_REPLY = 'Login failed — unexpected reply from the server.';

const unreachable = (host: string): string =>
  `Couldn't reach ${host} — check the address and that the server is running.`;
const updateServer = (host: string): string =>
  `Update your bukmark server — ${host} can't log in this browser yet.`;

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** PKCE verifier: 32 random bytes → 43 chars of [A-Za-z0-9-_]. */
export function generateVerifier(): string {
  return base64url(randomBytes(32));
}

/** S256 code challenge: base64url(sha256(verifier)). */
export async function pkceS256(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(hash));
}

/** State: 32 random bytes base64url, to match the reply to this request. */
export function generateState(): string {
  return base64url(randomBytes(32));
}

export async function loadAuth(): Promise<Auth | null> {
  const stored = await chrome.storage.local.get('auth');
  return (stored.auth as Auth | undefined) ?? null;
}

export async function saveAuth(auth: Auth): Promise<void> {
  await chrome.storage.local.set({ auth });
}

export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove('auth');
}

/**
 * The stored auth, only if it was issued by `baseUrl`. When the configured
 * server differs from the token's own, the extension is logged out.
 */
export async function authFor(baseUrl: string): Promise<Auth | null> {
  const auth = await loadAuth();
  return auth?.server === normalizeBaseUrl(baseUrl) ? auth : null;
}

/** Asks the token's own server to delete it. False when the server did not confirm. */
function revoke(auth: Auth): Promise<boolean> {
  return fetch(`${auth.server}/api/auth/logout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth.token}` },
    signal: AbortSignal.timeout(LOGOUT_TIMEOUT_MS),
  }).then(
    // 401: the server no longer accepts the token, which is the point.
    (res) => res.ok || res.status === 401,
    () => false,
  );
}

/**
 * Logs out here first, so a server that hangs or is gone cannot keep the
 * extension logged in, then revokes the token on its server. Resolves false
 * when the server did not confirm: the token may still be live there.
 */
export async function logout(auth: Auth): Promise<boolean> {
  await clearAuth();
  return revoke(auth);
}

/**
 * Stores a new login. Nothing else remembers the token it replaces, so this is
 * the last chance to revoke that one rather than leave it live on its server.
 */
export async function adopt(auth: Auth): Promise<void> {
  const replaced = await loadAuth();
  await saveAuth(auth);
  if (replaced && replaced.token !== auth.token) void revoke(replaced);
}

/** How the authorize page's reply comes back. Servers list the kinds they accept. */
export type RedirectKind = 'chromium' | 'firefox' | 'tab';

/**
 * The kind of an identity API redirect URI, or null for one no bukmark server
 * accepts. The server's own patterns, on the raw string as the server sees it.
 */
export function identityRedirectKind(redirectUri: string): RedirectKind | null {
  if (/^https:\/\/[a-p]{32}\.chromiumapp\.org\/[A-Za-z0-9._~/-]*$/.test(redirectUri)) return 'chromium';
  if (/^https:\/\/[0-9a-f]{40}\.extensions\.allizom\.org\/[A-Za-z0-9._~/-]*$/.test(redirectUri)) return 'firefox';
  return null;
}

interface ServerStatus {
  authenticated?: unknown;
  redirectKinds?: unknown;
}

/**
 * GET /api/auth/status, public on every bukmark server with logins. Null when
 * the server has no such route: a bukmark from before logins.
 */
async function serverStatus(server: string, token?: string): Promise<ServerStatus | null> {
  const { host } = new URL(server);
  const res = await fetch(`${server}/api/auth/status`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  }).catch(() => {
    throw new LoginError(unreachable(host));
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new LoginError(`Login failed — ${host} answered HTTP ${res.status}.`);
  const body: unknown = await res.json().catch(() => null);
  if (typeof body !== 'object' || body === null) throw new LoginError(BAD_REPLY);
  return body;
}

/**
 * Checked before any login window opens: the server answers, and accepts
 * replies of this kind. Otherwise Firefox opens its window on its own error
 * page, and an older server on an invalid-request page.
 */
export async function checkServer(server: string, kind: RedirectKind): Promise<void> {
  const kinds = (await serverStatus(server))?.redirectKinds;
  if (!Array.isArray(kinds) || !kinds.includes(kind)) {
    throw new LoginError(updateServer(new URL(server).host));
  }
}

/**
 * One login attempt: what the authorize page is asked for, and what its reply
 * must match. Plain data, so a reply captured later can still be finished.
 */
export interface AuthorizeRequest {
  /** Normalized base URL: the code is exchanged, and the token used, only here. */
  server: string;
  redirectUri: string;
  state: string;
  verifier: string;
  /** The server's /authorize page, asking for this login. */
  url: string;
}

/** What a reply is checked against, and its code redeemed with: the request without its URL. */
export type LoginAttempt = Omit<AuthorizeRequest, 'url'>;

/** Step 1: a fresh PKCE verifier and state for one login. */
export async function buildAuthorizeRequest(baseUrl: string, redirectUri: string): Promise<AuthorizeRequest> {
  const server = normalizeBaseUrl(baseUrl);
  const verifier = generateVerifier();
  const state = generateState();
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    code_challenge: await pkceS256(verifier),
    code_challenge_method: 'S256',
    client_name: CLIENT_NAME,
  });
  return { server, redirectUri, state, verifier, url: `${server}/authorize?${params}` };
}

function messageOf(err: unknown): string {
  return String((err as { message?: unknown } | null)?.message ?? err);
}

// A browser with the call but without the window behind it.
const UNSUPPORTED = /unsupported|not (?:yet )?(?:supported|implemented|available)/i;

// launchWebAuthFlow rejects with the browser's own fixed English messages:
// Chrome's, and Firefox's from toolkit/components/extensions/{child,parent}/ext-identity.js.
function flowError(err: unknown, host: string): LoginError {
  const message = messageOf(err);
  if (message === 'The user did not approve access.' || message === 'User cancelled or denied access.') {
    return new LoginError('Login cancelled.');
  }
  if (message === 'Authorization page could not be loaded.') {
    // Chrome also ends the flow this way when the page answers 4xx/5xx,
    // which includes a rate-limited sign-in inside the window.
    return new LoginError(
      `Couldn't open ${host}/authorize — check the address and that the server runs bukmark 0.2+ (or too many sign-in attempts).`,
    );
  }
  if (message === 'redirect_uri not allowed') return new LoginError(updateServer(host));
  // Firefox's text carries no full stop.
  if (message.startsWith('Requires user interaction')) {
    return new LoginError("The browser didn't open the bukmark login window — try again.");
  }
  if (/one web auth flow/i.test(message)) return new LoginError('A bukmark login window is already open.');
  return new LoginError(`Login failed: ${message}`);
}

/** Where the identity API delivers the reply. */
function identityRedirectUri(identity: typeof chrome.identity): string {
  if (typeof identity.getRedirectURL === 'function') return identity.getRedirectURL('bukmark');
  // Opera documents launchWebAuthFlow but not getRedirectURL: Chromium's fixed pattern.
  return `https://${chrome.runtime.id}.chromiumapp.org/bukmark`;
}

/** Step 2, the identity way: the browser's own window catches the redirect and hands it back. */
async function captureWithIdentity(request: AuthorizeRequest): Promise<string> {
  const replyUrl = await chrome.identity
    .launchWebAuthFlow({ url: request.url, interactive: true })
    .catch((err: unknown) => {
      if (UNSUPPORTED.test(messageOf(err))) throw new IdentityUnsupportedError();
      throw flowError(err, new URL(request.server).host);
    });
  if (!replyUrl) throw new LoginError('Login cancelled.');
  return replyUrl;
}

async function exchangeCode(request: LoginAttempt, code: string): Promise<Auth> {
  const { server, verifier, redirectUri } = request;
  const res = await fetch(`${server}/api/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  }).catch(() => {
    throw new LoginError(`Login failed — couldn't reach ${new URL(server).host}.`);
  });
  if (!res.ok) throw new LoginError(`Login failed (HTTP ${res.status}).`);

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const { token, tokenId, name } = body ?? {};
  if (typeof token !== 'string' || typeof tokenId !== 'string' || typeof name !== 'string') {
    throw new LoginError(BAD_REPLY);
  }
  return { token, tokenId, server, name, createdAt: Date.now() };
}

/**
 * Step 3: the reply must answer this request, then its code is traded for a
 * token at the same server, which is stored.
 */
export async function finishLogin(request: LoginAttempt, replyUrl: string): Promise<Auth> {
  const reply = new URL(replyUrl).searchParams;
  if (!timingSafeEqual(reply.get('state') ?? '', request.state)) throw new LoginError(MISMATCH);
  const error = reply.get('error');
  if (error === 'access_denied') throw new LoginError('Access was denied in the bukmark window.');
  if (error) throw new LoginError(`Login failed (${error}).`);
  const code = reply.get('code');
  if (!code) throw new LoginError(BAD_REPLY);

  const auth = await exchangeCode(request, code);
  await adopt(auth);
  return auth;
}

/** Whether the browser has an identity window to log in with. Safari and Firefox for Android have none. */
export function identityFlowAvailable(): boolean {
  return typeof (chrome.identity as typeof chrome.identity | undefined)?.launchWebAuthFlow === 'function';
}

/**
 * The whole login in the browser's identity window, run in the background
 * worker: checks the server, opens its /authorize page, and finishes with the
 * reply. Failures the person can act on are LoginErrors; an
 * IdentityUnsupportedError means the login has to run in a tab instead.
 */
export async function loginFlow(baseUrl: string): Promise<Auth> {
  if (!identityFlowAvailable()) throw new IdentityUnsupportedError();
  const redirectUri = identityRedirectUri(chrome.identity);
  const kind = identityRedirectKind(redirectUri);
  if (!kind) throw new IdentityUnsupportedError();

  const server = normalizeBaseUrl(baseUrl);
  await checkServer(server, kind);
  const request = await buildAuthorizeRequest(server, redirectUri);

  // Chrome stops a service worker after 30 s without events, and typing the
  // password in the bukmark window can take longer than that.
  const keepalive = setInterval(() => void chrome.runtime.getPlatformInfo(), KEEPALIVE_MS);
  try {
    return await finishLogin(request, await captureWithIdentity(request));
  } finally {
    clearInterval(keepalive);
  }
}

/**
 * A pasted access token, checked with its server: the auth to store for it,
 * bound to that server like a login's.
 */
export async function verifyToken(baseUrl: string, token: string): Promise<Auth> {
  const server = normalizeBaseUrl(baseUrl);
  const { host } = new URL(server);
  const status = await serverStatus(server, token);
  if (!status) throw new LoginError(updateServer(host));
  if (status.authenticated !== true) {
    throw new LoginError(
      `${host} didn't accept that token — copy it again, or create a new one in the web app under Settings › Access tokens.`,
    );
  }
  // The web app lists tokens by these first 12 characters.
  return { token, tokenId: '', server, name: `access token ${token.slice(0, 12)}…`, createdAt: Date.now() };
}

/** Constant-time comparison for equal-length strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
