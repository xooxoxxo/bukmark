import { Type } from '@sinclair/typebox';
import { sql as dsql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { apiTokens } from '../db/schema.js';
import { SESSION_COOKIE, deleteSession } from './sessions.js';
import { createAccessToken, listTokens, deleteToken } from './tokens.js';
import { authOf } from './plugin.js';

// No 401 response schemas here: requireAuth's 401 would be serialized through
// them and lose its `code`.
export async function protectedAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/logout', {
    schema: {
      response: {
        200: Type.Object({ ok: Type.Boolean() }),
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = authOf(req);
    if (auth.kind === 'session') {
      await deleteSession(req.server.db, auth.idHash);
      reply.clearCookie(SESSION_COOKIE);
    } else {
      await deleteToken(req.server.db, auth.tokenId);
    }

    reply.code(200).send({ ok: true });
  });

  app.get('/tokens', {
    schema: {
      response: {
        200: Type.Object({
          items: Type.Array(Type.Object({
            id: Type.String(),
            name: Type.String(),
            prefix: Type.String(),
            createdAt: Type.String(),
            lastUsedAt: Type.Union([Type.String(), Type.Null()]),
            current: Type.Boolean(),
          })),
        }),
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = authOf(req);
    const tokens = await listTokens(req.server.db);
    const currentTokenId = auth.kind === 'token' ? auth.tokenId : null;
    const items = tokens.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      createdAt: t.createdAt.toISOString(),
      lastUsedAt: t.lastUsedAt?.toISOString() || null,
      current: currentTokenId === t.id,
    }));

    reply.code(200).send({ items });
  });

  app.post('/tokens', {
    schema: {
      body: Type.Object({ name: Type.String() }),
      response: {
        201: Type.Object({
          id: Type.String(),
          name: Type.String(),
          prefix: Type.String(),
          createdAt: Type.String(),
          token: Type.String(),
        }),
        400: Type.Object({ error: Type.String(), code: Type.String() }),
        409: Type.Object({ error: Type.String(), code: Type.String() }),
      },
    },
    // Trimmed before the length check, so validation lives in the handler.
    attachValidation: true,
  }, async (req: FastifyRequest<{ Body: { name: string } }>, reply: FastifyReply) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const length = [...name].length;
    if (req.validationError || length === 0 || length > 100) {
      reply.code(400).send({ error: 'Token name must be 1 to 100 characters.', code: 'invalid_name' });
      return;
    }

    const tokenCount = await req.server.db.select({ count: dsql<number>`count(*)::int` }).from(apiTokens);
    if ((tokenCount[0]?.count ?? 0) >= 50) {
      reply.code(409).send({ error: 'Too many tokens', code: 'too_many_tokens' });
      return;
    }

    const token = await createAccessToken(req.server.db, name);

    reply.code(201).send({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      createdAt: token.createdAt.toISOString(),
      token: token.token,
    });
  });

  app.delete('/tokens/:id', {
    schema: {
      params: Type.Object({
        id: Type.String({ format: 'uuid' }),
      }),
      response: {
        200: Type.Object({ ok: Type.Boolean() }),
        404: Type.Object({ error: Type.String() }),
      },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const deleted = await deleteToken(req.server.db, req.params.id);
    if (!deleted) {
      reply.code(404).send({ error: 'Token not found' });
      return;
    }

    reply.code(200).send({ ok: true });
  });
}
