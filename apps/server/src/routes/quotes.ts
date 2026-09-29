import { Type } from '@sinclair/typebox';
import { and, desc, eq, ne, sql as dsql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { pgCode } from '../db/client.js';
import { quotes } from '../db/schema.js';
import { createQuote, normalizeText, QuoteValidationError, toQuoteDTO } from '../quotes/quoteService.js';

const QuoteDto = Type.Object({
  id: Type.String(),
  linkId: Type.Union([Type.String(), Type.Null()]),
  text: Type.String(),
  note: Type.String(),
  sourceUrl: Type.String(),
  sourceTitle: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
const ErrorBody = Type.Object({ error: Type.String() });
const CreateResult = Type.Object({
  quote: QuoteDto,
  link: Type.Object({ id: Type.String(), created: Type.Boolean() }),
});
const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

/**
 * A timestamptz as the page cursor carries it: UTC, ISO 8601, all six
 * fractional digits, made in Postgres because a JS Date keeps milliseconds only
 * and a cursor cut to the millisecond would repeat or skip rows.
 */
const cursorTime = (value: unknown) =>
  dsql<string>`to_char(${value} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Opaque to clients: base64url of "<created_at>|<id>". */
const encodeCursor = (at: string, id: string) => Buffer.from(`${at}|${id}`).toString('base64url');
function decodeCursor(raw: string): { at: string; id: string } | null {
  const m = CURSOR.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!m) return null;
  // Impossible dates (month 99, Feb 31) must not reach the Postgres cast.
  const ms = new Date(m[1]!.replace(/\d{3}Z$/, 'Z'));
  if (Number.isNaN(ms.getTime()) || ms.toISOString().slice(0, 19) !== m[1]!.slice(0, 19)) return null;
  return { at: m[1]!, id: m[2]! };
}

export async function quoteRoutes(app: FastifyInstance): Promise<void> {
  app.post('/quotes', {
    schema: {
      body: Type.Object({
        url: Type.String(),
        text: Type.String(),
        title: Type.Optional(Type.String()),
        note: Type.Optional(Type.String()),
      }),
      response: { 200: CreateResult, 201: CreateResult, 400: ErrorBody },
    },
  }, async (req, reply) => {
    try {
      const { quote, created, link } = await createQuote(req.server.db, req.server.fetchOgImage, req.body as {
        url: string; text: string; title?: string; note?: string;
      });
      return reply.code(created ? 201 : 200).send({ quote, link });
    } catch (err) {
      if (err instanceof QuoteValidationError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get('/quotes', {
    schema: {
      querystring: Type.Object({
        q: Type.Optional(Type.String()),
        linkId: Type.Optional(Type.String({ format: 'uuid' })),
        cursor: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
      }),
      response: {
        200: Type.Object({ items: Type.Array(QuoteDto), nextCursor: Type.Union([Type.String(), Type.Null()]) }),
        400: ErrorBody,
      },
    },
  }, async (req, reply) => {
    const { q, linkId, cursor, limit = 50 } = req.query as {
      q?: string; linkId?: string; cursor?: string; limit?: number;
    };

    const conds: SQL[] = [];
    if (q?.trim()) conds.push(dsql`quotes.search_tsv @@ websearch_to_tsquery('simple', ${q})`);
    if (linkId) conds.push(eq(quotes.linkId, linkId));
    if (cursor !== undefined) {
      const c = decodeCursor(cursor);
      if (!c) return reply.code(400).send({ error: 'invalid cursor' });
      conds.push(dsql`(${quotes.createdAt}, ${quotes.id}) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }

    const rows = await req.server.db
      .select({
        id: quotes.id, linkId: quotes.linkId, text: quotes.text, note: quotes.note,
        sourceUrl: quotes.sourceUrl, sourceTitle: quotes.sourceTitle,
        createdAt: quotes.createdAt, updatedAt: quotes.updatedAt,
        at: cursorTime(quotes.createdAt),
      })
      .from(quotes)
      .where(and(...conds))
      .orderBy(desc(quotes.createdAt), desc(quotes.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(({ at: _at, ...row }) => ({
        ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.at, last.id) : null,
    };
  });

  app.patch('/quotes/:id', {
    schema: {
      params: IdParams,
      body: Type.Object({ text: Type.Optional(Type.String()), note: Type.Optional(Type.String()) }),
      response: { 200: Type.Object({ quote: QuoteDto }), 400: ErrorBody, 404: ErrorBody, 409: ErrorBody },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { text, note } = req.body as { text?: string; note?: string };
    if (text === undefined && note === undefined) {
      return reply.code(400).send({ error: 'send text, note, or both' });
    }
    const { db } = req.server;

    const [existing] = await db.select().from(quotes).where(eq(quotes.id, id));
    if (!existing) return reply.code(404).send({ error: 'not found' });

    const set: { text?: string; textKey?: string; note?: string; updatedAt: SQL } = { updatedAt: dsql`now()` };
    if (note !== undefined) set.note = note;
    if (text !== undefined) {
      let norm;
      try {
        norm = normalizeText(text);
      } catch (err) {
        if (err instanceof QuoteValidationError) return reply.code(400).send({ error: err.message });
        throw err;
      }
      set.text = norm.text;
      set.textKey = norm.textKey;
      if (existing.linkId !== null) {
        const [clash] = await db.select({ id: quotes.id }).from(quotes).where(and(
          eq(quotes.linkId, existing.linkId), eq(quotes.textKey, norm.textKey), ne(quotes.id, id),
        )).limit(1);
        if (clash) return reply.code(409).send({ error: 'this page already has a quote with that text' });
      }
    }

    try {
      const [row] = await db.update(quotes).set(set).where(eq(quotes.id, id)).returning();
      if (!row) return reply.code(404).send({ error: 'not found' });
      return { quote: toQuoteDTO(row) };
    } catch (err) {
      // Lost a race against another write of the same text.
      if (pgCode(err) === '23505') {
        return reply.code(409).send({ error: 'this page already has a quote with that text' });
      }
      throw err;
    }
  });

  app.delete('/quotes/:id', {
    schema: { params: IdParams, response: { 204: Type.Null(), 404: ErrorBody } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const gone = await req.server.db.delete(quotes).where(eq(quotes.id, id)).returning({ id: quotes.id });
    if (gone.length === 0) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
