import { Type } from '@sinclair/typebox';
import { asc, eq, inArray, sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { captures, deletedHashes, hubLinks, links } from '../db/schema.js';

export interface LinkWithHubs {
  id: string;
  url: string;
  title: string;
  note: string;
  status: string;
  firstSeen: Date;
  createdAt: Date;
  dupeCount: number;
  hubIds: string[];
}

export interface DuplicateGroup {
  reason: string;
  links: LinkWithHubs[];
}

/**
 * Compute a grouping key for near-duplicates: normalize host, path, and params.
 * Removes: www., m., mobile., amp. subdomains; /amp path segment; trailing slash;
 * and AMP-related query params (amp, amp=1, outputType=amp).
 * Keeps other query params sorted for stable grouping.
 * Protocol (http vs https) is NOT part of the key; they group together.
 */
function getGroupingKey(url: string): string {
  const u = new URL(url);
  let host = u.hostname.toLowerCase();

  // Strip www., m., mobile., amp. subdomains
  host = host.replace(/^(www|m|mobile|amp)\./, '');

  // Strip /amp from pathname, remove trailing slash
  let pathname = u.pathname.replace(/\/amp(?:[/?#]|$)/, '/').replace(/\/$/, '') || '/';

  // Remove AMP-related params, keep others sorted
  const params = new URLSearchParams();

  for (const [key, value] of u.searchParams) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'amp' || (lowerKey === 'outputtype' && value.toLowerCase() === 'amp')) {
      continue; // Skip AMP params
    }
    params.append(key, value);
  }

  // Sort params for consistent grouping
  const sortedParams = new URLSearchParams([...params].sort());
  const queryStr = sortedParams.toString();

  return `//${host}${pathname}${queryStr ? `?${queryStr}` : ''}`;
}

/**
 * Determine reason labels for why links in a group are similar.
 * Check what actually differs across the group.
 */
function getReasons(groupLinks: LinkWithHubs[]): string {
  if (groupLinks.length < 2) return 'duplicate';

  const reasons = new Set<string>();
  const firstUrl = new URL(groupLinks[0]!.url);

  for (const link of groupLinks.slice(1)) {
    const u = new URL(link.url);

    // Check protocol
    if (u.protocol !== firstUrl.protocol) {
      reasons.add('http and https');
    }

    // Check for AMP markers
    const firstHasAmp = /\/amp(?:[/?#]|$)|[?&](?:amp|outputType=amp)(?:[&#]|$)|^https?:\/\/amp\./.test(groupLinks[0]!.url);
    const linkHasAmp = /\/amp(?:[/?#]|$)|[?&](?:amp|outputType=amp)(?:[&#]|$)|^https?:\/\/amp\./.test(link.url);
    if (firstHasAmp || linkHasAmp) {
      reasons.add('AMP version');
    }

    // Check for mobile subdomains
    const firstHasMobile = /^https?:\/\/(m|mobile)\./.test(groupLinks[0]!.url);
    const linkHasMobile = /^https?:\/\/(m|mobile)\./.test(link.url);
    if (firstHasMobile || linkHasMobile) {
      reasons.add('Mobile site');
    }

    // Check trailing slash
    const firstPath = firstUrl.pathname;
    const linkPath = u.pathname;
    const firstHasTrail = firstPath.endsWith('/') && firstPath !== '/';
    const linkHasTrail = linkPath.endsWith('/') && linkPath !== '/';
    const firstWithoutSlash = firstHasTrail ? firstPath.slice(0, -1) : firstPath;
    const linkWithoutSlash = linkHasTrail ? linkPath.slice(0, -1) : linkPath;
    if (firstWithoutSlash === linkWithoutSlash && firstHasTrail !== linkHasTrail) {
      reasons.add('Trailing slash');
    }
  }

  return Array.from(reasons).join(', ') || 'duplicate';
}

/**
 * Groups links by near-duplicate patterns (AMP variants, mobile variants).
 * O(n) scan over links + grouping key analysis.
 */
export function findNearDuplicates(rows: LinkWithHubs[]): DuplicateGroup[] {
  const groups = new Map<string, LinkWithHubs[]>();

  for (const row of rows) {
    const key = getGroupingKey(row.url);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Return only groups with 2+ links, sorted by count descending, each group by oldest first
  return Array.from(groups.values())
    .filter((g) => g.length > 1)
    .sort((a, b) => b.length - a.length)
    .map((groupLinks) => {
      // Sort by createdAt ascending so oldest is first (best to keep)
      groupLinks.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return { reason: getReasons(groupLinks), links: groupLinks };
    });
}

export async function duplicateRoutes(app: FastifyInstance): Promise<void> {
  // Finds near-duplicate links (AMP, mobile variants, etc.) that have escaped the normalizer.
  app.get('/links/duplicates', {
    schema: {
      response: {
        200: Type.Object({
          groups: Type.Array(
            Type.Object({
              reason: Type.String(),
              links: Type.Array(
                Type.Object({
                  id: Type.String(),
                  url: Type.String(),
                  title: Type.String(),
                  hubIds: Type.Array(Type.String()),
                  status: Type.String(),
                  createdAt: Type.String(),
                  dupeCount: Type.Integer(),
                }),
              ),
            }),
          ),
        }),
      },
    },
  }, async (req) => {
    const rows = await req.server.db
      .select({
        id: links.id,
        url: links.url,
        title: links.title,
        note: links.note,
        status: links.status,
        firstSeen: links.firstSeen,
        dupeCount: links.dupeCount,
        createdAt: links.createdAt,
        hubIds: dsql<string[]>`coalesce(array_agg(hub_links.hub_id) FILTER (WHERE hub_links.hub_id IS NOT NULL), '{}')`,
      })
      .from(links)
      .leftJoin(hubLinks, eq(hubLinks.linkId, links.id))
      .where(eq(links.status, 'active'))
      .groupBy(links.id)
      .orderBy(asc(links.createdAt));

    const groups = findNearDuplicates(rows as LinkWithHubs[]);
    return {
      groups: groups.map((g) => ({
        reason: g.reason,
        links: g.links.map((l) => ({
          id: l.id,
          url: l.url,
          title: l.title,
          hubIds: l.hubIds,
          status: l.status,
          createdAt: l.createdAt.toISOString(),
          dupeCount: l.dupeCount,
        })),
      })),
    };
  });

  // Merges multiple links into one, moving hub memberships and captures.
  app.post('/links/merge', {
    schema: {
      body: Type.Object({
        keepId: Type.String({ format: 'uuid' }),
        mergeIds: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: 50 }),
      }),
      response: {
        200: Type.Object({
          id: Type.String(),
          url: Type.String(),
          title: Type.String(),
          note: Type.String(),
          dupeCount: Type.Integer(),
          hubIds: Type.Array(Type.String()),
        }),
        400: Type.Object({ error: Type.String() }),
        404: Type.Object({ error: Type.String() }),
      },
    },
  }, async (req, reply) => {
    const { keepId, mergeIds } = req.body as { keepId: string; mergeIds: string[] };

    // Validate input
    if (mergeIds.includes(keepId)) {
      return reply.code(400).send({ error: 'keepId cannot be in mergeIds' });
    }

    if (new Set(mergeIds).size !== mergeIds.length) {
      return reply.code(400).send({ error: 'mergeIds contains duplicates' });
    }

    // Get the keep link
    const [keepLink] = await req.server.db
      .select({
        id: links.id,
        url: links.url,
        title: links.title,
        note: links.note,
        dupeCount: links.dupeCount,
        status: links.status,
        urlHash: links.urlHash,
      })
      .from(links)
      .where(eq(links.id, keepId));

    if (!keepLink) {
      return reply.code(404).send({ error: 'keep link not found' });
    }
    if (keepLink.status !== 'active') {
      return reply.code(400).send({ error: 'keep link must be active' });
    }

    // Get the merge links
    const mergeLinks = await req.server.db
      .select({
        id: links.id,
        title: links.title,
        note: links.note,
        dupeCount: links.dupeCount,
        status: links.status,
        urlHash: links.urlHash,
      })
      .from(links)
      .where(inArray(links.id, mergeIds));

    if (mergeLinks.length !== mergeIds.length) {
      return reply.code(404).send({ error: 'some merge links not found' });
    }

    // Check for archived links
    for (const link of mergeLinks) {
      if (link.status !== 'active') {
        return reply.code(400).send({ error: 'all merge links must be active' });
      }
    }

    const result = await req.server.db.transaction(async (tx) => {
      // Combine fields: use longer/non-empty title and note
      let finalTitle: string = keepLink.title;
      let finalNote: string = keepLink.note;
      let totalDupeCount: number = keepLink.dupeCount;

      for (const link of mergeLinks) {
        if (link.title && link.title.length > (finalTitle?.length ?? 0)) {
          finalTitle = link.title;
        }
        if (link.note && !finalNote) {
          finalNote = link.note;
        } else if (link.note && finalNote && link.note !== finalNote) {
          finalNote = `${finalNote}\n\n${link.note}`;
        }
        totalDupeCount += link.dupeCount;
      }

      // Move captures from merge links to keep link
      await tx
        .update(captures)
        .set({ linkId: keepId })
        .where(inArray(captures.linkId, mergeIds));

      // Move hub memberships from merge links to keep link
      const existingHubs = await tx
        .select({ hubId: hubLinks.hubId })
        .from(hubLinks)
        .where(eq(hubLinks.linkId, keepId));
      const existingHubIds = new Set(existingHubs.map((h) => h.hubId));

      const hublinkRows = await tx
        .select({ hubId: hubLinks.hubId, assignedBy: hubLinks.assignedBy })
        .from(hubLinks)
        .where(inArray(hubLinks.linkId, mergeIds));

      for (const row of hublinkRows) {
        if (!existingHubIds.has(row.hubId)) {
          await tx
            .insert(hubLinks)
            .values({ hubId: row.hubId, linkId: keepId, assignedBy: row.assignedBy })
            .onConflictDoNothing();
        }
      }

      // Record the deleted hashes so re-imports don't bring them back
      const urlHashesToDelete = mergeLinks.map((l) => ({ urlHash: l.urlHash }));
      if (urlHashesToDelete.length > 0) {
        await tx
          .insert(deletedHashes)
          .values(urlHashesToDelete)
          .onConflictDoNothing();
      }

      // Delete merge links (triggers link_deletions insertion via trigger)
      await tx.delete(links).where(inArray(links.id, mergeIds));

      // Update keep link with merged data
      const [updated] = await tx
        .update(links)
        .set({
          title: finalTitle,
          note: finalNote,
          dupeCount: totalDupeCount,
          updatedAt: dsql`now()`,
        })
        .where(eq(links.id, keepId))
        .returning({
          id: links.id,
          url: links.url,
          title: links.title,
          note: links.note,
          dupeCount: links.dupeCount,
        });

      if (!updated) return null;

      const hubIds = await tx
        .select({ hubId: hubLinks.hubId })
        .from(hubLinks)
        .where(eq(hubLinks.linkId, keepId));

      return { ...updated, hubIds: hubIds.map((h) => h.hubId) };
    });

    if (!result) {
      return reply.code(400).send({ error: 'merge failed: could not update keep link' });
    }

    return result;
  });
}
