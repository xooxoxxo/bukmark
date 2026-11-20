import type { FastifyInstance } from 'fastify';
import { Type, type Static } from 'typebox';
import { requireOwnerSession } from '../auth/plugin.js';
import { savedPageCandidates } from '../og/savedPageCandidates.js';
import { canonicalJson } from '../canonicalJson.js';
import { approveRecipeExport, getRecipeExport, listRecipeDrafts, prepareRecipe, type RecipeReader } from '../recipe/service.js';

const id = Type.String({ format: 'uuid' });
const text = (maxLength: number) => Type.String({ maxLength, pattern: '^[^\\u0000\\uD800-\\uDFFF]*$' });
const minutes = Type.Optional(Type.Integer({ minimum: 0, maximum: 10080 }));
const page = {
  linkId: Type.Optional(id),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 2_000_000 })),
};
const candidates = Type.Object({ ...page, q: Type.Optional(text(120)) });
const drafts = Type.Object(page);
const prepare = Type.Object({ linkId: id, key: Type.Optional(text(2000)) });
const fields = Type.Object({
  title: text(200),
  publisher: Type.Optional(text(200)),
  authors: Type.Optional(Type.Array(text(200), { maxItems: 12 })),
  credit: Type.Optional(text(500)),
  yield: Type.Optional(Type.Object({
    servings: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
    text: Type.Optional(text(160)),
  }, { additionalProperties: false })),
  timing: Type.Optional(Type.Object({
    prepMinutes: minutes, cookMinutes: minutes, totalMinutes: minutes,
    passive: Type.Optional(Type.Array(Type.Object({
      activity: text(200), durationText: text(160),
    }, { additionalProperties: false }), { maxItems: 12 })),
  }, { additionalProperties: false })),
  ingredients: Type.Array(text(2000), { maxItems: 100 }),
  steps: Type.Array(text(2000), { maxItems: 100 }),
  notes: Type.Optional(Type.Array(text(2000), { maxItems: 20 })),
}, { additionalProperties: false });
const approval = Type.Object({
  id,
  revision: Type.Integer({ minimum: 1 }),
  fields,
  selectedVariations: Type.Array(text(250), { maxItems: 20, uniqueItems: true }),
  reviewedUnassigned: Type.Boolean(),
}, { additionalProperties: false });

export async function recipeRoutes(app: FastifyInstance, { readPage }: { readPage: RecipeReader }) {
  app.get('/review/recipes/candidates', { preHandler: requireOwnerSession, schema: { querystring: candidates } },
    (req) => savedPageCandidates(app.db, req.query as Static<typeof candidates>));

  app.post('/review/recipes/prepare', { preHandler: requireOwnerSession, schema: { body: prepare } }, (req) => {
    const { linkId, key } = req.body as Static<typeof prepare>;
    return prepareRecipe(app.db, linkId, key, readPage);
  });

  app.get('/review/recipes/drafts', { preHandler: requireOwnerSession, schema: { querystring: drafts } },
    (req) => listRecipeDrafts(app.db, req.query as Static<typeof drafts>));

  app.post('/review/recipes/exports', { preHandler: requireOwnerSession, schema: { body: approval } }, async (req, reply) => {
    const result = await approveRecipeExport(app.db, req.body as Static<typeof approval>);
    if (result.outcome === 'changed') return reply.code(409).send({ error: 'The recipe draft changed. Review the current recipe.' });
    if (result.outcome === 'timing') return reply.code(400).send({ error: 'Correct or omit the disputed times before approving.' });
    if (result.outcome === 'incomplete') return reply.code(400).send({ error: 'Add the required fields and review any unassigned lines.' });
    return { id: result.id };
  });

  app.get('/review/recipes/exports/:id', { preHandler: requireOwnerSession, schema: { params: Type.Object({ id }) } }, async (req, reply) => {
    const payload = await getRecipeExport(app.db, (req.params as { id: string }).id);
    if (!payload) return reply.code(404).send({ error: 'Recipe export not found.' });
    return reply.header('Cache-Control', 'no-store')
      .header('Content-Disposition', 'attachment; filename="bukmark-recipe.json"')
      .type('application/json').send(canonicalJson(payload) + '\n');
  });
}
