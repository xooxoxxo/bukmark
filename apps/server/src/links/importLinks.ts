import { and, eq, inArray, isNull, sql as dsql } from 'drizzle-orm';
import { normalizeUrl, matchKey } from '@bukmark/shared';
import type { Db } from '../db/client.js';
import { captures, deletedHashes, links, quotes } from '../db/schema.js';
import { normalizeText } from '../quotes/quoteService.js';

export interface ImportQuote {
  text: string;
  note?: string;
  createdAt?: string;
}

/** A quote whose link is gone; it carries its own source copy. */
export interface ImportOrphanQuote extends ImportQuote {
  sourceUrl: string;
  sourceTitle?: string;
}

export interface ImportItem {
  url: string;
  title?: string;
  folderPath?: string;
  quotes?: ImportQuote[];
}

export interface ImportLinksResult {
  created: number;
  updated: number;
  skippedDeleted: number;
  invalid: { url: string; reason: string }[];
  /** Quotes restored from a bukmark backup; `skipped` are ones already here (or of a link that stayed deleted). */
  quotes: { added: number; skipped: number };
}

/** Rows per INSERT: 8 columns each keeps a statement well under Postgres's 65535 parameter cap. */
const QUOTE_INSERT_CHUNK = 1000;

interface QuoteRow {
  linkId: string | null;
  text: string;
  textKey: string;
  note: string;
  sourceUrl: string;
  sourceTitle: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** The quote's own timestamp when the backup carried a readable one, else the column default. */
function stamp(createdAt: string | undefined): { createdAt?: Date; updatedAt?: Date } {
  if (!createdAt) return {};
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? {} : { createdAt: d, updatedAt: d };
}

/** Insert rows the unique index would accept; returns how many went in. */
async function insertQuotes(tx: Pick<Db, 'insert'>, rows: QuoteRow[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < rows.length; i += QUOTE_INSERT_CHUNK) {
    const done = await tx
      .insert(quotes)
      .values(rows.slice(i, i + QUOTE_INSERT_CHUNK))
      .onConflictDoNothing()
      .returning({ id: quotes.id });
    added += done.length;
  }
  return added;
}

interface Normalized {
  url: string;
  urlHash: string;
  matchKey: string;
  title: string;
  folderPath: string | null;
  quotes: ImportQuote[];
}

/**
 * Bulk create/update from a browser bookmark export.
 *
 * Deliberately different from addLink() in three ways, each of which is a
 * decision rather than an omission:
 *   1. No og:image fetch. Network I/O per item makes a 2000-item import
 *      unusable; Task 3's backfill drains `og_fetched_at IS NULL` instead.
 *   2. dupeCount is never incremented. "Seen in three OneTab exports" is
 *      signal about a link; "listed twice in my bookmark tree" is not.
 *   3. Tombstoned urls are skipped, not resurrected. Re-importing a browser
 *      tree must not undo deletions you made here on purpose.
 */
export async function importLinks(
  db: Db,
  items: ImportItem[],
  source = 'browser-import',
  orphanQuotes: ImportOrphanQuote[] = [],
): Promise<ImportLinksResult> {
  const res: ImportLinksResult = {
    created: 0, updated: 0, skippedDeleted: 0, invalid: [], quotes: { added: 0, skipped: 0 },
  };
  const fromDeleted = await importItems(db, items, source, res);
  const orphans = [...orphanQuotes, ...fromDeleted];
  if (orphans.length > 0) await restoreOrphanQuotes(db, orphans, res);
  return res;
}

/** Orphans have no link to dedupe against, so identity is (source url, text key), checked against existing orphans. */
async function restoreOrphanQuotes(db: Db, orphans: ImportOrphanQuote[], res: ImportLinksResult): Promise<void> {
  const urls = [...new Set(orphans.map((o) => o.sourceUrl))];
  const have = await db
    .select({ url: quotes.sourceUrl, key: quotes.textKey })
    .from(quotes)
    .where(and(isNull(quotes.linkId), inArray(quotes.sourceUrl, urls)));
  const seen = new Set(have.map((r) => `${r.url}\u0000${r.key}`));

  const rows: QuoteRow[] = [];
  for (const o of orphans) {
    let norm: { text: string; textKey: string };
    try {
      norm = normalizeText(o.text);
    } catch {
      res.quotes.skipped += 1;
      continue;
    }
    const id = `${o.sourceUrl}\u0000${norm.textKey}`;
    if (seen.has(id)) {
      res.quotes.skipped += 1;
      continue;
    }
    seen.add(id);
    rows.push({
      linkId: null, text: norm.text, textKey: norm.textKey, note: o.note ?? '',
      sourceUrl: o.sourceUrl, sourceTitle: o.sourceTitle ?? '', ...stamp(o.createdAt),
    });
  }
  res.quotes.added += await db.transaction((tx) => insertQuotes(tx, rows));
}

async function importItems(
  db: Db,
  items: ImportItem[],
  source: string,
  res: ImportLinksResult,
): Promise<ImportOrphanQuote[]> {

  // Normalize first, and key by hash so duplicates inside one batch collapse.
  // Postgres rejects an INSERT ... ON CONFLICT whose VALUES list hits the same
  // conflict target twice ("cannot affect row a second time"), so this dedup is
  // required for correctness, not just tidiness.
  // Variant addresses of one page (http/https, trailing slash, mobile or AMP
  // site) share a match key and are one link, so they collapse here too.
  const byHash = new Map<string, Normalized>();
  const hashOfKey = new Map<string, string>();
  for (const it of items) {
    const n = normalizeUrl(it.url);
    if (!n.ok) {
      res.invalid.push({ url: it.url, reason: `${n.reason} url` });
      res.quotes.skipped += it.quotes?.length ?? 0;
      continue;
    }
    const key = matchKey(n.url);
    // A variant listed twice collapses to one link; its quotes join the survivor's.
    const keeper = hashOfKey.get(key);
    if (keeper !== undefined && !byHash.has(n.urlHash)) {
      byHash.get(keeper)!.quotes.push(...(it.quotes ?? []));
      continue;
    }
    hashOfKey.set(key, n.urlHash);
    const prior = byHash.get(n.urlHash);
    byHash.set(n.urlHash, {
      url: n.url,
      urlHash: n.urlHash,
      matchKey: key,
      title: it.title ?? '',
      folderPath: it.folderPath ?? null,
      quotes: [...(prior?.quotes ?? []), ...(it.quotes ?? [])],
    });
  }
  if (byHash.size === 0) return [];

  const hashes = [...byHash.keys()];

  const tombRows = await db
    .select({ h: deletedHashes.urlHash })
    .from(deletedHashes)
    .where(inArray(deletedHashes.urlHash, hashes));
  const tombs = new Set(tombRows.map((r) => r.h));

  const live = hashes.filter((h) => !tombs.has(h));
  res.skippedDeleted = hashes.length - live.length;
  // The link stays deleted, but its quotes are the user's own words: they come
  // back as quotes with no page (Q3), keeping the address and title they had.
  const fromDeleted: ImportOrphanQuote[] = [];
  for (const h of hashes) {
    if (!tombs.has(h)) continue;
    const n = byHash.get(h)!;
    for (const q of n.quotes) fromDeleted.push({ ...q, sourceUrl: n.url, sourceTitle: n.title });
  }
  if (live.length === 0) return fromDeleted;

  const existingRows = await db
    .select({ h: links.urlHash })
    .from(links)
    .where(inArray(links.urlHash, live));
  const existing = new Set(existingRows.map((r) => r.h));

  // Links already here under a variant address: the import updates those.
  const byKey = new Map<string, string>();
  const unmatched = live.filter((h) => !existing.has(h));
  if (unmatched.length > 0) {
    const keyed = await db
      .select({ id: links.id, key: links.matchKey })
      .from(links)
      .where(inArray(links.matchKey, unmatched.map((h) => byHash.get(h)!.matchKey)));
    for (const r of keyed) if (r.key && !byKey.has(r.key)) byKey.set(r.key, r.id);
  }
  const variantOf = new Map<string, string>(); // urlHash -> existing link id
  for (const h of unmatched) {
    const id = byKey.get(byHash.get(h)!.matchKey);
    if (id) variantOf.set(h, id);
  }
  const toInsert = live.filter((h) => !variantOf.has(h));

  await db.transaction(async (tx) => {
    // Every live link's row after the write, so quotes can attach to it.
    const resolved: { h: string; id: string; url: string; title: string }[] = [];
    for (const [h, id] of variantOf) {
      const n = byHash.get(h)!;
      const [row] = await tx
        .update(links)
        .set({
          title: dsql`CASE WHEN ${links.title} = '' THEN ${n.title} ELSE ${links.title} END`,
          lastSeen: dsql`now()`,
        })
        .where(eq(links.id, id))
        .returning({ url: links.url, title: links.title });
      resolved.push({ h, id, ...row! });
      await tx.insert(captures).values({
        linkId: id, source, originalUrl: n.url, originalTitle: n.title, groupHint: n.folderPath,
      });
    }

    if (toInsert.length > 0) {
      const values = toInsert.map((h) => {
        const n = byHash.get(h)!;
        return { url: n.url, urlHash: n.urlHash, matchKey: n.matchKey, title: n.title, status: 'active' as const };
      });

      const rows = await tx
        .insert(links)
        .values(values)
        .onConflictDoUpdate({
          target: links.urlHash,
          set: {
            // Only fill a title in; never overwrite one you have already curated.
            title: dsql`CASE WHEN ${links.title} = '' THEN excluded.title ELSE ${links.title} END`,
            lastSeen: dsql`now()`,
            // dupeCount and status are intentionally absent — see the docblock.
            // So is updatedAt: the links trigger moves it only when the title is
            // filled in, so re-importing a browser tree does not make every
            // synced browser pull every link again.
          },
        })
        .returning({ id: links.id, urlHash: links.urlHash, url: links.url, title: links.title });

      await tx.insert(captures).values(
        rows.map((r) => {
          const n = byHash.get(r.urlHash)!;
          return {
            linkId: r.id,
            source,
            originalUrl: n.url,
            originalTitle: n.title,
            groupHint: n.folderPath,
          };
        }),
      );
      for (const r of rows) resolved.push({ h: r.urlHash, id: r.id, url: r.url, title: r.title });
    }

    // Quotes ride with their link. The source copy is the link's own address
    // and title, as when a quote is saved from the page; a text already saved
    // on that link (same text key) is skipped, not an error.
    const rows: QuoteRow[] = [];
    for (const { h, id, url, title } of resolved) {
      const seen = new Set<string>();
      for (const q of byHash.get(h)!.quotes) {
        let norm: { text: string; textKey: string };
        try {
          norm = normalizeText(q.text);
        } catch {
          res.quotes.skipped += 1;
          continue;
        }
        if (seen.has(norm.textKey)) {
          res.quotes.skipped += 1;
          continue;
        }
        seen.add(norm.textKey);
        rows.push({
          linkId: id, text: norm.text, textKey: norm.textKey, note: q.note ?? '',
          sourceUrl: url, sourceTitle: title, ...stamp(q.createdAt),
        });
      }
    }
    if (rows.length > 0) {
      const added = await insertQuotes(tx, rows);
      res.quotes.added += added;
      res.quotes.skipped += rows.length - added;
    }
  });

  for (const h of live) {
    if (existing.has(h) || variantOf.has(h)) res.updated += 1;
    else res.created += 1;
  }
  return fromDeleted;
}
