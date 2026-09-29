import { matchKey } from '@bukmark/shared';
import { eq, isNull } from 'drizzle-orm';
import type { Db } from './client.js';
import { links } from './schema.js';

/**
 * Backfill match_key for all links that don't have one yet.
 * Idempotent: only updates rows where match_key IS NULL.
 * Batches to avoid memory issues on large tables.
 */
export async function backfillMatchKey(db: Db, batchSize = 500): Promise<{ updated: number }> {
  let total = 0;

  while (true) {
    const batch = await db
      .select({ id: links.id, url: links.url })
      .from(links)
      .where(isNull(links.matchKey))
      .limit(batchSize);

    if (batch.length === 0) break;

    const updates = batch.map((row) => ({
      id: row.id,
      key: matchKey(row.url),
    }));

    // Update in transaction to ensure consistency
    await db.transaction(async (tx) => {
      for (const { id, key } of updates) {
        await tx
          .update(links)
          .set({ matchKey: key })
          .where(eq(links.id, id));
      }
    });

    total += batch.length;
  }

  return { updated: total };
}
