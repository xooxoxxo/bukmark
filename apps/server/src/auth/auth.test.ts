import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../app.js';
import { runMigrations } from '../db/migrate.js';
import {
  setupOwner, authHeaders, authCookie, SAME_ORIGIN, REDIRECT_URI, FIREFOX_REDIRECT_URI, TAB_REDIRECT_URI, TEST_PASSWORD, mintCode, exchange,
} from '../test/auth.js';
import { owner, sessions, apiTokens, authCodes } from '../db/schema.js';
import { hashPassword, pkceS256, randomToken, sha256hex, verifyPassword } from './crypto.js';
import { createAccessToken } from './tokens.js';
import { resetOwner } from './resetOwner.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';

const SESSION_COOKIE = /^bukmark_session=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/;
const INVALID_GRANT = { error: 'Invalid or expired authorization code', code: 'invalid_grant' };
// Contract §1.5: the extension checks this list before it opens a login window.
const REDIRECT_KINDS = ['chromium', 'firefox', 'tab'];

function newApp(opts: Parameters<typeof buildApp>[0] = {}): Promise<FastifyInstance> {
  return buildApp({ databaseUrl: TEST_URL, ...opts });
}

function post(app: FastifyInstance, url: string, payload: unknown, headers: Record<string, string> = SAME_ORIGIN) {
  return app.inject({ method: 'POST', url, payload: payload as object, headers });
}

describe('auth', () => {
  beforeAll(async () => {
    await runMigrations(TEST_URL);
  });

  beforeEach(async () => {
    const app = await newApp();
    await app.db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, owner, sessions, api_tokens, auth_codes, quotes CASCADE`);
    await app.close();
  });

  afterAll(async () => {
    const app = await newApp();
    await app.db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, owner, sessions, api_tokens, auth_codes, quotes CASCADE`);
    await app.close();
  });

  describe('POST /api/auth/setup', () => {
    it('creates owner and returns 201 with the session cookie', async () => {
      const app = await newApp();
      const res = await post(app, '/api/auth/setup', { password: TEST_PASSWORD });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ ok: true });
      expect(res.headers['set-cookie']).toMatch(SESSION_COOKIE);
      const cookie = res.cookies.find((c) => c.name === 'bukmark_session')!.value;
      const me = await app.inject({ method: 'GET', url: '/api/auth/status', cookies: { bukmark_session: cookie } });
      expect(me.json()).toEqual({ setupComplete: true, authenticated: true, redirectKinds: REDIRECT_KINDS });
      await app.close();
    });

    it('returns 409 on second setup', async () => {
      const app = await newApp();
      await setupOwner(app.db);
      const res = await post(app, '/api/auth/setup', { password: TEST_PASSWORD });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('already_setup');
      expect(res.headers['set-cookie']).toBeUndefined();
      await app.close();
    });

    it('rejects password under 12 characters', async () => {
      const app = await newApp();
      const res = await post(app, '/api/auth/setup', { password: 'short' });
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it.each([
      ['no Origin', { host: 'localhost:3000' }],
      ['a foreign Origin', { origin: 'http://evil.example', host: 'localhost:3000' }],
      ['the same hostname on another port', { origin: 'http://localhost:8080', host: 'localhost:3000' }],
      ['Origin: null', { origin: 'null', host: 'localhost:3000' }],
      ['an unparseable Origin', { origin: 'garbage', host: 'localhost:3000' }],
    ])('refuses setup from %s with 403 bad_origin', async (_name, headers) => {
      const app = await newApp();
      const res = await post(app, '/api/auth/setup', { password: TEST_PASSWORD }, headers);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('bad_origin');
      expect(await app.db.select().from(owner)).toHaveLength(0);
      await app.close();
    });

    it('accepts an Origin whose default port a proxy wrote into Host', async () => {
      const app = await newApp();
      const res = await post(app, '/api/auth/setup', { password: TEST_PASSWORD }, { origin: 'https://bukmark.example', host: 'bukmark.example:443' });
      expect(res.statusCode).toBe(201);
      await app.close();
    });

    it('concurrent setup calls create exactly one owner', async () => {
      const app = await newApp();
      const results = await Promise.all(Array.from({ length: 3 }, () => post(app, '/api/auth/setup', { password: TEST_PASSWORD })));
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
      expect(results.filter((r) => r.statusCode === 409)).toHaveLength(2);
      expect(await app.db.select().from(owner)).toHaveLength(1);
      await app.close();
    });

    it('rate limits after 10 attempts', async () => {
      const app = await newApp();
      await setupOwner(app.db);
      for (let i = 0; i < 10; i++) await post(app, '/api/auth/setup', { password: TEST_PASSWORD });
      const res = await post(app, '/api/auth/setup', { password: TEST_PASSWORD });
      expect(res.statusCode).toBe(429);
      expect(res.json().code).toBe('rate_limited');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      await app.close();
    });

    it('opens protected routes to a bearer immediately after setup', async () => {
      const app = await newApp();
      const before = await app.inject({ method: 'GET', url: '/api/links' });
      expect(before.json()).toEqual({ error: 'Setup required', code: 'setup_required' });
      // Created behind this app's back (another process, the test helper): the
      // "no owner" answer above must not have been cached.
      const headers = await authHeaders(app.db);
      const after = await app.inject({ method: 'GET', url: '/api/links', headers });
      expect(after.statusCode).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with correct password and sets a Lax, HttpOnly, non-Secure cookie over http', async () => {
      const app = await newApp();
      await setupOwner(app.db);
      const res = await post(app, '/api/auth/login', { password: TEST_PASSWORD });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(res.headers['set-cookie']).toMatch(SESSION_COOKIE);
      await app.close();
    });

    it('marks the cookie Secure behind a trusted https proxy', async () => {
      const app = await newApp({ trustProxy: 1 });
      await setupOwner(app.db);
      const res = await post(app, '/api/auth/login', { password: TEST_PASSWORD }, { ...SAME_ORIGIN, 'x-forwarded-proto': 'https' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['set-cookie']).toMatch(/; Secure; SameSite=Lax$/);
      await app.close();
    });

    it('ignores X-Forwarded-Proto when no proxy is trusted', async () => {
      const app = await newApp({ trustProxy: false });
      await setupOwner(app.db);
      const res = await post(app, '/api/auth/login', { password: TEST_PASSWORD }, { ...SAME_ORIGIN, 'x-forwarded-proto': 'https' });
      expect(res.headers['set-cookie']).not.toMatch(/Secure/);
      await app.close();
    });

    it('rejects wrong password', async () => {
      const app = await newApp();
      await setupOwner(app.db);
      const res = await post(app, '/api/auth/login', { password: 'wrong-password' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Wrong password', code: 'bad_password' });
      expect(res.headers['set-cookie']).toBeUndefined();
      await app.close();
    });

    it('returns 409 before setup', async () => {
      const app = await newApp();
      const res = await post(app, '/api/auth/login', { password: TEST_PASSWORD });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('setup_required');
      await app.close();
    });

    it('rejects a password over 1024 characters without hashing it', async () => {
      const app = await newApp();
      await setupOwner(app.db);
      const res = await post(app, '/api/auth/login', { password: 'x'.repeat(1025) });
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it('refuses a cross-site login', async () => {
      const app = await newApp();
      await setupOwner(app.db);
      const res = await post(app, '/api/auth/login', { password: TEST_PASSWORD }, { origin: 'null', host: 'localhost:3000' });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('bad_origin');
      await app.close();
    });

    it('rate limits the 11th failure with Retry-After', async () => {
      const app = await newApp();
      await setupOwner(app.db);
      for (let i = 0; i < 10; i++) {
        expect((await post(app, '/api/auth/login', { password: 'wrong' })).statusCode).toBe(401);
      }
      const res = await post(app, '/api/auth/login', { password: TEST_PASSWORD });
      expect(res.statusCode).toBe(429);
      expect(res.json()).toMatchObject({ code: 'rate_limited', retryAfter: expect.any(Number) });
      expect(Number(res.headers['retry-after'])).toBe(res.json().retryAfter);
      await app.close();
    });

    it('behind a trusted proxy, a client rotating X-Forwarded-For still hits the limit', async () => {
      const app = await newApp({ trustProxy: 1 });
      await setupOwner(app.db);
      let res;
      for (let i = 0; i < 11; i++) {
        // The proxy appends the real client; everything left of it is the client's own claim.
        res = await post(app, '/api/auth/login', { password: 'wrong' }, { ...SAME_ORIGIN, 'x-forwarded-for': `10.9.8.${i}, 198.51.100.7` });
      }
      expect(res!.statusCode).toBe(429);
      await app.close();
    });

    it('resets rate limit on successful login', async () => {
      const app = await newApp();
      await setupOwner(app.db);
      for (let i = 0; i < 5; i++) await post(app, '/api/auth/login', { password: 'wrong' });
      expect((await post(app, '/api/auth/login', { password: TEST_PASSWORD })).statusCode).toBe(200);
      for (let i = 0; i < 5; i++) await post(app, '/api/auth/login', { password: 'wrong' });
      const res = await post(app, '/api/auth/login', { password: 'wrong' });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('purges expired sessions on success', async () => {
      const app = await newApp();
      await authCookie(app.db);
      await app.db.update(sessions).set({ expiresAt: dsql`now() - interval '1 second'` });
      await post(app, '/api/auth/login', { password: TEST_PASSWORD });
      const rows = await app.db.select().from(sessions);
      expect(rows).toHaveLength(1);
      await app.close();
    });
  });

  describe('GET /api/auth/status', () => {
    it('returns setupComplete false and authenticated false when not set up', async () => {
      const app = await newApp();
      const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ setupComplete: false, authenticated: false, redirectKinds: REDIRECT_KINDS });
      await app.close();
    });

    it('returns setupComplete true when owner exists', async () => {
      const app = await newApp();
      await setupOwner(app.db);
      const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
      expect(res.json()).toEqual({ setupComplete: true, authenticated: false, redirectKinds: REDIRECT_KINDS });
      await app.close();
    });

    it('returns authenticated true with valid bearer token, any scheme case', async () => {
      const app = await newApp();
      const { Authorization } = await authHeaders(app.db);
      for (const authorization of [Authorization, Authorization.replace('Bearer', 'bearer')]) {
        const res = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { authorization } });
        expect(res.json()).toEqual({ setupComplete: true, authenticated: true, redirectKinds: REDIRECT_KINDS });
      }
      await app.close();
    });

    it('returns authenticated true with valid session cookie', async () => {
      const app = await newApp();
      const { cookie } = await authCookie(app.db);
      const res = await app.inject({ method: 'GET', url: '/api/auth/status', cookies: { bukmark_session: cookie } });
      expect(res.json()).toEqual({ setupComplete: true, authenticated: true, redirectKinds: REDIRECT_KINDS });
      await app.close();
    });

    it('a wrong bearer does not fall back to the cookie', async () => {
      const app = await newApp();
      const { cookie } = await authCookie(app.db);
      const res = await app.inject({
        method: 'GET', url: '/api/auth/status', headers: { authorization: 'bearer bkm_wrong' }, cookies: { bukmark_session: cookie },
      });
      expect(res.json()).toEqual({ setupComplete: true, authenticated: false, redirectKinds: REDIRECT_KINDS });
      await app.close();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('deletes the session, clears the cookie, and the cookie then gets 401', async () => {
      const app = await newApp();
      const { cookie } = await authCookie(app.db);
      const res = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { bukmark_session: cookie }, headers: SAME_ORIGIN });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(res.headers['set-cookie']).toMatch(/^bukmark_session=; Max-Age=0; Path=\//);
      expect(await app.db.select().from(sessions)).toHaveLength(0);
      const after = await app.inject({ method: 'GET', url: '/api/links', cookies: { bukmark_session: cookie } });
      expect(after.statusCode).toBe(401);
      await app.close();
    });

    it('with a bearer deletes that token, which then gets 401', async () => {
      const app = await newApp();
      const headers = await authHeaders(app.db);
      await createAccessToken(app.db, 'another client');
      const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers });
      expect(res.statusCode).toBe(200);
      const left = await app.db.select({ name: apiTokens.name }).from(apiTokens);
      expect(left).toEqual([{ name: 'another client' }]);
      const after = await app.inject({ method: 'GET', url: '/api/links', headers });
      expect(after.statusCode).toBe(401);
      await app.close();
    });

    it('returns 401 without auth', async () => {
      const app = await newApp();
      await setupOwner(app.db);
      const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
      expect(res.statusCode).toBe(401);
      await app.close();
    });
  });

  describe('requireAuth', () => {
    const PUBLIC = ['GET /api/auth/status', 'POST /api/auth/setup', 'POST /api/auth/login', 'POST /api/auth/token'];

    async function sweep(app: FastifyInstance, code: string) {
      await app.ready();
      const all = app.registeredRoutes.map((r) => `${r.method} ${r.url}`);
      expect(all).toEqual(expect.arrayContaining(PUBLIC));
      const routes = app.registeredRoutes.filter((r) =>
        r.url.startsWith('/api') && r.method !== 'HEAD' && r.method !== 'OPTIONS' && !PUBLIC.includes(`${r.method} ${r.url}`));
      // Sanity: the collector saw the protected routes.
      expect(routes.length).toBeGreaterThanOrEqual(15);
      for (const r of routes) {
        const res = await app.inject({
          method: r.method as InjectOptions['method'],
          url: r.url.replace(/:\w+/g, '00000000-0000-0000-0000-000000000000'),
        });
        expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
        expect(res.json(), `${r.method} ${r.url}`).toEqual({ error: expect.any(String), code });
      }
    }

    it('every /api route except the public four needs setup, then credentials', async () => {
      const app = await newApp();
      await sweep(app, 'setup_required');
      await setupOwner(app.db);
      await sweep(app, 'unauthenticated');
      await app.close();
    });

    it('accepts a bearer with any scheme case', async () => {
      const app = await newApp();
      const { Authorization } = await authHeaders(app.db);
      const res = await app.inject({ method: 'GET', url: '/api/links', headers: { authorization: Authorization.replace('Bearer', 'BEARER') } });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it.each([
      ['a wrong bearer', 'Bearer bkm_wrong'],
      ['a wrong lowercase bearer', 'bearer bkm_wrong'],
      ['an empty bearer', 'Bearer'],
    ])('%s with a valid cookie is 401: no fallback to the cookie', async (_name, authorization) => {
      const app = await newApp();
      const { cookie } = await authCookie(app.db);
      const res = await app.inject({ method: 'GET', url: '/api/links', headers: { authorization }, cookies: { bukmark_session: cookie } });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthenticated');
      await app.close();
    });

    it('a reverse proxy\'s Basic auth header does not hide the session cookie', async () => {
      const app = await newApp();
      const { cookie } = await authCookie(app.db);
      const res = await app.inject({
        method: 'GET', url: '/api/links', headers: { authorization: 'Basic dXNlcjpwYXNz' }, cookies: { bukmark_session: cookie },
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it('accepts a valid session cookie', async () => {
      const app = await newApp();
      const { cookie } = await authCookie(app.db);
      const res = await app.inject({ method: 'GET', url: '/api/links', cookies: { bukmark_session: cookie } });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it('an expired session is 401 and the cookie is cleared', async () => {
      const app = await newApp();
      const { cookie } = await authCookie(app.db);
      await app.db.update(sessions).set({ expiresAt: dsql`now() - interval '1 second'` });
      const res = await app.inject({ method: 'GET', url: '/api/links', cookies: { bukmark_session: cookie } });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthenticated');
      expect(res.headers['set-cookie']).toMatch(/^bukmark_session=; Max-Age=0/);
      await app.close();
    });

    it('renews a session at most once per 24 h', async () => {
      const app = await newApp();
      const { cookie } = await authCookie(app.db);
      await app.db.update(sessions).set({ renewedAt: dsql`now() - interval '25 hours'`, expiresAt: dsql`now() + interval '5 days'` });
      const first = await app.inject({ method: 'GET', url: '/api/links', cookies: { bukmark_session: cookie } });
      expect(first.statusCode).toBe(200);
      expect(first.headers['set-cookie']).toMatch(new RegExp(`^bukmark_session=${cookie}; Max-Age=2592000;`));
      const [row] = await app.db.execute<{ renewed: boolean }>(dsql`
        SELECT expires_at > now() + interval '29 days' AND renewed_at > now() - interval '1 minute' AS renewed FROM sessions`);
      expect(row?.renewed).toBe(true);
      const second = await app.inject({ method: 'GET', url: '/api/links', cookies: { bukmark_session: cookie } });
      expect(second.headers['set-cookie']).toBeUndefined();
      await app.close();
    });

    it.each([
      ['no Origin', {}],
      ['Origin: null', { origin: 'null' }],
      ['an unparseable Origin', { origin: 'garbage' }],
      ['the same hostname on another port', { origin: 'http://localhost:8080', host: 'localhost:3000' }],
    ])('refuses a cookie POST with %s: 403 bad_origin', async (_name, headers) => {
      const app = await newApp();
      const { cookie } = await authCookie(app.db);
      const res = await app.inject({
        method: 'POST', url: '/api/hubs', cookies: { bukmark_session: cookie }, headers, payload: { name: 'x' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Cross-site request refused', code: 'bad_origin' });
      await app.close();
    });

    it('accepts a same-origin cookie POST', async () => {
      const app = await newApp();
      const { cookie } = await authCookie(app.db);
      const res = await app.inject({
        method: 'POST', url: '/api/hubs', cookies: { bukmark_session: cookie }, headers: SAME_ORIGIN, payload: { name: 'x' },
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it('bearer POST without Origin works', async () => {
      const app = await newApp();
      const headers = await authHeaders(app.db);
      const res = await app.inject({ method: 'POST', url: '/api/links', headers, payload: { url: 'http://example.com', title: 'test' } });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it('records last_used_at on bearer use', async () => {
      const app = await newApp();
      const headers = await authHeaders(app.db);
      expect((await app.inject({ method: 'GET', url: '/api/links', headers })).statusCode).toBe(200);
      let lastUsedAt = null;
      // The update is fire-and-forget.
      for (let i = 0; i < 50 && !lastUsedAt; i++) {
        const res = await app.inject({ method: 'GET', url: '/api/auth/tokens', headers });
        lastUsedAt = res.json().items[0].lastUsedAt;
        if (!lastUsedAt) await new Promise((r) => setTimeout(r, 10));
      }
      expect(lastUsedAt).not.toBeNull();
      await app.close();
    });
  });

  describe('POST /api/auth/token', () => {
    it('exchanges a code for a token named after the client', async () => {
      const app = await newApp();
      const { code, verifier } = await mintCode(app, { client_name: 'my browser' });
      const res = await exchange(app, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT_URI });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.token).toMatch(/^bkm_[A-Za-z0-9_-]{43}$/);
      expect(json.name).toBe('my browser');
      const [row] = await app.db.select().from(apiTokens);
      expect(row!.id).toBe(json.tokenId);
      await app.close();
    });

    it.each([
      ['a Firefox add-on', FIREFOX_REDIRECT_URI],
      ['the tab login', TAB_REDIRECT_URI],
    ])('exchanges a code sent to %s for a working token', async (_name, redirectUri) => {
      const app = await newApp();
      const { code, verifier, location } = await mintCode(app, { redirect_uri: redirectUri });
      expect(location.startsWith(`${redirectUri}?`)).toBe(true);
      const res = await exchange(app, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('bukmark capture');
      const links = await app.inject({ method: 'GET', url: '/api/links', headers: { authorization: `Bearer ${res.json().token}` } });
      expect(links.statusCode).toBe(200);
      await app.close();
    });

    it.each([
      ['a tab code', TAB_REDIRECT_URI, FIREFOX_REDIRECT_URI],
      ['a Firefox code', FIREFOX_REDIRECT_URI, REDIRECT_URI],
      ['a Chromium code', REDIRECT_URI, TAB_REDIRECT_URI],
    ])('refuses %s presented with another kind\'s redirect_uri, and burns it', async (_name, mintedFor, presented) => {
      const app = await newApp();
      const { code, verifier } = await mintCode(app, { redirect_uri: mintedFor });
      const wrong = await exchange(app, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: presented });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json()).toEqual(INVALID_GRANT);
      const retry = await exchange(app, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: mintedFor });
      expect(retry.json()).toEqual(INVALID_GRANT);
      await app.close();
    });

    it('matches the RFC 7636 example verifier', async () => {
      const app = await newApp();
      expect(pkceS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
      await app.close();
    });

    it('a code is single-use', async () => {
      const app = await newApp();
      const { code, verifier } = await mintCode(app);
      const body = { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT_URI };
      expect((await exchange(app, body)).statusCode).toBe(200);
      const again = await exchange(app, body);
      expect(again.statusCode).toBe(400);
      expect(again.json()).toEqual(INVALID_GRANT);
      await app.close();
    });

    it('two concurrent exchanges of one code mint exactly one token', async () => {
      const app = await newApp();
      const { code, verifier } = await mintCode(app);
      const body = { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT_URI };
      const results = await Promise.all([exchange(app, body), exchange(app, body), exchange(app, body)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400, 400]);
      expect(await app.db.select().from(apiTokens)).toHaveLength(1);
      await app.close();
    });

    it('answers every failure with the same invalid_grant body', async () => {
      const app = await newApp();
      const cases: [string, (c: { code: string; verifier: string }) => Record<string, unknown>][] = [
        ['wrong verifier', (c) => ({ grant_type: 'authorization_code', code: c.code, code_verifier: randomToken(32), redirect_uri: REDIRECT_URI })],
        ['mismatched redirect_uri', (c) => ({
          grant_type: 'authorization_code', code: c.code, code_verifier: c.verifier,
          redirect_uri: 'https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.chromiumapp.org/bukmark',
        })],
        ['unknown code', (c) => ({ grant_type: 'authorization_code', code: randomToken(32), code_verifier: c.verifier, redirect_uri: REDIRECT_URI })],
        ['short verifier', (c) => ({ grant_type: 'authorization_code', code: c.code, code_verifier: 'abc', redirect_uri: REDIRECT_URI })],
        ['verifier with bad characters', (c) => ({ grant_type: 'authorization_code', code: c.code, code_verifier: `${c.verifier}!`, redirect_uri: REDIRECT_URI })],
        ['missing verifier', (c) => ({ grant_type: 'authorization_code', code: c.code, redirect_uri: REDIRECT_URI })],
        ['wrong grant_type', (c) => ({ grant_type: 'password', code: c.code, code_verifier: c.verifier, redirect_uri: REDIRECT_URI })],
      ];
      for (const [name, body] of cases) {
        const minted = await mintCode(app);
        const res = await exchange(app, body(minted));
        expect(res.statusCode, name).toBe(400);
        expect(res.json(), name).toEqual(INVALID_GRANT);
      }
      await app.close();
    });

    it('rejects an expired code, and a failed PKCE check still burns the code', async () => {
      const app = await newApp();
      const expired = await mintCode(app);
      await app.db.update(authCodes).set({ expiresAt: dsql`now() - interval '1 second'` });
      const res = await exchange(app, { grant_type: 'authorization_code', code: expired.code, code_verifier: expired.verifier, redirect_uri: REDIRECT_URI });
      expect(res.json()).toEqual(INVALID_GRANT);

      const burnt = await mintCode(app);
      await exchange(app, { grant_type: 'authorization_code', code: burnt.code, code_verifier: randomToken(32), redirect_uri: REDIRECT_URI });
      const retry = await exchange(app, { grant_type: 'authorization_code', code: burnt.code, code_verifier: burnt.verifier, redirect_uri: REDIRECT_URI });
      expect(retry.json()).toEqual(INVALID_GRANT);
      await app.close();
    });

    it('rate limits the 31st attempt', async () => {
      const app = await newApp();
      for (let i = 0; i < 30; i++) await exchange(app, {});
      const res = await exchange(app, {});
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
      await app.close();
    });

    it('purges auth codes that expired over an hour ago', async () => {
      const app = await newApp();
      await app.db.insert(authCodes).values({
        codeHash: sha256hex('stale'), codeChallenge: 'c', redirectUri: REDIRECT_URI, clientName: 'old', expiresAt: dsql`now() - interval '2 hours'`,
      });
      await exchange(app, {});
      expect(await app.db.select().from(authCodes)).toHaveLength(0);
      await app.close();
    });
  });

  describe('token management', () => {
    it('lists tokens with the requesting one marked current', async () => {
      const app = await newApp();
      const headers = await authHeaders(app.db);
      const res = await app.inject({ method: 'GET', url: '/api/auth/tokens', headers });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.items).toHaveLength(1);
      expect(json.items[0]).toMatchObject({ name: 'test-token', current: true });
      expect(json.items[0].prefix).toMatch(/^bkm_.{8}$/);
      await app.close();
    });

    it('creates a token and shows its plaintext once', async () => {
      const app = await newApp();
      const headers = await authHeaders(app.db);
      const res = await app.inject({ method: 'POST', url: '/api/auth/tokens', headers, payload: { name: '  my-token  ' } });
      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.token).toMatch(/^bkm_/);
      expect(json.name).toBe('my-token');
      expect(json.prefix).toBe(json.token.slice(0, 12));
      const list = await app.inject({ method: 'GET', url: '/api/auth/tokens', headers });
      expect(list.body).not.toContain(json.token);
      await app.close();
    });

    it('rejects bad name', async () => {
      const app = await newApp();
      const headers = await authHeaders(app.db);
      const res = await app.inject({ method: 'POST', url: '/api/auth/tokens', headers, payload: { name: '' } });
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it('deletes a token, which then gets 401', async () => {
      const app = await newApp();
      const headers = await authHeaders(app.db);
      const other = await createAccessToken(app.db, 'other');
      const res = await app.inject({ method: 'DELETE', url: `/api/auth/tokens/${other.id}`, headers });
      expect(res.statusCode).toBe(200);
      const after = await app.inject({ method: 'GET', url: '/api/links', headers: { authorization: `Bearer ${other.token}` } });
      expect(after.statusCode).toBe(401);
      await app.close();
    });

    it('returns 404 for non-existent token', async () => {
      const app = await newApp();
      const headers = await authHeaders(app.db);
      const res = await app.inject({ method: 'DELETE', url: '/api/auth/tokens/00000000-0000-0000-0000-000000000000', headers });
      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it('401s from these routes keep the error code', async () => {
      const app = await newApp();
      const before = await app.inject({ method: 'GET', url: '/api/auth/tokens' });
      expect(before.json()).toEqual({ error: 'Setup required', code: 'setup_required' });
      await setupOwner(app.db);
      const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: 'Bearer bkm_wrong' } });
      expect(res.json()).toEqual({ error: 'Invalid token', code: 'unauthenticated' });
      await app.close();
    });
  });

  describe('storage and plumbing', () => {
    it('the owner table holds one row by construction', async () => {
      const app = await newApp();
      await expect(app.db.execute(dsql`INSERT INTO owner (id, password_hash) VALUES (2, 'x')`)).rejects.toThrow(/owner_single_row/);
      await app.close();
    });

    it('hashes passwords off the event loop', async () => {
      let ticked = false;
      setImmediate(() => { ticked = true; });
      await hashPassword(TEST_PASSWORD);
      expect(ticked).toBe(true);
    });

    it('verifies passwords and rejects malformed hashes', async () => {
      const stored = await hashPassword(TEST_PASSWORD);
      expect(stored).toMatch(/^scrypt\$15\$8\$1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{88}$/);
      expect(await verifyPassword(TEST_PASSWORD, stored)).toBe(true);
      expect(await verifyPassword('wrong password', stored)).toBe(false);
      expect(await verifyPassword(TEST_PASSWORD, 'not-a-hash')).toBe(false);
      expect(await verifyPassword(TEST_PASSWORD, `${stored}$extra`)).toBe(false);
    });

    it('redacts credentials if a log line ever includes request headers', async () => {
      const lines: string[] = [];
      const logStream = new Writable({ write(chunk, _enc, done) { lines.push(String(chunk)); done(); } });
      const app = await newApp({ logStream });
      app.get('/log-headers', async (req) => {
        req.log.info({ headers: req.headers }, 'headers');
        return {};
      });
      await app.inject({ method: 'GET', url: '/log-headers', headers: { authorization: 'Bearer bkm_secret-token', cookie: 'bukmark_session=secret-session' } });
      const out = lines.join('');
      expect(out).toContain('[Redacted]');
      expect(out).not.toContain('secret-token');
      expect(out).not.toContain('secret-session');
      await app.close();
    });
  });

  describe('resetOwner', () => {
    it('deletes the owner, sessions and pending codes but keeps tokens without --revoke-tokens', async () => {
      const app = await newApp();
      const headers = await authHeaders(app.db);
      await mintCode(app);
      const n = await resetOwner(app.db, { revokeTokens: false });
      expect(n).toEqual({ owner: 1, sessions: 1, authCodes: 1, tokens: 0 });
      expect(await app.db.select().from(owner)).toHaveLength(0);
      expect(await app.db.select().from(authCodes)).toHaveLength(0);
      expect(await app.db.select().from(apiTokens)).toHaveLength(1);
      const status = await app.inject({ method: 'GET', url: '/api/auth/status', headers });
      expect(status.json().setupComplete).toBe(false);
      await app.close();
    });

    it('--revoke-tokens deletes every token even when the owner is already gone', async () => {
      const app = await newApp();
      await authHeaders(app.db);
      await resetOwner(app.db, { revokeTokens: false });
      const n = await resetOwner(app.db, { revokeTokens: true });
      expect(n).toEqual({ owner: 0, sessions: 0, authCodes: 0, tokens: 1 });
      expect(await app.db.select().from(apiTokens)).toHaveLength(0);
      await app.close();
    });

    it('lets the owner set a new password on a running server', async () => {
      const app = await newApp();
      await setupOwner(app.db);
      expect((await post(app, '/api/auth/setup', { password: TEST_PASSWORD })).statusCode).toBe(409);
      await resetOwner(app.db, { revokeTokens: false });
      expect((await post(app, '/api/auth/setup', { password: 'a new password here' })).statusCode).toBe(201);
      await app.close();
    });
  });
});
