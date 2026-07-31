import { and, desc, eq, sql as dsql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { hubLinks, hubs, links } from '../db/schema.js';
import type { ExportLink } from './types.js';

export interface ExportFilters {
  q?: string;
  hub?: string;
  unassigned?: boolean;
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
  const { q, hub, unassigned, status } = filters;

  const conds = [];
  if (status !== 'all') conds.push(eq(links.status, status));
  if (q) conds.push(dsql`search_tsv @@ websearch_to_tsquery('simple', ${q})`);
  if (hub) {
    conds.push(dsql`EXISTS (SELECT 1 FROM hub_links hl WHERE hl.link_id = ${links.id} AND hl.hub_id = ${hub})`);
  }
  if (unassigned) {
    conds.push(dsql`NOT EXISTS (SELECT 1 FROM hub_links hl WHERE hl.link_id = ${links.id})`);
  }

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
