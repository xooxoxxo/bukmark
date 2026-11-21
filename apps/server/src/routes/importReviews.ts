import type { FastifyInstance } from 'fastify';
import { Type, type Static } from 'typebox';
import { requireOwnerSession } from '../auth/plugin.js';
import { listImports, readImport, saveImportDecisions, StaleImport } from '../review/importReview.js';

const params = Type.Object({ id: Type.String({ pattern: '^(?:[a-f0-9]{32}|[a-f0-9]{64})$' }) });
const decision = Type.Object({
  id: Type.String({ format: 'uuid' }), version: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  revision: Type.Integer({ minimum: 0 }), choice: Type.Union([
    Type.Literal('accept'), Type.Literal('answer'), Type.Literal('keep'), Type.Literal('archive'), Type.Literal('skip')]),
  answer: Type.Optional(Type.String({ minLength: 1, maxLength: 1000, pattern: '^[^\\u0000]*\\S[^\\u0000]*$' })),
});
const body = Type.Object({ items: Type.Array(decision, { minItems: 1 }) });

export async function importReviewRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireOwnerSession);
  app.get('/imports', () => listImports(app.db));
  app.get('/imports/:id', { schema: { params } }, async (req, reply) => {
    const view = await readImport(app.db, (req.params as Static<typeof params>).id);
    return view ?? reply.code(404).send({ error: 'Import not found.' });
  });
  app.post('/imports/:id/decisions', { schema: { params, body } }, async (req, reply) => {
    try {
      await saveImportDecisions(app.db, (req.params as Static<typeof params>).id, (req.body as Static<typeof body>).items);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof StaleImport) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });
}
