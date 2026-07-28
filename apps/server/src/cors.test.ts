import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { getDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bookmarkt:bookmarkt@localhost:5432/bookmarkt_test';

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

describe('cors', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    await runMigrations(TEST_URL);
    const tempDb = await getDb(TEST_URL);
    await tempDb.db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes CASCADE`);
    await tempDb.sql.end();
    app = await buildApp({
      databaseUrl: TEST_URL,
      fetchOgImage: async () => null,
      corsOrigins: [EXT],
    });
  });
  afterAll(async () => { await app.close(); });

  it('answers preflight for a configured origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/links',
      headers: { origin: EXT, 'access-control-request-method': 'POST' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(EXT);
  });

  it('withholds the allow-origin header from an unconfigured origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/links',
      headers: { origin: 'chrome-extension://evilevilevilevilevilevilevilevil', 'access-control-request-method': 'POST' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('registers no cors at all when the allowlist is empty', async () => {
    const bare = await buildApp({ databaseUrl: TEST_URL, fetchOgImage: async () => null, corsOrigins: [] });
    const res = await bare.inject({
      method: 'OPTIONS',
      url: '/api/links',
      headers: { origin: EXT, 'access-control-request-method': 'POST' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await bare.close();
  });
});
