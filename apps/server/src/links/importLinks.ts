import { inArray, sql as dsql } from 'drizzle-orm';
import { normalizeUrl } from '@bookmarkt/shared';
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
  const byHash = new Map<string, Normalized>();
  for (const it of items) {
    const n = normalizeUrl(it.url);
    if (!n.ok) {
      res.invalid.push({ url: it.url, reason: `${n.reason} url` });
      continue;
    }
    byHash.set(n.urlHash, {
      url: n.url,
      urlHash: n.urlHash,
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

  await db.transaction(async (tx) => {
    const values = live.map((h) => {
      const n = byHash.get(h)!;
      return { url: n.url, urlHash: n.urlHash, title: n.title, status: 'active' as const };
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
          updatedAt: dsql`now()`,
          // dupeCount and status are intentionally absent — see the docblock.
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
    if (existing.has(h)) res.updated += 1;
    else res.created += 1;
  }
  return res;
}
