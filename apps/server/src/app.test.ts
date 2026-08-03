import { beforeAll, describe, expect, it } from 'vitest';
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
});
