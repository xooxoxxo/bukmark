import { beforeAll, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import { getDb } from './client.js';
import { runMigrations } from './migrate.js';
import { links } from './schema.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bookmarkt:bookmarkt@localhost:5432/bookmarkt_test';

describe('schema', () => {
  beforeAll(async () => {
    const { sql } = getDb(TEST_URL.replace(/\/bookmarkt_test$/, '/bookmarkt'));
    await sql`CREATE DATABASE bookmarkt_test`.catch(() => {});
    await sql.end();
    await runMigrations(TEST_URL);
  });

  it('inserts link, FTS column populated, url_hash unique', async () => {
    const { db, sql } = getDb(TEST_URL);
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, import_jobs CASCADE`);
    try {
      await db.insert(links).values({ url: 'https://a.com/x', urlHash: 'h1', title: 'Alpha Docs' });
      const hit = await db.execute(
        dsql`SELECT id FROM links WHERE search_tsv @@ websearch_to_tsquery('simple','alpha')`,
      );
      expect(hit.length).toBe(1);
      await expect(
        db.insert(links).values({ url: 'https://a.com/x2', urlHash: 'h1' }),
      ).rejects.toThrow();
    } finally {
      await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, import_jobs CASCADE`);
      await sql.end();
    }
  });
});
