import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql as dsql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { links, quotes } from '../db/schema.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';

describe('quotes schema', () => {
  const { db, sql } = getDb(TEST_URL);

  beforeAll(async () => {
    const admin = getDb(TEST_URL.replace(/\/bukmark_test$/, '/bukmark'));
    await admin.sql`CREATE DATABASE bukmark_test`.catch(() => {});
    await admin.sql.end();
    await runMigrations(TEST_URL);
  });
  beforeEach(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, owner, sessions, api_tokens, auth_codes, quotes CASCADE`);
  });
  afterAll(async () => {
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, owner, sessions, api_tokens, auth_codes, quotes CASCADE`);
    await sql.end();
  });

  async function makeLink() {
    const [l] = await db.insert(links).values({ url: 'https://a.com/x', urlHash: 'h1', title: 'A' }).returning();
    return l!;
  }

  it('inserts a quote with a link and fills search_tsv', async () => {
    const link = await makeLink();
    await db.insert(quotes).values({
      linkId: link.id, text: 'Whales are mammals', textKey: 'whales are mammals',
      note: 'ocean', sourceUrl: 'https://a.com/x', sourceTitle: 'A',
    });
    const hit = await db.execute(
      dsql`SELECT id FROM quotes WHERE search_tsv @@ websearch_to_tsquery('simple','whales')`,
    );
    expect(hit.length).toBe(1);
    const noteHit = await db.execute(
      dsql`SELECT id FROM quotes WHERE search_tsv @@ websearch_to_tsquery('simple','ocean')`,
    );
    expect(noteHit.length).toBe(1);
  });

  it('deleting the link nulls link_id and keeps the source copy', async () => {
    const link = await makeLink();
    const [q] = await db.insert(quotes).values({
      linkId: link.id, text: 'Keep me', textKey: 'keep me',
      sourceUrl: 'https://a.com/x', sourceTitle: 'A',
    }).returning();
    await db.delete(links).where(eq(links.id, link.id));
    const [after] = await db.select().from(quotes).where(eq(quotes.id, q!.id));
    expect(after!.linkId).toBeNull();
    expect(after!.text).toBe('Keep me');
    expect(after!.sourceUrl).toBe('https://a.com/x');
    expect(after!.sourceTitle).toBe('A');
  });

  it('rejects the same text_key twice for one link', async () => {
    const link = await makeLink();
    const row = { linkId: link.id, text: 'Dup', textKey: 'dup', sourceUrl: 'https://a.com/x' };
    await db.insert(quotes).values(row);
    await expect(db.insert(quotes).values(row)).rejects.toThrow();
  });

  it('allows the same text_key twice when link_id is null', async () => {
    const row = { linkId: null, text: 'Orphan', textKey: 'orphan', sourceUrl: 'https://a.com/x' };
    await db.insert(quotes).values(row);
    await db.insert(quotes).values(row);
    const rows = await db.select().from(quotes);
    expect(rows.length).toBe(2);
  });
});
