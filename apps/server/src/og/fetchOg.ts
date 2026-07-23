import { and, eq, isNull, sql as dsql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { links } from '../db/schema.js';
import { parseOgImage } from './parseOg.js';

const MAX_BYTES = 65536;
const TIMEOUT_MS = 5000;
const CONCURRENCY = 8;
const UA = 'Mozilla/5.0 (compatible; bookmarkt-og/1.0)';

async function fetchHead(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,*/*' },
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
    }
    await reader.cancel().catch(() => undefined);
    return Buffer.concat(chunks).toString('utf8');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
