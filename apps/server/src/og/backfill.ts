import { asc, eq, isNull, sql as dsql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { links } from '../db/schema.js';

export interface BackfillResult {
  processed: number;
  remaining: number;
}

/**
 * Fetch og:image for links that have never been tried.
 *
 * `og_fetched_at IS NULL` is the queue. Because the timestamp is written even
 * when the fetch fails, a permanently unreachable page is attempted once and
 * then leaves the queue — otherwise the caller's drain loop would never reach
 * remaining: 0 and would spin forever on the same dead links.
 */
export async function backfillOg(
  db: Db,
  fetchOgImage: (url: string) => Promise<string | null>,
  limit: number,
  concurrency = 4,
): Promise<BackfillResult> {
  const batch = await db
    .select({ id: links.id, url: links.url })
    .from(links)
    .where(isNull(links.ogFetchedAt))
    .orderBy(asc(links.firstSeen))
    .limit(limit);

  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const item = batch[next++];
      if (!item) return;
      const image = await fetchOgImage(item.url).catch(() => null);
      await db
        .update(links)
        .set({ imageUrl: image, ogFetchedAt: dsql`now()` })
        .where(eq(links.id, item.id));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, batch.length) }, () => worker()),
  );

  const [rem] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(links)
    .where(isNull(links.ogFetchedAt));

  return { processed: batch.length, remaining: rem?.n ?? 0 };
}
