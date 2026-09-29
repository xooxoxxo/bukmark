import { eq, inArray, sql as dsql } from 'drizzle-orm';
import { normalizeUrl, matchKey } from '@bukmark/shared';
import type { Db } from '../db/client.js';
import { captures, deletedHashes, links } from '../db/schema.js';

export interface ImportItem {
  url: string;
  title?: string;
  folderPath?: string;
}

export interface ImportLinksResult {
  created: number;
  updated: number;
  skippedDeleted: number;
  invalid: { url: string; reason: string }[];
}

interface Normalized {
  url: string;
  urlHash: string;
  matchKey: string;
  title: string;
  folderPath: string | null;
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
): Promise<ImportLinksResult> {
  const res: ImportLinksResult = { created: 0, updated: 0, skippedDeleted: 0, invalid: [] };

  // Normalize first, and key by hash so duplicates inside one batch collapse.
  // Postgres rejects an INSERT ... ON CONFLICT whose VALUES list hits the same
  // conflict target twice ("cannot affect row a second time"), so this dedup is
  // required for correctness, not just tidiness.
  // Variant addresses of one page (http/https, trailing slash, mobile or AMP
  // site) share a match key and are one link, so they collapse here too.
  const byHash = new Map<string, Normalized>();
  const seenKeys = new Set<string>();
  for (const it of items) {
    const n = normalizeUrl(it.url);
    if (!n.ok) {
      res.invalid.push({ url: it.url, reason: `${n.reason} url` });
      continue;
    }
    const key = matchKey(n.url);
    if (seenKeys.has(key) && !byHash.has(n.urlHash)) continue;
    seenKeys.add(key);
    byHash.set(n.urlHash, {
      url: n.url,
      urlHash: n.urlHash,
      matchKey: key,
      title: it.title ?? '',
      folderPath: it.folderPath ?? null,
    });
  }
  if (byHash.size === 0) return res;

  const hashes = [...byHash.keys()];

  const tombRows = await db
    .select({ h: deletedHashes.urlHash })
    .from(deletedHashes)
    .where(inArray(deletedHashes.urlHash, hashes));
  const tombs = new Set(tombRows.map((r) => r.h));

  const live = hashes.filter((h) => !tombs.has(h));
  res.skippedDeleted = hashes.length - live.length;
  if (live.length === 0) return res;

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
    for (const [h, id] of variantOf) {
      const n = byHash.get(h)!;
      await tx
        .update(links)
        .set({
          title: dsql`CASE WHEN ${links.title} = '' THEN ${n.title} ELSE ${links.title} END`,
          lastSeen: dsql`now()`,
        })
        .where(eq(links.id, id));
      await tx.insert(captures).values({
        linkId: id, source, originalUrl: n.url, originalTitle: n.title, groupHint: n.folderPath,
      });
    }
    if (toInsert.length === 0) return;

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
      .returning({ id: links.id, urlHash: links.urlHash });

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
  });

  for (const h of live) {
    if (existing.has(h) || variantOf.has(h)) res.updated += 1;
    else res.created += 1;
  }
  return res;
}
