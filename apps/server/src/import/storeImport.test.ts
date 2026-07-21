import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import type { Store } from '@bookmarkt/shared';
import { getDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { importStore } from './storeImport.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bookmarkt:bookmarkt@localhost:5432/bookmarkt_import_test';

const T = '2026-07-21T10:00:00Z';
function makeStore(): { store: Store } {
  const store: Store = { version: 1, links: {}, ingestedFiles: {} };
  store.links['h1'] = {
    url: 'https://a.com/1', title: 'Alpha', sources: ['onetab_import', 'chrome_import'],
    dupeCount: 3, groupHints: ['g'], firstSeen: T, lastSeen: T,
    triage: { category: 'homelab', keep: true, relevance: 5, explanation: 'core tool', triagedAt: T },
  };
  store.links['h2'] = {
    url: 'https://a.com/2', title: 'Tossed', sources: ['onetab_import'],
    dupeCount: 1, groupHints: [], firstSeen: T, lastSeen: T,
    triage: { category: 'reading', keep: false, relevance: 1, explanation: 'old', reason: 'stale', triagedAt: T },
  };
  store.links['h3'] = {
    url: 'https://mail.google.com/x', title: 'Gmail', sources: ['onetab_import'],
    dupeCount: 1, groupHints: [], firstSeen: T, lastSeen: T, junk: { rule: 'gmail' },
  };
  store.links['h4'] = {
    url: 'https://a.com/4', title: 'Pending', sources: ['manual'],
    dupeCount: 1, groupHints: [], firstSeen: T, lastSeen: T,
  };
  return { store };
}

describe('importStore', () => {
  beforeAll(async () => {
    const { sql: adminSql } = getDb(TEST_URL.replace(/\/bookmarkt_import_test$/, '/bookmarkt'));
    await adminSql`CREATE DATABASE bookmarkt_import_test`.catch(() => {});
    await adminSql.end();
    await runMigrations(TEST_URL);
  });

  it('imports full store with correct mapping', async () => {
    const { db, sql } = getDb(TEST_URL);
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, import_jobs CASCADE`);
    const { store } = makeStore();
    const r = await importStore(db, store);
    expect(r).toEqual({ links: 4, captures: 5, hubs: 1, memberships: 1, skipped: 0 });
    const rows = await db.execute(dsql`SELECT url_hash, status, junk_rule, note, relevance FROM links ORDER BY url_hash`);
    expect(rows.map((r) => [r.url_hash, r.status])).toEqual([
      ['h1', 'active'], ['h2', 'archived'], ['h3', 'archived'], ['h4', 'active'],
    ]);
    expect(rows[1]!.note).toBe('old; stale');
    expect(rows[2]!.junk_rule).toBe('gmail');
    expect(rows[0]!.relevance).toBe(5);
    const mem = await db.execute(dsql`SELECT relevance, assigned_by FROM hub_links`);
    expect(mem).toEqual([{ relevance: 5, assigned_by: 'auto' }]);
    await sql.end();
  });

  it('re-import is idempotent', async () => {
    const { db, sql } = getDb(TEST_URL);
    await db.execute(dsql`TRUNCATE links, captures, hubs, hub_links, import_jobs CASCADE`);
    const { store } = makeStore();
    await importStore(db, store);
    const r2 = await importStore(db, store);
    expect(r2.links).toBe(4);
    const count = await db.execute(dsql`SELECT count(*)::int AS n FROM captures`);
    expect(count[0]!.n).toBe(5);
    await sql.end();
  });
});
