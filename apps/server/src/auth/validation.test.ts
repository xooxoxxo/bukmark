import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { runMigrations } from '../db/migrate.js';
import { owner } from '../db/schema.js';
import { SAME_ORIGIN, authCookie, authHeaders } from '../test/auth.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';

const TRUNCATE = dsql`TRUNCATE links, captures, hubs, hub_links, owner, sessions, api_tokens, auth_codes CASCADE`;

// Each emoji is one code point but two UTF-16 units.
const EMOJI = '🔖';

describe('auth input validation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await runMigrations(TEST_URL);
  });

  beforeEach(async () => {
    app = await buildApp({ databaseUrl: TEST_URL });
    await app.db.execute(TRUNCATE);
    return async () => { await app.close(); };
  });

  afterAll(async () => {
    const cleanup = await buildApp({ databaseUrl: TEST_URL });
    await cleanup.db.execute(TRUNCATE);
    await cleanup.close();
  });

  const setup = (password: unknown) =>
    app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password }, headers: SAME_ORIGIN });
  const login = (password: string) =>
    app.inject({ method: 'POST', url: '/api/auth/login', payload: { password }, headers: SAME_ORIGIN });

  describe('password length is counted the same way at setup and login', () => {
    it('accepts 12 emoji at setup (12 characters, 24 UTF-16 units)', async () => {
      expect((await setup(EMOJI.repeat(12))).statusCode).toBe(201);
    });

    it('lets a maximum-length emoji password log in after setup accepted it', async () => {
      const password = EMOJI.repeat(1024);
      expect((await setup(password)).statusCode).toBe(201);
      expect((await login(password)).statusCode).toBe(200);
    });

    it('rejects 11 emoji at setup even though that is 22 UTF-16 units', async () => {
      expect((await setup(EMOJI.repeat(11))).statusCode).toBe(400);
    });

    it('rejects 1025 characters at setup', async () => {
      expect((await setup('a'.repeat(1025))).statusCode).toBe(400);
    });
  });

  describe('setup errors carry a sentence and a code', () => {
    it.each([
      ['too short', 'short'],
      ['too long', 'a'.repeat(1025)],
      ['not a string', 12345],
      ['missing', undefined],
    ])('password %s -> 400 invalid_password with a readable message', async (_name, password) => {
      const res = await setup(password);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Password must be 12 to 1024 characters.', code: 'invalid_password' });
    });

    it('checks the origin before validating the body', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/setup', payload: { password: 'short' },
        headers: { origin: 'http://evil.example', host: 'localhost:3000' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('token names are trimmed before the length check', () => {
    const create = async (name: unknown) => {
      const { cookie } = await authCookie(app.db);
      return app.inject({
        method: 'POST', url: '/api/auth/tokens', payload: { name },
        headers: { ...SAME_ORIGIN, cookie: `bukmark_session=${cookie}` },
      });
    };

    it('accepts 100 characters with surrounding whitespace, storing the trimmed name', async () => {
      const res = await create(`  ${'n'.repeat(100)}  `);
      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe('n'.repeat(100));
    });

    it.each([
      ['101 characters', 'n'.repeat(101)],
      ['only whitespace', '   '],
      ['empty', ''],
      // A number would be coerced to a string by Fastify's validator; an object is not.
      ['an object', { x: 1 }],
    ])('rejects a name that is %s -> 400 invalid_name', async (_name, name) => {
      const res = await create(name);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Token name must be 1 to 100 characters.', code: 'invalid_name' });
    });
  });

  describe('an owner deleted while the server runs (reset script)', () => {
    it('answers setup_required immediately, without a restart, even for a kept token', async () => {
      const headers = await authHeaders(app.db);
      expect((await app.inject({ method: 'GET', url: '/api/links', headers })).statusCode).toBe(200);

      await app.db.delete(owner);

      const res = await app.inject({ method: 'GET', url: '/api/links', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('setup_required');
      const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
      expect(status.json().setupComplete).toBe(false);
    });

    it('lets a kept token work again once a new password is set', async () => {
      const headers = await authHeaders(app.db);
      await app.db.delete(owner);
      expect((await setup('a brand new password')).statusCode).toBe(201);
      expect((await app.inject({ method: 'GET', url: '/api/links', headers })).statusCode).toBe(200);
    });
  });
});
