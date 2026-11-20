import type { FastifyInstance } from 'fastify';
import { Type, type Static } from 'typebox';
import { BUILDER_EXPORT_MAX_ITEMS } from '@bukmark/shared';
import { requireOwnerSession } from '../auth/plugin.js';
import { canonicalJson } from '../canonicalJson.js';
import {
  approveBuilderExport, builderCandidates, getBuilderExport, listBuilderDrafts, prepareBuilderDrafts,
} from '../builder/service.js';

const id = Type.String({ format: 'uuid' });
const text = (maxLength: number) => Type.String({ maxLength, pattern: '^[^\\u0000]*$' });
const page = {
  linkId: Type.Optional(id),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
};
const candidates = Type.Object({ ...page, q: Type.Optional(text(120)) });
const drafts = Type.Object(page);
const prepare = Type.Object({
  linkIds: Type.Array(id, { minItems: 1, maxItems: 12, uniqueItems: true }),
  pins: Type.Optional(Type.Array(Type.Object({
    linkId: id, ref: text(250), commit: Type.String({ pattern: '^[a-fA-F0-9]{40}$' }),
  }), { maxItems: 12 })),
});
const approval = Type.Object({
  items: Type.Array(Type.Object({
    id,
    revision: Type.Integer({ minimum: 1 }),
    synopsis: text(500),
    tags: Type.Array(text(50), { maxItems: 12, uniqueItems: true }),
    contextKeys: Type.Array(text(1500), { uniqueItems: true }),
  }), { minItems: 1, maxItems: BUILDER_EXPORT_MAX_ITEMS }),
});

export async function builderRoutes(app: FastifyInstance, { fetcher }: { fetcher: typeof fetch }) {
  app.get('/review/builder/candidates', {
    preHandler: requireOwnerSession, schema: { querystring: candidates },
  }, (req) => builderCandidates(app.db, req.query as Static<typeof candidates>));

  app.post('/review/builder/prepare', {
    preHandler: requireOwnerSession, schema: { body: prepare },
  }, async (req, reply) => {
    const { linkIds, pins = [] } = req.body as Static<typeof prepare>;
    const byLink = new Map(pins.map(({ linkId, ref, commit }) => [linkId, { ref, commit }]));
    if (byLink.size !== pins.length || pins.some(({ linkId }) => !linkIds.includes(linkId))) {
      return reply.code(400).send({ error: 'Provide at most one pin for each selected bookmark.' });
    }
    return prepareBuilderDrafts(app.db, linkIds, fetcher, byLink);
  });

  app.get('/review/builder/drafts', {
    preHandler: requireOwnerSession, schema: { querystring: drafts },
  }, (req) => listBuilderDrafts(app.db, req.query as Static<typeof drafts>));

  app.post('/review/builder/exports', {
    preHandler: requireOwnerSession, schema: { body: approval },
  }, async (req, reply) => {
    const { items } = req.body as Static<typeof approval>;
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      return reply.code(400).send({ error: 'Select each builder draft once.' });
    }
    const result = await approveBuilderExport(app.db, items);
    if (result.outcome === 'changed') return reply.code(409).send({ error: 'A builder draft changed. Review the current details.' });
    if (result.outcome === 'context') return reply.code(400).send({ error: 'The selected context is unavailable on its draft.' });
    return { id: result.id, recordCount: result.recordCount };
  });

  app.get('/review/builder/exports/:id', {
    preHandler: requireOwnerSession, schema: { params: Type.Object({ id }) },
  }, async (req, reply) => {
    const snapshot = await getBuilderExport(app.db, (req.params as { id: string }).id);
    if (!snapshot) return reply.code(404).send({ error: 'Builder export not found.' });
    return reply.header('Cache-Control', 'no-store')
      .header('Content-Disposition', 'attachment; filename="bukmark-builder.json"')
      .type('application/json').send(canonicalJson(snapshot) + '\n');
  });
}
