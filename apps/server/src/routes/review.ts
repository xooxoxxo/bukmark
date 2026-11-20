import type { FastifyInstance } from 'fastify';
import { Type, type Static } from 'typebox';
import { requireOwnerSession } from '../auth/plugin.js';
import { reviewActions } from '../review/model.js';
import type { AzukClient } from '../azuk/client.js';
import { listAzukDeliveries, refreshAzukDelivery, retryAzukDelivery } from '../azuk/delivery.js';
import {
  decideReviews, prepareReviews, proposeReviews, reviewCandidates, reviewQueue, REVIEW_BATCH_LIMIT,
} from '../review/service.js';

const id = Type.String({ format: 'uuid' });
const version = Type.String({ pattern: '^[a-f0-9]{64}$' });
const limit = Type.Integer({ minimum: 1, maximum: REVIEW_BATCH_LIMIT });
const offset = Type.Integer({ minimum: 0 });
const text = (maxLength: number) => Type.String({ maxLength, pattern: '^[^\\u0000]*$' });
const draft = Type.Object({
  action: Type.Union(reviewActions.map((action) => Type.Literal(action))),
  hub: Type.Optional(text(120)),
  nextStep: Type.Optional(text(1000)),
});
const candidates = Type.Object({ linkId: Type.Optional(id), limit: Type.Optional(limit), offset: Type.Optional(offset) });
const queue = Type.Object({
  linkId: Type.Optional(id),
  state: Type.Optional(Type.Union([Type.Literal('pending'), Type.Literal('deferred'), Type.Literal('decided')])),
  offset: Type.Optional(offset),
});
const prepare = Type.Object({ linkId: Type.Optional(id), limit: Type.Optional(limit) });
const proposals = Type.Object({
  items: Type.Array(Type.Object({
    linkId: id,
    sourceVersion: version,
    draft,
    reason: Type.String({ minLength: 1, maxLength: 1000, pattern: '^[^\\u0000]*[^\\s\\u0000][^\\u0000]*$' }),
  }), { minItems: 1, maxItems: REVIEW_BATCH_LIMIT }),
});
const decisions = Type.Object({
  items: Type.Array(Type.Object({
    id,
    revision: Type.Integer({ minimum: 1 }),
    sourceVersion: version,
    decision: Type.Union([
      Type.Literal('approve'), Type.Literal('edit'), Type.Literal('defer'), Type.Literal('dismiss'), Type.Literal('resume'),
    ]),
    draft: Type.Optional(draft),
    azuk: Type.Optional(Type.Object({
      connection: version, listId: id, listName: text(200), listingUrl: text(500), productName: text(160),
      target: Type.Optional(Type.Object({
        price: Type.String({ pattern: '^\\d{1,8}(?:\\.\\d{1,2})?$' }),
        currency: Type.String({ pattern: '^[A-Z]{3}$' }),
      })),
    })),
  }), { minItems: 1, maxItems: REVIEW_BATCH_LIMIT }),
});

export async function reviewRoutes(app: FastifyInstance, { azuk }: { azuk?: AzukClient }) {
  app.get('/review', { schema: { querystring: queue } }, (req) => {
    const query = req.query as Static<typeof queue>;
    return reviewQueue(app.db, { ...query, state: query.state ?? 'pending' });
  });

  app.get('/review/candidates', { schema: { querystring: candidates } }, (req) =>
    reviewCandidates(app.db, req.query as Static<typeof candidates>));

  app.post('/review/prepare', { schema: { body: prepare } }, (req) => {
    const body = req.body as Static<typeof prepare>;
    return prepareReviews(app.db, body.linkId, body.limit);
  });

  app.post('/review/proposals', { schema: { body: proposals } }, (req) =>
    proposeReviews(app.db, (req.body as Static<typeof proposals>).items));

  app.post('/review/decisions', { preHandler: requireOwnerSession, schema: { body: decisions } }, (req) =>
    decideReviews(app.db, (req.body as Static<typeof decisions>).items, azuk));

  app.get('/review/azuk/lists', { preHandler: requireOwnerSession }, async () => {
    if (!azuk) return { status: 'disabled' };
    try {
      const lists = await azuk.lists();
      if (!Array.isArray(lists)) return { status: 'unavailable' };
      return { status: 'ready', connection: azuk.connection, lists };
    } catch {
      return { status: 'unavailable' };
    }
  });

  app.get('/review/azuk/deliveries', {
    preHandler: requireOwnerSession,
    schema: { querystring: Type.Object({ linkId: Type.Optional(id), offset: Type.Optional(offset) }) },
  }, (req) => {
    const { linkId, offset } = req.query as { linkId?: string; offset?: number };
    return listAzukDeliveries(app.db, azuk, linkId, offset);
  });

  app.post('/review/azuk/deliveries/:id/retry', {
    preHandler: requireOwnerSession, schema: { params: Type.Object({ id }) },
  }, (req) => retryAzukDelivery(app.db, azuk, (req.params as { id: string }).id));

  app.post('/review/azuk/deliveries/:id/refresh', {
    preHandler: requireOwnerSession, schema: { params: Type.Object({ id }) },
  }, (req) => refreshAzukDelivery(app.db, azuk, (req.params as { id: string }).id));
}
