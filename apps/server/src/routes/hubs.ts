import { Type } from '@sinclair/typebox';
import { asc, desc, eq, sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { hubLinks, hubs, links } from '../db/schema.js';

export async function hubRoutes(app: FastifyInstance): Promise<void> {
  app.get('/hubs', async (req) => {
    const items = await req.server.db
      .select({
        id: hubs.id, name: hubs.name, description: hubs.description, status: hubs.status,
        linkCount: dsql<number>`count(hub_links.link_id)::int`,
      })
      .from(hubs)
      .leftJoin(hubLinks, eq(hubLinks.hubId, hubs.id))
      .groupBy(hubs.id)
      .orderBy(desc(dsql`count(hub_links.link_id)`), asc(hubs.name));
    return { items };
  });

  app.post('/hubs', {
    schema: { body: Type.Object({ name: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()) }) },
  }, async (req, reply) => {
    const { name, description = '' } = req.body as { name: string; description?: string };
    const [row] = await req.server.db
      .insert(hubs).values({ name, description }).onConflictDoNothing().returning();
    if (!row) return reply.code(409).send({ error: 'hub name exists' });
    return row;
  });

  app.patch('/hubs/:id', {
    schema: {
      params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      body: Type.Object({
        name: Type.Optional(Type.String({ minLength: 1 })),
        description: Type.Optional(Type.String()),
        status: Type.Optional(Type.Union([
          Type.Literal('active'), Type.Literal('dormant'), Type.Literal('archived'),
        ])),
      }),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; description?: string; status?: 'active' | 'dormant' | 'archived' };
    const [row] = await req.server.db
      .update(hubs)
      .set({ ...body, updatedAt: dsql`now()` })
      .where(eq(hubs.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'hub not found' });
    return row;
  });

  app.delete('/hubs/:id', {
    schema: { params: Type.Object({ id: Type.String({ format: 'uuid' }) }) },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await req.server.db.delete(hubs).where(eq(hubs.id, id)).returning({ id: hubs.id });
    if (rows.length === 0) return reply.code(404).send({ error: 'hub not found' });
    return { ok: true };
  });

  app.get('/stats', async (req) => {
    const [row] = await req.server.db.execute(dsql`
      SELECT
        (SELECT count(*)::int FROM links) AS links,
        (SELECT count(*)::int FROM links WHERE status = 'active') AS active,
        (SELECT count(*)::int FROM links WHERE status = 'archived') AS archived,
        (SELECT count(*)::int FROM hubs) AS hubs,
        (SELECT count(*)::int FROM links l WHERE l.status = 'active'
           AND NOT EXISTS (SELECT 1 FROM hub_links hl WHERE hl.link_id = l.id)) AS unassigned
    `);
    return row;
  });
}
