import { inArray, sql as dsql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { hubLinks, hubs, links } from '../db/schema.js';

export interface Assignment {
  linkId: string;
  hub: string;
  relevance?: number;
}

export interface AssignResult {
  assigned: number;
  hubsCreated: string[];
  unknownLinkIds: string[];
}

/**
 * Assign many links to many hubs in one call, addressing hubs by NAME.
 *
 * Names rather than UUIDs because the caller is Claude via MCP: it should be
 * able to say "put this in rust" without a round trip to look up or create the
 * hub first. assignedBy is 'auto' so sorting done by Claude stays
 * distinguishable from filing you did by hand.
 */
export async function assignHubs(db: Db, assignments: Assignment[]): Promise<AssignResult> {
  const res: AssignResult = { assigned: 0, hubsCreated: [], unknownLinkIds: [] };
  if (assignments.length === 0) return res;

  const requestedIds = [...new Set(assignments.map((a) => a.linkId))];
  const found = await db
    .select({ id: links.id })
    .from(links)
    .where(inArray(links.id, requestedIds));
  const known = new Set(found.map((r) => r.id));
  res.unknownLinkIds = requestedIds.filter((id) => !known.has(id));

  const valid = assignments.filter((a) => known.has(a.linkId));
  if (valid.length === 0) return res;

  const names = [...new Set(valid.map((a) => a.hub))];
  const before = await db
    .select({ id: hubs.id, name: hubs.name })
    .from(hubs)
    .where(inArray(hubs.name, names));
  const existing = new Map(before.map((h) => [h.name, h.id]));
  res.hubsCreated = names.filter((n) => !existing.has(n));

  await db.transaction(async (tx) => {
    if (res.hubsCreated.length > 0) {
      const created = await tx
        .insert(hubs)
        .values(res.hubsCreated.map((name) => ({ name })))
        .onConflictDoUpdate({ target: hubs.name, set: { updatedAt: dsql`now()` } })
        .returning({ id: hubs.id, name: hubs.name });
      for (const h of created) existing.set(h.name, h.id);
    }

    // Dedup on (hubId, linkId) — that pair is the primary key, and Postgres
    // rejects an upsert whose VALUES hit the same conflict target twice.
    const rows = new Map<string, { hubId: string; linkId: string; relevance: number | null }>();
    for (const a of valid) {
      const hubId = existing.get(a.hub)!;
      rows.set(`${hubId}:${a.linkId}`, {
        hubId,
        linkId: a.linkId,
        relevance: a.relevance ?? null,
      });
    }

    await tx
      .insert(hubLinks)
      .values([...rows.values()].map((r) => ({ ...r, assignedBy: 'auto' as const })))
      .onConflictDoUpdate({
        target: [hubLinks.hubId, hubLinks.linkId],
        set: { relevance: dsql`excluded.relevance` },
      });
    res.assigned = rows.size;
  });

  return res;
}
