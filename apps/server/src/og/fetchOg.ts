import { and, eq, isNull, sql as dsql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { links } from '../db/schema.js';
import { fetchHead } from './fetchHead.js';
import { parseOgImage } from './parseOg.js';

const CONCURRENCY = 8;

async function main(): Promise<void> {
  const all = process.argv.includes('--all');
  const { db, sql } = getDb();
  const where = all
    ? eq(links.status, 'active')
    : and(eq(links.status, 'active'), isNull(links.ogFetchedAt));
  const targets = await db.select({ id: links.id, url: links.url }).from(links).where(where);
  console.log(`og-fetch: ${targets.length} links to process`);

  const queue = [...targets];
  let done = 0;
  let found = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const html = await fetchHead(item.url);
      const image = html ? parseOgImage(html, item.url) : null;
      if (image) found += 1;
      await db
        .update(links)
        .set({ imageUrl: image, ogFetchedAt: dsql`now()` })
        .where(eq(links.id, item.id));
      done += 1;
      if (done % 100 === 0) console.log(`og-fetch: ${done}/${targets.length} (${found} images)`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`og-fetch done: ${done} processed, ${found} images found`);
  await sql.end();
}

if (process.argv[1]?.endsWith('fetchOg.ts')) await main();
