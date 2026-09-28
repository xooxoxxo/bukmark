import { Type } from '@sinclair/typebox';
import { and, desc, eq, inArray, ne, sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { normalizeUrl } from '@bukmark/shared';
import { deletedHashes, hubLinks, hubs, links } from '../db/schema.js';
import { addLink } from '../links/addLink.js';
import { importLinks } from '../links/importLinks.js';
import { assignHubs } from '../links/assignHubs.js';
import { backfillOg } from '../og/backfill.js';

const LinkDto = Type.Object({
  id: Type.String(), url: Type.String(), title: Type.String(), note: Type.String(),
  status: Type.String(), relevance: Type.Union([Type.Integer(), Type.Null()]),
  dupeCount: Type.Integer(),
  hubIds: Type.Array(Type.String()), imageUrl: Type.Union([Type.String(), Type.Null()]), firstSeen: Type.String(),
});

/** A stored URL's host, as normalizeUrl writes it: lower case, no leading www. */
const linkHost = dsql`regexp_replace(lower(substring(${links.url} from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^/?#@]*@)?([^/?#:]+)')), '^www\.', '')`;

export async function linkRoutes(app: FastifyInstance): Promise<void> {
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

    const [link] = await db.select({ id: links.id }).from(links).where(eq(links.urlHash, norm.urlHash));
    const saved = link
      ? {
          id: link.id,
          hubs: (await db
            .select({ name: hubs.name })
            .from(hubLinks)
            .innerJoin(hubs, eq(hubs.id, hubLinks.hubId))
            .where(eq(hubLinks.linkId, link.id))
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
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
        offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
      }),
    },
  }, async (req) => {
    const { q, hub, unassigned, status = 'active', limit = 50, offset = 0 } = req.query as {
      q?: string; hub?: string; unassigned?: boolean; status?: 'active' | 'archived';
      limit?: number; offset?: number;
    };
    const conds = [eq(links.status, status)];
    if (q) conds.push(dsql`search_tsv @@ websearch_to_tsquery('simple', ${q})`);
    if (hub) conds.push(dsql`EXISTS (SELECT 1 FROM hub_links hl WHERE hl.link_id = ${links.id} AND hl.hub_id = ${hub})`);
    if (unassigned) conds.push(dsql`NOT EXISTS (SELECT 1 FROM hub_links hl WHERE hl.link_id = ${links.id})`);
    const where = and(...conds);

    const totalRows = await req.server.db.select({ n: dsql<number>`count(*)::int` }).from(links).where(where);
    const rows = await req.server.db
      .select({
        id: links.id, url: links.url, title: links.title, note: links.note,
        status: links.status, relevance: links.relevance, dupeCount: links.dupeCount, firstSeen: links.firstSeen,
        imageUrl: links.imageUrl,
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
      .orderBy(dsql`${links.relevance} DESC NULLS LAST`, desc(links.lastSeen))
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((r) => ({ ...r, firstSeen: r.firstSeen.toISOString() })),
      total: totalRows[0]!.n,
    };
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
      }),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { title?: string; note?: string; status?: 'active' | 'archived' };
    const [row] = await req.server.db
      .update(links)
      .set({ ...body, updatedAt: dsql`now()` })
      .where(eq(links.id, id))
      .returning({
        id: links.id, url: links.url, title: links.title, note: links.note,
        status: links.status, relevance: links.relevance, dupeCount: links.dupeCount, firstSeen: links.firstSeen,
        imageUrl: links.imageUrl,
      });
    if (!row) return reply.code(404).send({ error: 'link not found' });
    const hubRows = await req.server.db
      .select({ hubId: hubLinks.hubId }).from(hubLinks).where(eq(hubLinks.linkId, id));
    return { ...row, firstSeen: row.firstSeen.toISOString(), hubIds: hubRows.map((h) => h.hubId) };
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
