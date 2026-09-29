import { and, desc, eq, isNull, sql as dsql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { hubLinks, hubs, links, quotes } from '../db/schema.js';
import { isBroken } from '../og/checkLinks.js';
import type { ExportLink, ExportOrphanQuote } from './types.js';

export interface ExportFilters {
  q?: string;
  hub?: string;
  unassigned?: boolean;
  broken?: boolean;
  status: 'active' | 'archived' | 'all';
}

/**
 * Every link matching the filters — no pagination.
 *
 * Mirrors GET /links's filter conditions deliberately, so "export what I am
 * looking at" holds by construction. Three differences, each intentional:
 * no limit; hub NAMES rather than ids (a backup restores into a database where
 * the old ids mean nothing); and status 'all', because a backup that omits
 * archived links is not a backup.
 */
export async function selectForExport(db: Db, filters: ExportFilters): Promise<ExportLink[]> {
  const { q, hub, unassigned, broken, status } = filters;

  const conds = [];
  if (status !== 'all') conds.push(eq(links.status, status));
  if (q) conds.push(dsql`search_tsv @@ websearch_to_tsquery('simple', ${q})`);
  if (hub) {
    conds.push(dsql`EXISTS (SELECT 1 FROM hub_links hl WHERE hl.link_id = ${links.id} AND hl.hub_id = ${hub})`);
  }
  if (unassigned) {
    conds.push(dsql`NOT EXISTS (SELECT 1 FROM hub_links hl WHERE hl.link_id = ${links.id})`);
  }
  if (broken) conds.push(isBroken);

  const rows = await db
    .select({
      url: links.url,
      title: links.title,
      note: links.note,
      status: links.status,
      relevance: links.relevance,
      dupeCount: links.dupeCount,
      imageUrl: links.imageUrl,
      firstSeen: links.firstSeen,
      lastSeen: links.lastSeen,
      groupHint: dsql<string | null>`(
        SELECT c.group_hint FROM captures c
        WHERE c.link_id = ${links.id} AND c.group_hint IS NOT NULL
        ORDER BY c.captured_at DESC LIMIT 1
      )`,
      // ms-precision UTC text, so the value survives a JS Date round trip.
      quotes: dsql<ExportLink['quotes']>`coalesce((
        SELECT json_agg(json_build_object(
          'text', q.text,
          'note', q.note,
          'createdAt', to_char(q.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) ORDER BY q.created_at, q.id)
        FROM quotes q WHERE q.link_id = ${links.id}
      ), '[]'::json)`,
      hubs: dsql<string[]>`coalesce(array_agg(${hubs.name} ORDER BY ${hubs.name}) FILTER (WHERE ${hubs.name} IS NOT NULL), '{}')`,
    })
    .from(links)
    .leftJoin(hubLinks, eq(hubLinks.linkId, links.id))
    .leftJoin(hubs, eq(hubs.id, hubLinks.hubId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(links.id)
    .orderBy(dsql`${links.relevance} DESC NULLS LAST`, desc(links.lastSeen));

  return rows.map((r) => ({
    ...r,
    firstSeen: r.firstSeen.toISOString(),
    lastSeen: r.lastSeen.toISOString(),
  }));
}

/** Quotes whose link is gone (link_id NULL), oldest first. Only a full backup carries them. */
export async function selectOrphanQuotes(db: Db): Promise<ExportOrphanQuote[]> {
  const rows = await db
    .select({
      text: quotes.text,
      note: quotes.note,
      sourceUrl: quotes.sourceUrl,
      sourceTitle: quotes.sourceTitle,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .where(isNull(quotes.linkId))
    .orderBy(quotes.createdAt, quotes.id);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
