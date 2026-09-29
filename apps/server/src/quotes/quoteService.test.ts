import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql as dsql } from 'drizzle-orm';
import { normalizeUrl } from '@bukmark/shared';
import { getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { captures, deletedHashes, links, quotes } from '../db/schema.js';
import { addLink } from '../links/addLink.js';
import { createQuote, normalizeText, QuoteValidationError } from './quoteService.js';

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';

const TRUNCATE = dsql`TRUNCATE links, captures, hubs, hub_links, deleted_hashes, import_jobs, quotes CASCADE`;

describe('normalizeText', () => {
  it('trims, keeps inner newlines in text, and builds a lowercase collapsed key', () => {
    expect(normalizeText('  Hello   World\n\nAgain  ')).toEqual({
      text: 'Hello   World\n\nAgain',
      textKey: 'hello world again',
    });
  });
  it('rejects empty and over-long text', () => {
    expect(() => normalizeText('   \n ')).toThrow(QuoteValidationError);
    expect(() => normalizeText('x'.repeat(10001))).toThrow(QuoteValidationError);
    expect(normalizeText('x'.repeat(10000)).text).toHaveLength(10000);
  });
});

describe('createQuote', () => {
  const { db, sql } = getDb(TEST_URL);
  const og = vi.fn(async (_u: string) => 'https://img/x.png' as string | null);

  beforeAll(async () => {
    const admin = getDb(TEST_URL.replace(/\/bukmark_test$/, '/bukmark'));
    await admin.sql`CREATE DATABASE bukmark_test`.catch(() => {});
    await admin.sql.end();
    await runMigrations(TEST_URL);
  });
  beforeEach(async () => { og.mockClear(); await db.execute(TRUNCATE); });
  afterAll(async () => { await db.execute(TRUNCATE); await sql.end(); });

  it('creates the link (unsorted, dupe_count 1, capture source quote) and the quote', async () => {
    const r = await createQuote(db, og, { url: 'https://example.com/a?utm_source=x', title: 'A', text: ' Hi there ' });
    expect(r.created).toBe(true);
    expect(r.link.created).toBe(true);
    expect(r.quote).toMatchObject({
      linkId: r.link.id, text: 'Hi there', note: '', sourceTitle: 'A',
    });
    const [l] = await db.select().from(links).where(eq(links.id, r.link.id));
    expect(l!.dupeCount).toBe(1);
    expect(r.quote.sourceUrl).toBe(l!.url);
    const caps = await db.select().from(captures).where(eq(captures.linkId, r.link.id));
    expect(caps.map((c) => c.source)).toEqual(['quote']);
    expect(og).toHaveBeenCalledTimes(1);
  });

  it('attaches to an existing link by url hash without touching it', async () => {
    const norm = normalizeUrl('https://example.com/a');
    if (!norm.ok) throw new Error('bad');
    const first = await addLink(db, { url: norm.url, urlHash: norm.urlHash, title: 'Saved' }, og);
    const [before] = await db.select().from(links).where(eq(links.id, first.link.id));
    og.mockClear();
    const r = await createQuote(db, og, { url: 'https://example.com/a', title: 'Other', text: 'passage' });
    expect(r.link).toEqual({ id: first.link.id, created: false });
    expect(r.created).toBe(true);
    const [after] = await db.select().from(links).where(eq(links.id, first.link.id));
    expect(after).toEqual(before);
    expect(await db.select().from(captures)).toHaveLength(1);
    expect(og).not.toHaveBeenCalled();
  });

  it('attaches by match key when the address is a variant', async () => {
    const norm = normalizeUrl('https://example.com/page');
    if (!norm.ok) throw new Error('bad');
    const first = await addLink(db, { url: norm.url, urlHash: norm.urlHash }, og);
    const r = await createQuote(db, og, { url: 'http://www.example.com/page/', text: 'passage' });
    expect(r.link).toEqual({ id: first.link.id, created: false });
    const [l] = await db.select().from(links).where(eq(links.id, first.link.id));
    expect(l!.dupeCount).toBe(1);
    expect(await db.select().from(links)).toHaveLength(1);
  });

  it('returns the existing quote for the same normalized text, created false', async () => {
    const a = await createQuote(db, og, { url: 'https://example.com/a', text: 'The  Quoted\ntext.' });
    const b = await createQuote(db, og, { url: 'https://example.com/a', text: '  the quoted text. ' });
    expect(b.created).toBe(false);
    expect(b.quote.id).toBe(a.quote.id);
    expect(await db.select().from(quotes)).toHaveLength(1);
  });

  it('resolves a concurrent duplicate to one quote', async () => {
    const input = { url: 'https://example.com/race', text: 'same passage' };
    const rs = await Promise.all([1, 2, 3, 4].map(() => createQuote(db, og, input)));
    expect(new Set(rs.map((r) => r.quote.id)).size).toBe(1);
    expect(rs.filter((r) => r.created)).toHaveLength(1);
    expect(await db.select().from(quotes)).toHaveLength(1);
    expect(rs.filter((r) => r.link.created)).toHaveLength(1);
    const ls = await db.select().from(links);
    expect(ls).toHaveLength(1);
    expect(ls[0]!.dupeCount).toBe(1);
    expect(await db.select().from(captures)).toHaveLength(1);
  });

  it('a racing loser leaves the link untouched (updated_at, title, captures)', async () => {
    const url = 'https://example.com/race2';
    const [first] = await Promise.all([
      createQuote(db, og, { url, title: 'Winner', text: 'one' }),
      createQuote(db, og, { url, title: 'Loser', text: 'two' }),
    ]);
    const [l] = await db.select().from(links).where(eq(links.id, first.link.id));
    // Whoever inserted first owns the title; the other never overwrote it.
    expect(['Winner', 'Loser']).toContain(l!.title);
    expect(l!.dupeCount).toBe(1);
    expect(l!.updatedAt.getTime()).toBe(l!.firstSeen.getTime());
    expect(await db.select().from(captures)).toHaveLength(1);
    expect(await db.select().from(quotes)).toHaveLength(2);
  });

  it('resurrects a tombstoned url like a save', async () => {
    const norm = normalizeUrl('https://example.com/gone');
    if (!norm.ok) throw new Error('bad');
    await db.insert(deletedHashes).values({ urlHash: norm.urlHash });
    const r = await createQuote(db, og, { url: 'https://example.com/gone', text: 'x' });
    expect(r.link.created).toBe(true);
    expect(await db.select().from(deletedHashes)).toHaveLength(0);
  });

  it('rejects bad urls and bad text with a typed error', async () => {
    await expect(createQuote(db, og, { url: 'ftp://x.com/a', text: 'x' })).rejects.toBeInstanceOf(QuoteValidationError);
    await expect(createQuote(db, og, { url: 'nope', text: 'x' })).rejects.toBeInstanceOf(QuoteValidationError);
    await expect(createQuote(db, og, { url: 'https://example.com/a', text: '  ' })).rejects.toBeInstanceOf(QuoteValidationError);
    expect(await db.select().from(links)).toHaveLength(0);
  });
});

describe('addLink capture source', () => {
  const { db, sql } = getDb(TEST_URL);
  beforeAll(async () => { await runMigrations(TEST_URL); });
  beforeEach(async () => { await db.execute(TRUNCATE); });
  afterAll(async () => { await db.execute(TRUNCATE); await sql.end(); });

  it('records manual by default and the given source when passed', async () => {
    const og = async () => null;
    const n1 = normalizeUrl('https://example.com/m'); const n2 = normalizeUrl('https://example.com/q');
    if (!n1.ok || !n2.ok) throw new Error('bad');
    const a = await addLink(db, { url: n1.url, urlHash: n1.urlHash }, og);
    const b = await addLink(db, { url: n2.url, urlHash: n2.urlHash, source: 'quote' }, og);
    const ca = await db.select().from(captures).where(eq(captures.linkId, a.link.id));
    const cb = await db.select().from(captures).where(eq(captures.linkId, b.link.id));
    expect(ca[0]!.source).toBe('manual');
    expect(cb[0]!.source).toBe('quote');
  });
});
