import { Type } from '@sinclair/typebox';
import { and, desc, eq, inArray, sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { deletedHashes, hubLinks, links } from '../db/schema.js';

const LinkDto = Type.Object({
  id: Type.String(), url: Type.String(), title: Type.String(), note: Type.String(),
  status: Type.String(), relevance: Type.Union([Type.Integer(), Type.Null()]),
  dupeCount: Type.Integer(),
  hubIds: Type.Array(Type.String()), firstSeen: Type.String(),
});

export async function linkRoutes(app: FastifyInstance): Promise<void> {
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
