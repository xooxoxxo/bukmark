import { eq, sql as dsql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { captures, deletedHashes, hubLinks, hubs, links } from '../db/schema.js';
import { reactivateHub } from './setLinkHubs.js';

export interface AddLinkInput {
  url: string;
  urlHash: string;
  title?: string;
  note?: string;
  hub?: string;
  relevance?: number;
}

export interface AddLinkResult {
  outcome: 'created' | 'updated' | 'resurrected';
  link: {
    id: string; url: string; title: string; note: string; status: string;
    relevance: number | null; dupeCount: number; hubIds: string[];
    imageUrl: string | null; firstSeen: string;
  };
}

export async function addLink(
  db: Db,
  input: AddLinkInput,
  fetchOgImage: (url: string) => Promise<string | null>,
): Promise<AddLinkResult> {
  const { url, urlHash, title, note, hub, relevance } = input;

  const { outcome, id } = await db.transaction(async (tx) => {
    const tomb = await tx
      .select({ h: deletedHashes.urlHash }).from(deletedHashes)
      .where(eq(deletedHashes.urlHash, urlHash)).limit(1);
    const resurrected = tomb.length > 0;
    if (resurrected) await tx.delete(deletedHashes).where(eq(deletedHashes.urlHash, urlHash));

    const existing = await tx
      .select({ id: links.id }).from(links).where(eq(links.urlHash, urlHash)).limit(1);

    const rows = await tx
      .insert(links)
      .values({
        url, urlHash, title: title ?? '', note: note ?? '',
        status: 'active', relevance: relevance ?? null, dupeCount: 1,
      })
      .onConflictDoUpdate({
        target: links.urlHash,
        set: {
          status: 'active',
          dupeCount: dsql`${links.dupeCount} + 1`,
          updatedAt: dsql`now()`,
          ...(title !== undefined ? { title } : {}),
          ...(note !== undefined ? { note } : {}),
          ...(relevance !== undefined ? { relevance } : {}),
        },
      })
      .returning({ id: links.id });
    const linkId = rows[0]!.id;

    await tx.insert(captures).values({
      linkId, source: 'manual', originalUrl: url, originalTitle: title ?? '',
    });

    if (hub) {
      const hs = await tx
        .insert(hubs).values({ name: hub })
        .onConflictDoUpdate({ target: hubs.name, set: reactivateHub })
        .returning({ id: hubs.id });
      await tx
        .insert(hubLinks)
        .values({ hubId: hs[0]!.id, linkId, relevance: relevance ?? null, assignedBy: 'user' })
        .onConflictDoNothing();
    }

    const outcome = resurrected ? 'resurrected' : existing.length ? 'updated' : 'created';
    return { outcome: outcome as AddLinkResult['outcome'], id: linkId };
  });

  const image = await fetchOgImage(url).catch(() => null);
  await db.update(links).set({ imageUrl: image, ogFetchedAt: dsql`now()` }).where(eq(links.id, id));

  const [row] = await db
    .select({
      id: links.id, url: links.url, title: links.title, note: links.note,
      status: links.status, relevance: links.relevance, dupeCount: links.dupeCount,
      imageUrl: links.imageUrl, firstSeen: links.firstSeen,
    })
    .from(links).where(eq(links.id, id));
  const hubRows = await db.select({ hubId: hubLinks.hubId }).from(hubLinks).where(eq(hubLinks.linkId, id));
  return {
    outcome,
    link: { ...row!, firstSeen: row!.firstSeen.toISOString(), hubIds: hubRows.map((h) => h.hubId) },
  };
}
