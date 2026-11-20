import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type, type Static } from 'typebox';
import { requireOwnerSession } from '../auth/plugin.js';
import { canonicalJson } from '../canonicalJson.js';
import {
  approveKnowledgeNote, getKnowledgeExport, listKnowledgeNotes, saveKnowledgeNote, startKnowledgeNote, updateKnowledgeEvidence,
} from '../knowledge/service.js';
import type { KnowledgePageReader } from '../knowledge/source.js';
import { savedPageCandidates } from '../og/savedPageCandidates.js';

const id = Type.String({ format: 'uuid' });
const revision = Type.Integer({ minimum: 1 });
const text = (maxLength: number) => Type.String({ maxLength, pattern: '^[^\\u0000\\uD800-\\uDFFF]*$' });
const page = { linkId: Type.Optional(id), offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 2_000_000 })) };
const candidates = Type.Object({ ...page, q: Type.Optional(text(120)) });
const drafts = Type.Object(page);
const start = Type.Object({ linkId: id, another: Type.Optional(Type.Boolean()) });
const params = Type.Object({ id });
const fields = Type.Object({
  title: text(200), bodyMarkdown: text(5000), whyItMatters: Type.Optional(text(1000)),
  tags: Type.Array(text(50), { maxItems: 12 }), includeExcerpt: Type.Boolean(),
}, { additionalProperties: false });
const save = Type.Object({ revision, fields });
const selection = { excerpt: text(300), locator: Type.Optional(text(200)) };
const evidence = Type.Union([
  Type.Object({ id, revision, mode: Type.Literal('read') }),
  Type.Object({ id, revision, mode: Type.Literal('keep') }),
  Type.Object({ id, revision, mode: Type.Literal('page'), ...selection, versionUrl: Type.Optional(text(1800)) }),
  Type.Object({ id, revision, mode: Type.Literal('quote'), ...selection, quoteId: id }),
]);
const approval = Type.Object({ id, revision });

const errors = {
  changed: [409, 'The note draft changed. Review the current version.'],
  missing: [404, 'The bookmark is no longer saved.'],
  unavailable: [422, 'The public page could not be read. Try a saved quote if available.'],
  excerpt: [422, 'The selected passage could not be found in that source.'],
  version: [422, 'That Wikipedia revision could not be verified for this article.'],
  'evidence-changed': [409, 'Replace the changed passage or keep the earlier citation before approving.'],
  incomplete: [400, 'Add a title, note body, and supporting passage before approving.'],
} as const;

function report<T extends { outcome: 'saved' | keyof typeof errors }>(reply: FastifyReply, result: T) {
  if (result.outcome === 'saved') return result;
  const [status, error] = errors[result.outcome];
  return reply.code(status).send({ error, outcome: result.outcome });
}

export async function knowledgeRoutes(app: FastifyInstance, { readPage }: { readPage: KnowledgePageReader }) {
  app.get('/review/notes/candidates', { preHandler: requireOwnerSession, schema: { querystring: candidates } },
    (req) => savedPageCandidates(app.db, req.query as Static<typeof candidates>));

  app.get('/review/notes/drafts', { preHandler: requireOwnerSession, schema: { querystring: drafts } },
    (req) => listKnowledgeNotes(app.db, req.query as Static<typeof drafts>));

  app.post('/review/notes/drafts', { preHandler: requireOwnerSession, schema: { body: start } }, async (req, reply) => {
    const { linkId, another } = req.body as Static<typeof start>;
    return report(reply, await startKnowledgeNote(app.db, linkId, Boolean(another)));
  });

  app.patch('/review/notes/drafts/:id', { preHandler: requireOwnerSession, schema: { params, body: save } }, async (req, reply) => {
    const { id } = req.params as Static<typeof params>;
    const { revision, fields } = req.body as Static<typeof save>;
    return report(reply, await saveKnowledgeNote(app.db, id, revision, fields));
  });

  app.post('/review/notes/evidence', { preHandler: requireOwnerSession, schema: { body: evidence } }, async (req, reply) => {
    const { id, revision, ...action } = req.body as Static<typeof evidence>;
    return report(reply, await updateKnowledgeEvidence(app.db, id, revision, action, readPage));
  });

  app.post('/review/notes/exports', { preHandler: requireOwnerSession, schema: { body: approval } }, async (req, reply) => {
    const { id, revision } = req.body as Static<typeof approval>;
    return report(reply, await approveKnowledgeNote(app.db, id, revision));
  });

  app.get('/review/notes/exports/:id', { preHandler: requireOwnerSession, schema: { params } }, async (req, reply) => {
    const payload = await getKnowledgeExport(app.db, (req.params as Static<typeof params>).id);
    if (!payload) return reply.code(404).send({ error: 'Note export not found.' });
    return reply.header('Cache-Control', 'no-store')
      .header('Content-Disposition', 'attachment; filename="bukmark-note.json"')
      .type('application/json').send(canonicalJson(payload) + '\n');
  });
}
