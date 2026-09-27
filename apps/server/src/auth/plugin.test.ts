import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { runMigrations } from '../db/migrate.js';
import { authHeaders } from '../test/auth.js';

vi.mock('./tokens.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tokens.js')>()),
  touchLastUsed: vi.fn().mockRejectedValue(new Error('connection reset')),
}));

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';

describe('requireAuth last_used_at update', () => {
  beforeAll(async () => {
    await runMigrations(TEST_URL);
  });

  afterAll(async () => {
    const app = await buildApp({ databaseUrl: TEST_URL });
    await app.db.execute(dsql`TRUNCATE owner, sessions, api_tokens, auth_codes`);
    await app.close();
  });

  it('logs a failed update instead of crashing the process', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    const lines: string[] = [];
    const logStream = new Writable({ write(chunk, _enc, done) { lines.push(String(chunk)); done(); } });
    const app = await buildApp({ databaseUrl: TEST_URL, logStream });
    try {
      await app.db.execute(dsql`TRUNCATE owner, sessions, api_tokens, auth_codes`);
      const headers = await authHeaders(app.db);
      const res = await app.inject({ method: 'GET', url: '/api/links', headers });
      expect(res.statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
      expect(lines.join('')).toContain('last_used_at update failed');
    } finally {
      process.off('unhandledRejection', onUnhandled);
      await app.close();
    }
  });
});
