import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { links } from '../db/schema.js';

export const SAVED_PAGE_SIZE = 25;

export async function savedPageCandidates(db: Db, { linkId, q, offset = 0 }: { linkId?: string; q?: string; offset?: number }) {
  const term = q?.trim();
  const pattern = term ? '%' + term.replace(/[\\%_]/g, '\\$&') + '%' : undefined;
  const rows = await db.select({ id: links.id, url: links.url, title: links.title, status: links.status }).from(links)
    .where(and(
      sql`${links.url} like 'https://%'`,
      linkId ? eq(links.id, linkId) : undefined,
      pattern ? or(ilike(links.title, pattern), ilike(links.url, pattern)) : undefined,
    ))
    .orderBy(desc(links.lastSeen), desc(links.id)).limit(SAVED_PAGE_SIZE + 1).offset(offset);
  return { items: rows.slice(0, SAVED_PAGE_SIZE), more: rows.length > SAVED_PAGE_SIZE };
}
