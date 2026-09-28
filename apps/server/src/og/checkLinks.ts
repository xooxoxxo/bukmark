import { and, asc, eq, isNull, lt, or, sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { links } from '../db/schema.js';
import { fetchPage, type PageFetch } from './fetchHead.js';
import { pageText } from './pageText.js';
import { parseOgImage } from './parseOg.js';

/** How much of a page a check reads. */
const PAGE_BYTES = 2 * 1024 * 1024;
/** A link is checked again this long after its last check. */
export const RECHECK_DAYS = 30;

export type CheckPage = (url: string) => Promise<PageFetch>;
export const checkPage: CheckPage = (url) => fetchPage(url, PAGE_BYTES);

/**
 * Gone for good, as far as can be told: the page says so (404, 410) or its
 * domain no longer exists. A 403, a 5xx or a timeout is not enough — sites
 * turn away bots, and servers have bad days.
 */
export const isBroken = dsql`(${links.httpStatus} IN (404, 410) OR ${links.checkError} = 'dns')`;

const due = or(isNull(links.checkedAt), lt(links.checkedAt, dsql`now() - make_interval(days => ${RECHECK_DAYS})`));

export interface CheckResult {
  processed: number;
  /** Links still waiting for a first check or a re-check. */
  remaining: number;
}

/**
 * Checks the links most in need of it, never-checked first: records each
 * page's status, keeps its readable text (searched, and a copy that outlives
 * the page), and fills in a missing og:image on the way. A page that fails
 * keeps the text an earlier check saved.
 */
export async function checkLinks(db: Db, check: CheckPage, limit: number, concurrency = 4): Promise<CheckResult> {
  const batch = await db
    .select({ id: links.id, url: links.url, imageUrl: links.imageUrl })
    .from(links)
    .where(and(eq(links.status, 'active'), due))
    .orderBy(dsql`${links.checkedAt} ASC NULLS FIRST`, asc(links.firstSeen))
    .limit(limit);

  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const item = batch[next++];
      if (!item) return;
      const page = await check(item.url).catch((): PageFetch => ({ status: null, error: 'network', html: null, url: item.url }));
      const text = page.html ? pageText(page.html) : null;
      const image = item.imageUrl ?? (page.html ? parseOgImage(page.html, page.url || item.url) : null);
      await db
        .update(links)
        .set({
          httpStatus: page.status,
          checkError: page.error,
          checkedAt: dsql`now()`,
          ...(text !== null ? { contentText: text } : {}),
          imageUrl: image,
          ogFetchedAt: dsql`coalesce(${links.ogFetchedAt}, now())`,
        })
        .where(eq(links.id, item.id));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, () => worker()));

  const [rem] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(links)
    .where(and(eq(links.status, 'active'), due));
  return { processed: batch.length, remaining: rem?.n ?? 0 };
}

/**
 * Keeps checking in the background: a small batch every interval, one batch
 * at a time. New saves are searchable within about a minute, and a library of
 * thousands is worked through without a burst of requests.
 */
export function startPageChecks(app: FastifyInstance, check: CheckPage, { intervalMs = 60_000, batch = 20 } = {}): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await checkLinks(app.db, check, batch);
    } catch (err) {
      app.log.warn({ err }, 'page check failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  app.addHook('onClose', async () => { clearInterval(timer); });
}
