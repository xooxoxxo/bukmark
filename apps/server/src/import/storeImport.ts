import { eq, sql as dsql } from 'drizzle-orm';
import type { Store } from '@bookmarkt/shared';
import type { Db } from '../db/client.js';
import { captures, deletedHashes, hubLinks, hubs, links } from '../db/schema.js';

export interface ImportResult {
  links: number; captures: number; hubs: number; memberships: number; skipped: number;
}

export async function importStore(db: Db, store: Store): Promise<ImportResult> {
  const res: ImportResult = { links: 0, captures: 0, hubs: 0, memberships: 0, skipped: 0 };
  const tombstoneRows = await db.select({ urlHash: deletedHashes.urlHash }).from(deletedHashes);
  const tombstones = new Set(tombstoneRows.map((r) => r.urlHash));
  const hubIds = new Map<string, string>();

  async function hubIdFor(name: string): Promise<string> {
    const cached = hubIds.get(name);
    if (cached) return cached;
    const hs = await db
      .insert(hubs)
      .values({ name })
      .onConflictDoUpdate({ target: hubs.name, set: { updatedAt: dsql`now()` } })
      .returning({ id: hubs.id });
    const h = hs[0];
    if (!h) throw new Error(`Failed to insert hub ${name}`);
    hubIds.set(name, h.id);
    res.hubs += 1;
    return h.id;
  }

  for (const [urlHash, l] of Object.entries(store.links)) {
    if (tombstones.has(urlHash)) {
      res.skipped += 1;
      continue;
    }
    await db.transaction(async (tx) => {
      const tossed = l.triage !== undefined && !l.triage.keep;
      const status = l.junk || tossed ? ('archived' as const) : ('active' as const);
      const note = l.triage
        ? l.triage.reason ? `${l.triage.explanation}; ${l.triage.reason}` : l.triage.explanation
        : '';
      const rows = await tx
        .insert(links)
        .values({
          url: l.url, urlHash, title: l.title, note, status,
          junkRule: l.junk?.rule ?? null,
          relevance: l.triage?.relevance ?? null,
          dupeCount: l.dupeCount,
          firstSeen: new Date(l.firstSeen), lastSeen: new Date(l.lastSeen),
        })
        .onConflictDoUpdate({
          target: links.urlHash,
          set: {
            note, status, title: l.title, junkRule: l.junk?.rule ?? null,
            relevance: l.triage?.relevance ?? null, dupeCount: l.dupeCount, updatedAt: dsql`now()`,
          },
        })
        .returning({ id: links.id });
      const row = rows[0];
      if (!row || !row.id) throw new Error(`Failed to insert link ${urlHash}, got: ${JSON.stringify(row)}`);
      const linkId = row.id;
      res.links += 1;

      await tx.delete(captures).where(eq(captures.linkId, linkId));
      for (const source of l.sources) {
        const captureValues = {
          linkId, source, originalUrl: l.url, originalTitle: l.title,
          groupHint: l.groupHints[0] ?? null,
          raw: { dupeCount: l.dupeCount, groupHints: l.groupHints },
          capturedAt: new Date(l.firstSeen),
        };
        await tx.insert(captures).values(captureValues);
        res.captures += 1;
      }

      if (l.triage?.keep && !l.junk) {
        const hubId = await hubIdFor(l.triage.category);
        await tx
          .insert(hubLinks)
          .values({ hubId, linkId, relevance: l.triage.relevance, assignedBy: 'auto' })
          .onConflictDoNothing();
        res.memberships += 1;
      }
    });
  }
  return res;
}
