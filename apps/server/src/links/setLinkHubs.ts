import { and, eq, inArray, ne, notInArray, sql as dsql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { hubLinks, hubs } from '../db/schema.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The upsert that files a link into a hub by name: creates the hub if there is
 * none, and makes an archived one active again, since a link was just filed
 * into it. Without that, a link saved into an archived hub would be in no
 * folder that sync shows, and the browser would move it to Unsorted.
 */
export const reactivateHub = {
  status: dsql`CASE WHEN ${hubs.status} = 'archived' THEN 'active' ELSE ${hubs.status} END`,
  updatedAt: dsql`now()`,
};

/**
 * Makes the named hubs the ones a link is in — what sync sends when a bookmark
 * moves between hub folders. Names, because a folder has nothing else.
 *
 * Archived hubs the link is in are kept unless named: they are not folders, so
 * the browser never saw them, and leaving one out is not a request to remove it.
 */
export async function setLinkHubs(tx: Db | Tx, linkId: string, names: string[]): Promise<void> {
  const wanted = [...new Set(names)];
  const ids = wanted.length === 0
    ? []
    : (await tx
        .insert(hubs)
        .values(wanted.map((name) => ({ name })))
        .onConflictDoUpdate({ target: hubs.name, set: reactivateHub })
        .returning({ id: hubs.id })).map((h) => h.id);

  const live = tx.select({ id: hubs.id }).from(hubs).where(ne(hubs.status, 'archived'));
  await tx.delete(hubLinks).where(and(
    eq(hubLinks.linkId, linkId),
    inArray(hubLinks.hubId, live),
    ...(ids.length > 0 ? [notInArray(hubLinks.hubId, ids)] : []),
  ));
  if (ids.length > 0) {
    await tx
      .insert(hubLinks)
      .values(ids.map((hubId) => ({ hubId, linkId, assignedBy: 'user' as const })))
      .onConflictDoNothing();
  }
}
