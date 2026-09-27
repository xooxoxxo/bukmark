import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { runMigrations } from '../db/migrate.js';
import { authCodes, sessions } from '../db/schema.js';
import {
  REDIRECT_URI, SAME_ORIGIN, TEST_PASSWORD, authCookie, authorizeParams, csrfFrom, exchange, mintCode,
  pkcePair, postAuthorize, setupOwner,
} from '../test/auth.js';
import { sha256hex } from './crypto.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self' https://*.chromiumapp.org; frame-ancestors 'none'; base-uri 'none'";
const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

function getAuthorize(app: FastifyInstance, params: Record<string, string>, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/authorize?${new URLSearchParams(params)}`,
    cookies: cookie ? { bukmark_session: cookie } : {},
  });
}

function expectSecurityHeaders(res: { headers: Record<string, unknown> }) {
  expect(res.headers['content-security-policy']).toBe(CSP);
  expect(res.headers['x-frame-options']).toBe('DENY');
  expect(res.headers['cache-control']).toBe('no-store');
  // no-referrer would make Chrome send `Origin: null` on the page's own posts.
  expect(res.headers['referrer-policy']).toBe('same-origin');
}

function sessionCookieFrom(res: { cookies: { name: string; value: string }[] }): string | undefined {
  return res.cookies.find((c) => c.name === 'bukmark_session')?.value;
}

describe('/authorize', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await runMigrations(TEST_URL);
  });

  beforeEach(async () => {
    app = await buildApp({ databaseUrl: TEST_URL });
    await app.db.execute(dsql`TRUNCATE owner, sessions, api_tokens, auth_codes`);
    return async () => { await app.close(); };
  });

  afterAll(async () => {
    const cleanup = await buildApp({ databaseUrl: TEST_URL });
    await cleanup.db.execute(dsql`TRUNCATE owner, sessions, api_tokens, auth_codes`);
    await cleanup.close();
  });

  describe('GET', () => {
    it('before setup tells the owner to open this server, not the redirect URI', async () => {
      const res = await getAuthorize(app, authorizeParams(pkcePair().challenge));
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<strong>http://localhost:80</strong>');
      expect(res.body).not.toContain('chromiumapp.org');
      expect(res.body).not.toContain('<form');
    });

    it('signed out renders the password form with the params as hidden fields', async () => {
      await setupOwner(app.db);
      const params = authorizeParams(pkcePair().challenge);
      const res = await getAuthorize(app, params);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expectSecurityHeaders(res);
      expect(res.body).toContain('type="password"');
      expect(res.body).toContain(`<code>${EXTENSION_ID}</code>`);
      expect(res.body).toContain(`name="state" value="${params.state}"`);
      expect(res.body).toContain(`name="redirect_uri" value="${REDIRECT_URI}"`);
      expect(res.body).not.toContain('name="csrf"');
      // Cancel must submit without a password.
      expect(res.body).toMatch(/value="deny" formnovalidate/);
    });

    it('signed in shows Allow directly, with a csrf bound to the session and params', async () => {
      const { cookie } = await authCookie(app.db);
      const params = authorizeParams(pkcePair().challenge);
      const res = await getAuthorize(app, params, cookie);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('value="allow"');
      expect(res.body).toContain('bukmark capture wants to save bookmarks to this server');
      expect(res.body).toContain(`<code>${EXTENSION_ID}</code>`);
      expect(res.body).not.toContain('type="password"');
      const expected = crypto.createHmac('sha256', cookie)
        .update(`authorize|${params.redirect_uri}|${params.state}|${params.code_challenge}`)
        .digest('hex');
      expect(csrfFrom(res.body)).toBe(expected);
    });

    it('an expired session cookie gets the signed-out form', async () => {
      const { cookie } = await authCookie(app.db);
      await app.db.update(sessions).set({ expiresAt: dsql`now() - interval '1 second'` });
      const res = await getAuthorize(app, authorizeParams(pkcePair().challenge), cookie);
      expect(res.body).toContain('type="password"');
      expect(res.body).not.toContain('value="allow"');
    });

    it.each([
      ['a foreign redirect_uri', { redirect_uri: 'https://evil.example/cb' }],
      ['a redirect_uri with a query', { redirect_uri: `${REDIRECT_URI}?x=1` }],
      ['a redirect_uri with a fragment', { redirect_uri: `${REDIRECT_URI}#x` }],
      ['an http redirect_uri', { redirect_uri: REDIRECT_URI.replace('https', 'http') }],
      ['an extension id outside a-p', { redirect_uri: 'https://abcdefghijklmnopqrstuvwxyzabcdef.chromiumapp.org/cb' }],
      ['code_challenge_method=plain', { code_challenge_method: 'plain' }],
      ['response_type=token', { response_type: 'token' }],
      ['a short code_challenge', { code_challenge: 'abc' }],
      ['a short state', { state: 'short' }],
      ['a state with query syntax', { state: 'xxxxxxxxxxxxxxxx&code=INJECTED' }],
      ['an empty client_name', { client_name: '' }],
      ['a 61-character client_name', { client_name: 'x'.repeat(61) }],
      ['a client_name of control characters only', { client_name: '\u0000\u0007\u007f' }],
    ])('rejects %s with a 400 page and no redirect', async (_name, override) => {
      await setupOwner(app.db);
      const res = await getAuthorize(app, authorizeParams(pkcePair().challenge, override));
      expect(res.statusCode).toBe(400);
      expect(res.headers.location).toBeUndefined();
      expect(res.body).toContain('This sign-in request is invalid');
      expect(res.body).not.toContain('<form');
      expectSecurityHeaders(res);
    });

    it('rejects a missing state and a missing code_challenge_method', async () => {
      await setupOwner(app.db);
      for (const key of ['state', 'code_challenge_method']) {
        const params = authorizeParams(pkcePair().challenge);
        delete params[key];
        const res = await getAuthorize(app, params);
        expect(res.statusCode, key).toBe(400);
      }
    });

    it('rejects a repeated parameter instead of crashing', async () => {
      await setupOwner(app.db);
      const qs = `${new URLSearchParams(authorizeParams(pkcePair().challenge))}&client_name=second`;
      const res = await app.inject({ method: 'GET', url: `/authorize?${qs}` });
      expect(res.statusCode).toBe(400);
    });

    it('escapes client_name and strips control characters from it', async () => {
      const { cookie } = await authCookie(app.db);
      const res = await getAuthorize(app, authorizeParams(pkcePair().challenge, {
        client_name: '<script>alert(1)</script>\u0007‮',
      }), cookie);
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('<script>');
      expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt; wants to save bookmarks');
      expect(res.body).not.toMatch(/[\u0007‮]/);
    });
  });

  describe('POST action=login', () => {
    it('with the right password sets the session cookie and renders Allow (200, not a redirect)', async () => {
      await setupOwner(app.db);
      const params = authorizeParams(pkcePair().challenge);
      const res = await postAuthorize(app, { ...params, action: 'login', password: TEST_PASSWORD });
      expect(res.statusCode).toBe(200);
      expectSecurityHeaders(res);
      const setCookie = String(res.headers['set-cookie']);
      expect(setCookie).toMatch(/^bukmark_session=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/);
      const cookie = sessionCookieFrom(res)!;
      expect(res.body).toContain('value="allow"');
      const expected = crypto.createHmac('sha256', cookie)
        .update(`authorize|${params.redirect_uri}|${params.state}|${params.code_challenge}`)
        .digest('hex');
      expect(csrfFrom(res.body)).toBe(expected);
    });

    it('with a wrong password re-renders the form with an error and no cookie', async () => {
      await setupOwner(app.db);
      const res = await postAuthorize(app, { ...authorizeParams(pkcePair().challenge), action: 'login', password: 'wrong password' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.body).toContain('Wrong password.');
      expect(res.body).toContain('type="password"');
    });

    it('treats an over-long password as wrong', async () => {
      await setupOwner(app.db);
      const res = await postAuthorize(app, { ...authorizeParams(pkcePair().challenge), action: 'login', password: 'x'.repeat(1025) });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Wrong password.');
    });

    it('before setup renders the not-set-up page', async () => {
      const res = await postAuthorize(app, { ...authorizeParams(pkcePair().challenge), action: 'login', password: TEST_PASSWORD });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('has no owner yet');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('counts failures toward the login limit it shares with /api/auth/login', async () => {
      await setupOwner(app.db);
      const params = authorizeParams(pkcePair().challenge);
      for (let i = 0; i < 5; i++) {
        await postAuthorize(app, { ...params, action: 'login', password: 'wrong password' });
        await app.inject({ method: 'POST', url: '/api/auth/login', headers: SAME_ORIGIN, payload: { password: 'wrong password' } });
      }
      const res = await postAuthorize(app, { ...params, action: 'login', password: TEST_PASSWORD });
      expect(res.statusCode).toBe(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(res.body).toContain('Too many sign-in attempts');
      expect(res.headers['set-cookie']).toBeUndefined();
      expectSecurityHeaders(res);
    });

    it('with a foreign redirect_uri or no redirect_uri is refused before any session is made', async () => {
      await setupOwner(app.db);
      const params = authorizeParams(pkcePair().challenge);
      const { redirect_uri: _omitted, ...withoutRedirect } = params;
      for (const fields of [{ ...params, redirect_uri: 'https://evil.example/cb' }, withoutRedirect]) {
        const res = await postAuthorize(app, { ...fields, action: 'login', password: TEST_PASSWORD });
        expect(res.statusCode).toBe(400);
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(res.headers.location).toBeUndefined();
      }
      expect(await app.db.select().from(sessions)).toHaveLength(0);
    });
  });

  describe('POST action=allow', () => {
    async function signedIn() {
      const { cookie } = await authCookie(app.db);
      const pkce = pkcePair();
      const params = authorizeParams(pkce.challenge);
      const page = await getAuthorize(app, params, cookie);
      return { cookie, params, pkce, csrf: csrfFrom(page.body)! };
    }

    it('redirects 303 with code and state, and the code exchanges for a working token', async () => {
      const { cookie, params, pkce, csrf } = await signedIn();
      const res = await postAuthorize(app, { ...params, action: 'allow', csrf }, { cookie });
      expect(res.statusCode).toBe(303);
      expectSecurityHeaders(res);
      const location = new URL(res.headers.location as string);
      expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
      expect(location.searchParams.get('state')).toBe(params.state);
      const code = location.searchParams.get('code')!;
      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const [row] = await app.db.execute<{ ttl_ok: boolean }>(dsql`
        SELECT expires_at BETWEEN now() + interval '100 seconds' AND now() + interval '2 minutes' AS ttl_ok
        FROM auth_codes WHERE code_hash = ${sha256hex(code)}`);
      expect(row?.ttl_ok).toBe(true);

      const ex = await exchange(app, {
        grant_type: 'authorization_code', code, code_verifier: pkce.verifier, redirect_uri: REDIRECT_URI,
      });
      expect(ex.statusCode).toBe(200);
      expect(ex.json().name).toBe('bukmark capture');
      const links = await app.inject({ method: 'GET', url: '/api/links', headers: { authorization: `Bearer ${ex.json().token}` } });
      expect(links.statusCode).toBe(200);
    });

    it('without a csrf field is 403 and mints no code', async () => {
      const { cookie, params } = await signedIn();
      const res = await postAuthorize(app, { ...params, action: 'allow' }, { cookie });
      expect(res.statusCode).toBe(403);
      expect(res.headers.location).toBeUndefined();
      expect(await app.db.select().from(authCodes)).toHaveLength(0);
    });

    it('with a forged csrf, or one for other params, is 403', async () => {
      const { cookie, params, csrf } = await signedIn();
      for (const fields of [
        { ...params, csrf: 'f'.repeat(64) },
        { ...params, csrf, state: `${params.state}x` },
        { ...params, csrf, code_challenge: pkcePair().challenge },
      ]) {
        const res = await postAuthorize(app, { ...fields, action: 'allow' }, { cookie });
        expect(res.statusCode).toBe(403);
      }
      expect(await app.db.select().from(authCodes)).toHaveLength(0);
    });

    it('with a foreign redirect_uri is 400 and never redirects', async () => {
      const { cookie, params, csrf } = await signedIn();
      const res = await postAuthorize(app, { ...params, redirect_uri: 'https://evil.example/cb', action: 'allow', csrf }, { cookie });
      expect(res.statusCode).toBe(400);
      expect(res.headers.location).toBeUndefined();
    });

    it('without a live session re-renders the sign-in form (a 4xx would end Chrome\'s auth flow)', async () => {
      await setupOwner(app.db);
      const params = authorizeParams(pkcePair().challenge);
      const res = await postAuthorize(app, { ...params, action: 'allow', csrf: 'f'.repeat(64) }, { cookie: 'not-a-session' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('type="password"');
      expect(await app.db.select().from(authCodes)).toHaveLength(0);
    });

    it.each([
      ['a foreign Origin', { origin: 'http://evil.example', host: 'localhost:3000' }],
      ['the same hostname on another port', { origin: 'http://localhost:8080', host: 'localhost:3000' }],
      ['Origin: null', { origin: 'null', host: 'localhost:3000' }],
      ['no Origin', { origin: '', host: 'localhost:3000' }],
    ])('from %s is 403', async (_name, headers) => {
      const { cookie, params, csrf } = await signedIn();
      const res = await postAuthorize(app, { ...params, action: 'allow', csrf }, { cookie, headers });
      expect(res.statusCode).toBe(403);
      expectSecurityHeaders(res);
    });

    it('purges auth codes that expired over an hour ago', async () => {
      await app.db.insert(authCodes).values({
        codeHash: 'stale', codeChallenge: 'c', redirectUri: REDIRECT_URI, clientName: 'old', expiresAt: dsql`now() - interval '2 hours'`,
      });
      await mintCode(app);
      const rows = await app.db.select({ codeHash: authCodes.codeHash }).from(authCodes);
      expect(rows.map((r) => r.codeHash)).not.toContain('stale');
      expect(rows).toHaveLength(1);
    });
  });

  describe('POST action=deny', () => {
    it('redirects 303 with error=access_denied and the state, without a session', async () => {
      await setupOwner(app.db);
      const params = authorizeParams(pkcePair().challenge);
      const res = await postAuthorize(app, { ...params, action: 'deny' });
      expect(res.statusCode).toBe(303);
      const location = new URL(res.headers.location as string);
      expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
      expect(location.searchParams.get('error')).toBe('access_denied');
      expect(location.searchParams.get('state')).toBe(params.state);
      expect([...location.searchParams.keys()]).toEqual(['error', 'state']);
    });

    it('with a foreign redirect_uri or an injected state is 400 and never redirects', async () => {
      const params = authorizeParams(pkcePair().challenge);
      for (const fields of [
        { ...params, redirect_uri: 'https://evil.example/cb' },
        { ...params, state: 'xxxxxxxxxxxxxxxx&code=INJECTED' },
      ]) {
        const res = await postAuthorize(app, { ...fields, action: 'deny' });
        expect(res.statusCode).toBe(400);
        expect(res.headers.location).toBeUndefined();
      }
    });

    it('from a foreign Origin is 403', async () => {
      const res = await postAuthorize(app, { ...authorizeParams(pkcePair().challenge), action: 'deny' }, {
        headers: { origin: 'http://evil.example' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.headers.location).toBeUndefined();
    });
  });

  describe('POST bodies', () => {
    it('only accepts form bodies: JSON gets a 415 page', async () => {
      await setupOwner(app.db);
      const res = await app.inject({
        method: 'POST',
        url: '/authorize',
        headers: SAME_ORIGIN,
        payload: { ...authorizeParams(pkcePair().challenge), action: 'deny' },
      });
      expect(res.statusCode).toBe(415);
      expect(res.headers.location).toBeUndefined();
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expectSecurityHeaders(res);
    });

    it('accepts a form content type with a charset parameter', async () => {
      const res = await postAuthorize(app, { ...authorizeParams(pkcePair().challenge), action: 'deny' }, {
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      });
      expect(res.statusCode).toBe(303);
    });

    it('rejects an unknown action with a 400 page', async () => {
      const res = await postAuthorize(app, { ...authorizeParams(pkcePair().challenge), action: 'steal' });
      expect(res.statusCode).toBe(400);
      expect(res.headers.location).toBeUndefined();
    });
  });

  it('a real browser sequence: sign in, Allow, exchange', async () => {
    await setupOwner(app.db);
    const pkce = pkcePair();
    const params = authorizeParams(pkce.challenge);

    const first = await getAuthorize(app, params);
    expect(first.body).toContain('type="password"');

    const login = await postAuthorize(app, { ...params, action: 'login', password: TEST_PASSWORD });
    const cookie = sessionCookieFrom(login)!;
    const allow = await postAuthorize(app, { ...params, action: 'allow', csrf: csrfFrom(login.body)! }, { cookie });
    expect(allow.statusCode).toBe(303);

    const code = new URL(allow.headers.location as string).searchParams.get('code')!;
    const ex = await exchange(app, { grant_type: 'authorization_code', code, code_verifier: pkce.verifier, redirect_uri: REDIRECT_URI });
    expect(ex.statusCode).toBe(200);

    // Signed in now, so the next extension login skips the password.
    const again = await getAuthorize(app, authorizeParams(pkcePair().challenge), cookie);
    expect(again.body).toContain('value="allow"');
  });
});
