import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { owner } from '../db/schema.js';
import { hashPassword, pkceS256, randomToken } from '../auth/crypto.js';
import { createAccessToken } from '../auth/tokens.js';
import { createSession } from '../auth/sessions.js';
import { FIREFOX_ADDON_ID, firefoxRedirectHash } from '../auth/authorizePage.js';

export const TEST_PASSWORD = 'test-password-123';
/** Origin and Host of a same-origin browser request; inject's default Host is localhost:80. */
export const SAME_ORIGIN = { origin: 'http://localhost:3000', host: 'localhost:3000' };
export const REDIRECT_URI = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/bukmark';
/** Firefox's identity.getRedirectURL('bukmark') for the official add-on. */
export const FIREFOX_REDIRECT_URI = `https://${firefoxRedirectHash(FIREFOX_ADDON_ID)}.extensions.allizom.org/bukmark`;
/** The tab login's redirect: this server's own page, on the Host SAME_ORIGIN requests carry. */
export const TAB_REDIRECT_URI = `http://${SAME_ORIGIN.host}/authorize/done`;

export async function setupOwner(db: Db, password: string = TEST_PASSWORD): Promise<void> {
  const hash = await hashPassword(password);
  await db.insert(owner).values({
    passwordHash: hash,
  }).onConflictDoNothing();
}

export async function authHeaders(db: Db): Promise<{ Authorization: string }> {
  await setupOwner(db);
  const token = await createAccessToken(db, 'test-token');
  return {
    Authorization: `Bearer ${token.token}`,
  };
}

export async function authCookie(db: Db): Promise<{ cookie: string }> {
  await setupOwner(db);
  const { sessionId } = await createSession(db);
  return {
    cookie: sessionId,
  };
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(32);
  return { verifier, challenge: pkceS256(verifier) };
}

/** The query / hidden fields the extension sends to /authorize. */
export function authorizeParams(challenge: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    state: randomToken(32),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    client_name: 'bukmark capture',
    ...overrides,
  };
}

/** Submits the /authorize form the way a browser does: form-encoded, same Origin. */
export function postAuthorize(
  app: FastifyInstance,
  fields: Record<string, string>,
  opts: { cookie?: string; headers?: Record<string, string> } = {},
) {
  return app.inject({
    method: 'POST',
    url: '/authorize',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...SAME_ORIGIN, ...opts.headers },
    cookies: opts.cookie ? { bukmark_session: opts.cookie } : {},
    payload: new URLSearchParams(fields).toString(),
  });
}

export function csrfFrom(html: string): string | undefined {
  return /name="csrf" value="([0-9a-f]{64})"/.exec(html)?.[1];
}

/** Runs the signed-in Allow step against the real routes and returns the minted code. */
export async function mintCode(
  app: FastifyInstance,
  overrides: Record<string, string> = {},
): Promise<{ code: string; verifier: string; params: Record<string, string>; location: string }> {
  const { cookie } = await authCookie(app.db);
  const { verifier, challenge } = pkcePair();
  const params = authorizeParams(challenge, overrides);
  const page = await app.inject({
    method: 'GET',
    url: `/authorize?${new URLSearchParams(params)}`,
    headers: { host: SAME_ORIGIN.host },
    cookies: { bukmark_session: cookie },
  });
  const csrf = csrfFrom(page.body);
  if (!csrf) throw new Error(`no Allow form: ${page.statusCode} ${page.body.slice(0, 200)}`);
  const res = await postAuthorize(app, { ...params, action: 'allow', csrf }, { cookie });
  const location = res.headers.location as string;
  const code = new URL(location).searchParams.get('code');
  if (res.statusCode !== 303 || !code) throw new Error(`allow failed: ${res.statusCode}`);
  return { code, verifier, params, location };
}

export function exchange(app: FastifyInstance, body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/auth/token', payload: body });
}
