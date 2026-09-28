import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';

describe('app', () => {
  beforeAll(async () => {
    await runMigrations(TEST_URL);
  });

  it('healthz responds', async () => {
    const app = await buildApp({ databaseUrl: TEST_URL });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  describe('web app pages', () => {
    const INDEX = '<!doctype html><title>bukmark</title>';
    let webDist: string;
    let app: FastifyInstance;
    beforeAll(async () => {
      webDist = mkdtempSync(join(tmpdir(), 'bukmark-web-'));
      writeFileSync(join(webDist, 'index.html'), INDEX);
      app = await buildApp({ databaseUrl: TEST_URL, webDist });
    });
    afterAll(async () => {
      await app?.close();
      rmSync(webDist, { recursive: true, force: true });
    });

    // A same-site page gets the Lax session cookie inside a frame, so a framable
    // /save could be laid under a decoy and its Save button clickjacked.
    it.each([
      ['the static route', '/'],
      ['the SPA fallback', '/save?url=https://evil.example/&title=Invoice'],
    ])('refuses to be framed when served by %s', async (_name, url) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(INDEX);
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    });
  });
});
