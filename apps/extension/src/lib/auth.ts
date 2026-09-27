/**
 * Logging the extension in to a bukmark server: an authorization code flow with
 * PKCE (RFC 7636, S256 only) against the server's /authorize page.
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

const CLIENT_NAME = 'bukmark capture';
const KEEPALIVE_MS = 20_000;
const LOGOUT_TIMEOUT_MS = 5_000;
const MISMATCH = "Login failed — the reply didn't match this login attempt. Try again.";
const BAD_REPLY = 'Login failed — unexpected reply from the server.';

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

// launchWebAuthFlow rejects with Chrome's own fixed English messages.
function flowError(err: unknown, host: string): LoginError {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'The user did not approve access.') return new LoginError('Login cancelled.');
  if (message === 'Authorization page could not be loaded.') {
    // Chrome also ends the flow this way when the page answers 4xx/5xx,
    // which includes a rate-limited sign-in inside the window.
    return new LoginError(
      `Couldn't open ${host}/authorize — check the address and that the server runs bukmark 0.2+ (or too many sign-in attempts).`,
    );
  }
  if (/one web auth flow/i.test(message)) return new LoginError('A bukmark login window is already open.');
  return new LoginError(`Login failed: ${message}`);
}

async function exchangeCode(
  server: string,
  host: string,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<Auth> {
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
    throw new LoginError(`Login failed — couldn't reach ${host}.`);
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
 * The whole login, run in the background worker: opens the server's
 * /authorize page, checks the reply, exchanges the code and stores the token.
 * Failures the person can act on are LoginErrors.
 */
export async function loginFlow(baseUrl: string): Promise<Auth> {
  const server = normalizeBaseUrl(baseUrl);
  const { host } = new URL(server);
  const verifier = generateVerifier();
  const state = generateState();
  const redirectUri = chrome.identity.getRedirectURL('bukmark');
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    code_challenge: await pkceS256(verifier),
    code_challenge_method: 'S256',
    client_name: CLIENT_NAME,
  });

  // Chrome stops a service worker after 30 s without events, and typing the
  // password in the bukmark window can take longer than that.
  const keepalive = setInterval(() => void chrome.runtime.getPlatformInfo(), KEEPALIVE_MS);
  try {
    const responseUrl = await chrome.identity
      .launchWebAuthFlow({ url: `${server}/authorize?${params}`, interactive: true })
      .catch((err: unknown) => {
        throw flowError(err, host);
      });
    if (!responseUrl) throw new LoginError('Login cancelled.');

    const reply = new URL(responseUrl).searchParams;
    if (!timingSafeEqual(reply.get('state') ?? '', state)) throw new LoginError(MISMATCH);
    const error = reply.get('error');
    if (error === 'access_denied') throw new LoginError('Access was denied in the bukmark window.');
    if (error) throw new LoginError(`Login failed (${error}).`);
    const code = reply.get('code');
    if (!code) throw new LoginError(BAD_REPLY);

    const auth = await exchangeCode(server, host, code, verifier, redirectUri);
    const replaced = await loadAuth();
    await saveAuth(auth);
    // Nothing here remembers a replaced token, so this is the last chance to
    // revoke it rather than leave it live on its server.
    if (replaced) void revoke(replaced);
    return auth;
  } finally {
    clearInterval(keepalive);
  }
}

/** Constant-time comparison for equal-length strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
