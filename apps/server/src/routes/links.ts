import { Type } from '@sinclair/typebox';
import { and, asc, desc, eq, inArray, ne, sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { normalizeUrl, matchKey } from '@bukmark/shared';
import { pgCode } from '../db/client.js';
import { deletedHashes, hubLinks, hubs, links } from '../db/schema.js';
import { addLink } from '../links/addLink.js';
import { importLinks } from '../links/importLinks.js';
import { assignHubs } from '../links/assignHubs.js';
import { changeLinkHubs, setLinkHubs } from '../links/setLinkHubs.js';
import { backfillOg } from '../og/backfill.js';
import { checkLinks, isBroken, type CheckPage } from '../og/checkLinks.js';

const LinkDto = Type.Object({
  id: Type.String(), url: Type.String(), title: Type.String(), note: Type.String(),
  status: Type.String(), relevance: Type.Union([Type.Integer(), Type.Null()]),
  dupeCount: Type.Integer(),
  hubIds: Type.Array(Type.String()), imageUrl: Type.Union([Type.String(), Type.Null()]), firstSeen: Type.String(),
});

/** A stored URL's host, as normalizeUrl writes it: lower case, no leading www. */
const linkHost = dsql`regexp_replace(lower(substring(${links.url} from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^/?#@]*@)?([^/?#:]+)')), '^www\.', '')`;

/** Marks around the words a search matched in a snippet; the web app renders them. */
export const HIT_START = '\u2e22';
export const HIT_END = '\u2e23';

/**
 * A timestamptz as the changes feed writes it: UTC, ISO 8601, all six
 * fractional digits. Made in Postgres, never through a JS Date, which keeps
 * only milliseconds: a cursor cut to the millisecond would re-send rows, and
 * one rounded up would skip them.
 */
const feedTime = (value: unknown) =>
  dsql<string>`to_char(${value} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * How far back an open transaction holds the changes feed. A write stamps
 * updated_at with its transaction's start but becomes visible only at commit,
 * so a pull taken meanwhile could move its cursor past a row that has not
 * appeared yet. The feed therefore stops short of the oldest transaction still
 * open on this database; one open longer than this (a forgotten psql session)
 * no longer holds it.
 */
const OPEN_TRANSACTION_WAIT = '5 minutes';

const SORTS = {
  relevance: [dsql`${links.relevance} DESC NULLS LAST`, desc(links.lastSeen)],
  newest: [desc(links.firstSeen)],
  oldest: [asc(links.firstSeen)],
  title: [dsql`lower(nullif(${links.title}, '')) ASC NULLS LAST`, asc(links.url)],
} as const;

export async function linkRoutes(app: FastifyInstance, opts: { checkPage: CheckPage }): Promise<void> {
  // What bukmark already holds for a page before it is saved: the page itself
  // and the hubs it is in, else how the rest of its site is filed.
  app.get('/links/lookup', {
    schema: {
      querystring: Type.Object({ url: Type.String({ minLength: 1 }) }),
      response: {
        200: Type.Object({
          saved: Type.Union([Type.Object({ id: Type.String(), hubs: Type.Array(Type.String()) }), Type.Null()]),
          domain: Type.Object({
            host: Type.String(),
            links: Type.Integer(),
            hubs: Type.Array(Type.Object({ name: Type.String(), links: Type.Integer() })),
          }),
        }),
        400: Type.Object({ error: Type.String() }),
      },
    },
  }, async (req, reply) => {
    const norm = normalizeUrl((req.query as { url: string }).url);
    if (!norm.ok) return reply.code(400).send({ error: `${norm.reason} url` });
    const { db } = req.server;
    const host = new URL(norm.url).hostname;
    const key = matchKey(norm.url);

    // Check by exact URL hash first, then by near-duplicate match key
    const [link] = await db.select({ id: links.id }).from(links).where(eq(links.urlHash, norm.urlHash));
    const linkedByKey = !link ? (await db.select({ id: links.id }).from(links).where(eq(links.matchKey, key))).at(0) : null;
    const savedLink = link ?? linkedByKey;
    const saved = savedLink
      ? {
          id: savedLink.id,
          hubs: (await db
            .select({ name: hubs.name })
            .from(hubLinks)
            .innerJoin(hubs, eq(hubs.id, hubLinks.hubId))
            .where(eq(hubLinks.linkId, savedLink.id))
            .orderBy(hubs.name)).map((h) => h.name),
        }
      : null;

    const sameSite = and(eq(links.status, 'active'), ne(links.urlHash, norm.urlHash), dsql`${linkHost} = ${host}`);
    const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(links).where(sameSite) as [{ n: number }];
    const top = await db
      .select({ name: hubs.name, links: dsql<number>`count(*)::int` })
      .from(links)
      .innerJoin(hubLinks, eq(hubLinks.linkId, links.id))
      .innerJoin(hubs, eq(hubs.id, hubLinks.hubId))
      .where(sameSite)
      .groupBy(hubs.name)
      .orderBy(dsql`count(*) DESC`, hubs.name)
      .limit(3);

    return { saved, domain: { host, links: n, hubs: top } };
  });

  app.get('/links', {
    schema: {
      querystring: Type.Object({
        q: Type.Optional(Type.String()),
        hub: Type.Optional(Type.String({ format: 'uuid' })),
        unassigned: Type.Optional(Type.Boolean()),
        status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('archived')])),
        broken: Type.Optional(Type.Boolean()),
        sort: Type.Optional(Type.Union(Object.keys(SORTS).map((k) => Type.Literal(k)))),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
        offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
      }),
    },
  }, async (req) => {
    const { q, hub, unassigned, broken, status = 'active', sort = 'relevance', limit = 50, offset = 0 } = req.query as {
      q?: string; hub?: string; unassigned?: boolean; broken?: boolean; status?: 'active' | 'archived';
      sort?: keyof typeof SORTS; limit?: number; offset?: number;
    };
    const conds = [eq(links.status, status)];
    if (q) conds.push(dsql`search_tsv @@ websearch_to_tsquery('simple', ${q})`);
    if (hub) conds.push(dsql`EXISTS (SELECT 1 FROM hub_links hl WHERE hl.link_id = ${links.id} AND hl.hub_id = ${hub})`);
    if (unassigned) conds.push(dsql`NOT EXISTS (SELECT 1 FROM hub_links hl WHERE hl.link_id = ${links.id})`);
    if (broken) conds.push(isBroken);
    const where = and(...conds);
    // Where a search matched the page's own text, the words around the match.
    const snippet = q
      ? dsql<string | null>`CASE WHEN to_tsvector('simple', coalesce(${links.contentText}, '')) @@ websearch_to_tsquery('simple', ${q})
          THEN ts_headline('simple', ${links.contentText}, websearch_to_tsquery('simple', ${q}),
            ${`StartSel=${HIT_START}, StopSel=${HIT_END}, MaxWords=28, MinWords=12, MaxFragments=1`})
          END`
      : dsql<null>`NULL`;

    const totalRows = await req.server.db.select({ n: dsql<number>`count(*)::int` }).from(links).where(where);
    const rows = await req.server.db
      .select({
        id: links.id, url: links.url, title: links.title, note: links.note,
        status: links.status, relevance: links.relevance, dupeCount: links.dupeCount, firstSeen: links.firstSeen,
        imageUrl: links.imageUrl,
        httpStatus: links.httpStatus,
        checkError: links.checkError,
        broken: dsql<boolean>`coalesce(${isBroken}, false)`,
        snippet,
        groupHint: dsql<string | null>`(
          SELECT c.group_hint FROM captures c
          WHERE c.link_id = ${links.id} AND c.group_hint IS NOT NULL
          ORDER BY c.captured_at DESC LIMIT 1
        )`,
        hubIds: dsql<string[]>`coalesce(array_agg(hub_links.hub_id) FILTER (WHERE hub_links.hub_id IS NOT NULL), '{}')`,
      })
      .from(links)
      .leftJoin(hubLinks, eq(hubLinks.linkId, links.id))
      .where(where)
      .groupBy(links.id)
      .orderBy(...SORTS[sort], asc(links.id))
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((r) => ({ ...r, firstSeen: r.firstSeen.toISOString() })),
      total: totalRows[0]!.n,
    };
  });

  // What changed since a sync client's cursor: links written at or after it,
  // and links deleted at or after it. Inclusive, so writes that share the
  // cursor's timestamp are never skipped; the client drops what it already has.
  app.get('/links/changes', {
    schema: {
      querystring: Type.Object({
        since: Type.Optional(Type.String({
          pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?(Z|[+-]\\d{2}(:?\\d{2})?)$',
        })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, default: 500 })),
      }),
      response: {
        200: Type.Object({
          items: Type.Array(Type.Object({
            id: Type.String(), url: Type.String(), title: Type.String(), note: Type.String(),
            status: Type.String(), hubs: Type.Array(Type.String()), updatedAt: Type.String(),
          })),
          deleted: Type.Array(Type.Object({ id: Type.String(), deletedAt: Type.String() })),
          cursor: Type.Union([Type.String(), Type.Null()]),
          more: Type.Boolean(),
        }),
        400: Type.Object({ error: Type.String() }),
      },
    },
  }, async (req, reply) => {
    const { since, limit = 500 } = req.query as { since?: string; limit?: number };
    const { db } = req.server;

    let from: string | null = null;
    if (since !== undefined) {
      try {
        const [row] = await db.execute(dsql`SELECT ${feedTime(dsql`${since}::timestamptz`)} AS at`);
        from = row!.at as string;
      } catch (err) {
        // 22007 invalid_datetime_format, 22008 datetime_field_overflow: a day 31 in June.
        if (['22007', '22008'].includes(pgCode(err) ?? '')) {
          return reply.code(400).send({ error: 'invalid since' });
        }
        throw err;
      }
    }
    const start = from === null ? dsql`'-infinity'::timestamptz` : dsql`${from}::timestamptz`;

    // A page takes `limit` changes after the cursor, plus every change that
    // shares the cursor's timestamp or the last one's. One statement can stamp
    // thousands of rows alike (a bulk archive, a hub rename); splitting such a
    // group would leave the next page, which starts at the same timestamp, no
    // way forward.
    const rows = await db.execute(dsql`
      WITH open_tx AS (
        SELECT min(xact_start) AS at FROM pg_stat_activity
        WHERE datname = current_database() AND backend_type = 'client backend'
          AND pid <> pg_backend_pid() AND xact_start IS NOT NULL
          AND xact_start > now() - ${OPEN_TRANSACTION_WAIT}::interval
      ),
      changes AS (
        SELECT id, updated_at AS at, false AS gone FROM links WHERE updated_at >= ${start}
        UNION ALL
        SELECT link_id, deleted_at, true FROM link_deletions WHERE deleted_at >= ${start}
      ),
      settled AS (
        SELECT * FROM changes WHERE at < coalesce((SELECT at FROM open_tx), 'infinity')
      ),
      edge AS (
        SELECT at FROM settled WHERE at > ${start} ORDER BY at, id OFFSET ${limit - 1} LIMIT 1
      )
      SELECT c.id, c.gone, ${feedTime(dsql`c.at`)} AS at,
        l.url, l.title, l.note, l.status,
        coalesce((
          SELECT array_agg(h.name ORDER BY h.name) FROM hub_links hl JOIN hubs h ON h.id = hl.hub_id
          WHERE hl.link_id = c.id AND h.status <> 'archived'
        ), '{}') AS hubs,
        EXISTS (SELECT 1 FROM settled WHERE at > (SELECT at FROM edge)) AS more
      FROM settled c
      LEFT JOIN links l ON l.id = c.id AND NOT c.gone
      WHERE c.at <= coalesce((SELECT at FROM edge), 'infinity')
      ORDER BY c.at, c.id
    `) as unknown as {
      id: string; gone: boolean; at: string; url: string; title: string; note: string;
      status: string; hubs: string[]; more: boolean;
    }[];

    const items = [];
    const deleted = [];
    for (const r of rows) {
      if (r.gone) deleted.push({ id: r.id, deletedAt: r.at });
      else items.push({ id: r.id, url: r.url, title: r.title, note: r.note, status: r.status, hubs: r.hubs, updatedAt: r.at });
    }
    return { items, deleted, cursor: rows.at(-1)?.at ?? from, more: rows[0]?.more ?? false };
  });

  // One link with everything bukmark holds for it, the saved page text included.
  app.get('/links/:id', {
    schema: { params: Type.Object({ id: Type.String({ format: 'uuid' }) }) },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await req.server.db
      .select({
        id: links.id, url: links.url, title: links.title, note: links.note,
        status: links.status, relevance: links.relevance, dupeCount: links.dupeCount,
        imageUrl: links.imageUrl, firstSeen: links.firstSeen, lastSeen: links.lastSeen,
        contentText: links.contentText, httpStatus: links.httpStatus, checkError: links.checkError,
        checkedAt: links.checkedAt, broken: dsql<boolean>`coalesce(${isBroken}, false)`,
        hubIds: dsql<string[]>`coalesce((SELECT array_agg(hl.hub_id) FROM hub_links hl WHERE hl.link_id = ${links.id}), '{}')`,
      })
      .from(links)
      .where(eq(links.id, id));
    if (!row) return reply.code(404).send({ error: 'link not found' });
    return {
      ...row,
      firstSeen: row.firstSeen.toISOString(),
      lastSeen: row.lastSeen.toISOString(),
      checkedAt: row.checkedAt?.toISOString() ?? null,
    };
  });

  // Checks the links most in need of it now, instead of waiting for the background.
  app.post('/links/check', {
    schema: {
      body: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })) }),
    },
  }, async (req) => {
    const { limit = 20 } = (req.body ?? {}) as { limit?: number };
    return checkLinks(req.server.db, opts.checkPage, limit);
  });

  app.post('/links', {
    schema: {
      body: Type.Object({
        url: Type.String(),
        title: Type.Optional(Type.String()),
        note: Type.Optional(Type.String()),
        hub: Type.Optional(Type.String()),
        relevance: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
      }),
      response: {
        200: Type.Object({
          outcome: Type.Union([Type.Literal('created'), Type.Literal('updated'), Type.Literal('resurrected')]),
          link: LinkDto,
        }),
        400: Type.Object({
          error: Type.String(),
        }),
      },
    },
  }, async (req, reply) => {
    const b = req.body as { url: string; title?: string; note?: string; hub?: string; relevance?: number };
    const norm = normalizeUrl(b.url);
    if (!norm.ok) return reply.code(400).send({ error: `${norm.reason} url` });
    return addLink(req.server.db, { ...b, url: norm.url, urlHash: norm.urlHash }, req.server.fetchOgImage);
  });

  app.post('/links/import', {
    schema: {
      body: Type.Object({
        items: Type.Array(
          Type.Object({
            url: Type.String(),
            title: Type.Optional(Type.String()),
            folderPath: Type.Optional(Type.String()),
          }),
          { minItems: 1, maxItems: 200 },
        ),
      }),
    },
  }, async (req) => {
    const { items } = req.body as { items: { url: string; title?: string; folderPath?: string }[] };
    return importLinks(req.server.db, items);
  });

  app.post('/links/og-backfill', {
    schema: {
      body: Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
      }),
    },
  }, async (req) => {
    const { limit = 20 } = req.body as { limit?: number };
    return backfillOg(req.server.db, req.server.fetchOgImage, limit);
  });

  // Re-fetch og:image for a single link
  app.post('/links/:id/refresh', {
    schema: {
      params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      response: {
        200: LinkDto,
        400: Type.Object({ error: Type.String() }),
        404: Type.Object({ error: Type.String() }),
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [link] = await req.server.db
      .select({ id: links.id, url: links.url })
      .from(links)
      .where(eq(links.id, id));
    if (!link) return reply.code(404).send({ error: 'link not found' });

    // A failed or empty fetch keeps the preview you had: asking again should
    // never make a link lose its image.
    const image = await req.server.fetchOgImage(link.url).catch(() => null);
    const updates: Record<string, unknown> = { ogFetchedAt: dsql`now()` };
    if (image) updates.imageUrl = image;

    await req.server.db
      .update(links)
      .set({ ...updates, updatedAt: dsql`now()` })
      .where(eq(links.id, id));

    const [updated] = await req.server.db
      .select({
        id: links.id, url: links.url, title: links.title, note: links.note,
        status: links.status, relevance: links.relevance, dupeCount: links.dupeCount, firstSeen: links.firstSeen,
        imageUrl: links.imageUrl,
      })
      .from(links)
      .where(eq(links.id, id));

    if (!updated) return reply.code(400).send({ error: 'failed to update link' });

    const hubRows = await req.server.db.select({ hubId: hubLinks.hubId }).from(hubLinks).where(eq(hubLinks.linkId, id));
    return { ...updated, firstSeen: updated.firstSeen.toISOString(), hubIds: hubRows.map((h) => h.hubId) };
  });

  app.post('/links/assign', {
    schema: {
      body: Type.Object({
        assignments: Type.Array(
          Type.Object({
            linkId: Type.String({ format: 'uuid' }),
            hub: Type.String({ minLength: 1 }),
            relevance: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
          }),
          { minItems: 1, maxItems: 100 },
        ),
      }),
    },
  }, async (req) => {
    const { assignments } = req.body as {
      assignments: { linkId: string; hub: string; relevance?: number }[];
    };
    return assignHubs(req.server.db, assignments);
  });

  app.patch('/links/:id', {
    schema: {
      params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      body: Type.Object({
        title: Type.Optional(Type.String()),
        note: Type.Optional(Type.String()),
        status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('archived')])),
        relevance: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 5 }), Type.Null()])),
        // Hub names, replacing the hubs the link is in: see setLinkHubs.
        hubs: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 100 })),
        // Hub names to file the link into or take it out of, the others left
        // alone: see changeLinkHubs.
        addHubs: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 100 })),
        removeHubs: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 100 })),
      }),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { hubs: hubNames, addHubs, removeHubs, ...fields } = req.body as {
      title?: string; note?: string; status?: 'active' | 'archived'; relevance?: number | null;
      hubs?: string[]; addHubs?: string[]; removeHubs?: string[];
    };
    // A whole set and changes to it can't both apply.
    if (hubNames && (addHubs || removeHubs)) {
      return reply.code(400).send({ error: 'hubs cannot be sent with addHubs or removeHubs' });
    }
    const result = await req.server.db.transaction(async (tx) => {
      const [row] = await tx
        .update(links)
        .set({ ...fields, updatedAt: dsql`now()` })
        .where(eq(links.id, id))
        .returning({
          id: links.id, url: links.url, title: links.title, note: links.note,
          status: links.status, relevance: links.relevance, dupeCount: links.dupeCount, firstSeen: links.firstSeen,
          imageUrl: links.imageUrl,
        });
      if (!row) return null;
      if (hubNames) await setLinkHubs(tx, id, hubNames);
      if (addHubs || removeHubs) await changeLinkHubs(tx, id, addHubs ?? [], removeHubs ?? []);
      const hubRows = await tx.select({ hubId: hubLinks.hubId }).from(hubLinks).where(eq(hubLinks.linkId, id));
      return { ...row, firstSeen: row.firstSeen.toISOString(), hubIds: hubRows.map((h) => h.hubId) };
    });
    if (!result) return reply.code(404).send({ error: 'link not found' });
    return result;
  });

  app.post('/links/bulk', {
    schema: {
      body: Type.Object({
        ids: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1 }),
        action: Type.Union([
          Type.Literal('archive'), Type.Literal('activate'),
          Type.Literal('assign'), Type.Literal('unassign'), Type.Literal('delete'),
        ]),
        hubId: Type.Optional(Type.String({ format: 'uuid' })),
      }),
    },
  }, async (req, reply) => {
    const { ids, action, hubId } = req.body as {
      ids: string[]; action: 'archive' | 'activate' | 'assign' | 'unassign' | 'delete'; hubId?: string;
    };
    if ((action === 'assign' || action === 'unassign') && !hubId) {
      return reply.code(400).send({ error: `${action} requires hubId` });
    }
    if (action === 'archive' || action === 'activate') {
      const rows = await req.server.db
        .update(links)
        .set({ status: action === 'archive' ? 'archived' : 'active', updatedAt: dsql`now()` })
        .where(inArray(links.id, ids))
        .returning({ id: links.id });
      return { affected: rows.length };
    }
    if (action === 'delete') {
      const affected = await req.server.db.transaction(async (tx) => {
        const victims = await tx
          .select({ urlHash: links.urlHash })
          .from(links)
          .where(inArray(links.id, ids));
        if (victims.length > 0) {
          await tx
            .insert(deletedHashes)
            .values(victims.map((v) => ({ urlHash: v.urlHash })))
            .onConflictDoNothing();
        }
        const deleted = await tx.delete(links).where(inArray(links.id, ids)).returning({ id: links.id });
        return deleted.length;
      });
      return { affected };
    }
    if (action === 'assign') {
      const rows = await req.server.db
        .insert(hubLinks)
        .values(ids.map((linkId) => ({ hubId: hubId!, linkId, assignedBy: 'user' as const })))
        .onConflictDoNothing()
        .returning({ linkId: hubLinks.linkId });
      return { affected: rows.length };
    }
    const rows = await req.server.db
      .delete(hubLinks)
      .where(and(eq(hubLinks.hubId, hubId!), inArray(hubLinks.linkId, ids)))
      .returning({ linkId: hubLinks.linkId });
    return { affected: rows.length };
  });
}
