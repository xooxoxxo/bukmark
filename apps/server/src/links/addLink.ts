import { eq, sql as dsql } from 'drizzle-orm';
import { matchKey } from '@bukmark/shared';
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
  /** Capture source recorded for this save. Defaults to 'manual'. */
  source?: string;
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
  const { url, urlHash, title, note, hub, relevance, source = 'manual' } = input;
  const key = matchKey(url);

  const { outcome, id } = await db.transaction(async (tx) => {
    const tomb = await tx
      .select({ h: deletedHashes.urlHash }).from(deletedHashes)
      .where(eq(deletedHashes.urlHash, urlHash)).limit(1);
    const resurrected = tomb.length > 0;
    if (resurrected) await tx.delete(deletedHashes).where(eq(deletedHashes.urlHash, urlHash));

    const existing = await tx
      .select({ id: links.id }).from(links).where(eq(links.urlHash, urlHash)).limit(1);

    // No exact match: the same page under a variant address (http/https, a
    // trailing slash, the mobile or AMP site) is the link we already have, so
    // update that one rather than adding a second.
    const nearDupe = existing.length === 0
      ? await tx.select({ id: links.id }).from(links).where(eq(links.matchKey, key)).limit(1)
      : [];
    const foundExisting = existing[0] ?? nearDupe[0] ?? null;

    const onSave = {
      status: 'active' as const,
      dupeCount: dsql`${links.dupeCount} + 1`,
      updatedAt: dsql`now()`,
      ...(title !== undefined ? { title } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(relevance !== undefined ? { relevance } : {}),
    };

    let linkId: string;
    if (nearDupe[0]) {
      await tx.update(links).set(onSave).where(eq(links.id, nearDupe[0].id));
      linkId = nearDupe[0].id;
    } else {
      const rows = await tx
        .insert(links)
        .values({
          url, urlHash, matchKey: key, title: title ?? '', note: note ?? '',
          status: 'active', relevance: relevance ?? null, dupeCount: 1,
        })
        .onConflictDoUpdate({ target: links.urlHash, set: onSave })
        .returning({ id: links.id });
      linkId = rows[0]!.id;
    }

    await tx.insert(captures).values({
      linkId, source, originalUrl: url, originalTitle: title ?? '',
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

    const outcome = resurrected ? 'resurrected' : foundExisting ? 'updated' : 'created';
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
