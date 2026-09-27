import { Type } from '@sinclair/typebox';
import { and, eq, isNull, sql as dsql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { owner, authCodes } from '../db/schema.js';
import { hashPassword, sha256hex, safeEqualString, pkceS256 } from './crypto.js';
import { SESSION_COOKIE, resolveSession, startSession } from './sessions.js';
import { createAccessToken, deleteStaleAuthCodes, findToken } from './tokens.js';
import { bearerToken, checkOrigin } from './plugin.js';
import { attemptLogin, isAcceptablePassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './login.js';

const CROSS_SITE = { error: 'Cross-site request refused', code: 'bad_origin' } as const;
const INVALID_GRANT = { error: 'Invalid or expired authorization code', code: 'invalid_grant' } as const;

function rateLimited(reply: FastifyReply, error: string, retryAfter: number): FastifyReply {
  return reply.code(429).header('Retry-After', retryAfter).send({ error, code: 'rate_limited', retryAfter });
}

const TokenBody = Type.Object({
  grant_type: Type.Literal('authorization_code'),
  code: Type.String(),
  code_verifier: Type.String({ pattern: '^[A-Za-z0-9._~-]{43,128}$' }),
  redirect_uri: Type.String(),
});

export async function publicAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/status', {
    schema: {
      response: {
        200: Type.Object({
          setupComplete: Type.Boolean(),
          authenticated: Type.Boolean(),
        }),
      },
    },
  }, async (req) => {
    const { db } = req.server;
    const setupComplete = (await db.select({ id: owner.id }).from(owner).limit(1)).length > 0;

    let authenticated = false;
    const token = bearerToken(req);
    if (token !== null) {
      authenticated = token !== '' && (await findToken(db, token)) !== null;
    } else {
      const cookie = req.cookies[SESSION_COOKIE];
      authenticated = !!cookie && (await resolveSession(db, cookie)) !== null;
    }

    return { setupComplete, authenticated };
  });

  app.post('/setup', {
    schema: {
      body: Type.Object({ password: Type.String() }),
      response: {
        201: Type.Object({ ok: Type.Boolean() }),
        400: Type.Object({ error: Type.String(), code: Type.String() }),
        409: Type.Object({ error: Type.String(), code: Type.String() }),
      },
    },
    // Validated in the handler so the UI gets a sentence, not a bare "Bad Request".
    attachValidation: true,
  }, async (req: FastifyRequest<{ Body: { password: string } }>, reply: FastifyReply) => {
    if (!checkOrigin(req)) return reply.code(403).send(CROSS_SITE);
    if (req.validationError || !isAcceptablePassword(req.body?.password)) {
      return reply.code(400).send({
        error: `Password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`,
        code: 'invalid_password',
      });
    }

    const limit = req.server.rateLimiter.check(req.ip, 'setup');
    if (!limit.allowed) return rateLimited(reply, 'Too many setup attempts', limit.retryAfter);

    const alreadySetUp = { error: 'Setup already complete', code: 'already_setup' };
    // Skips the hash once set up; the ON CONFLICT insert below stays the authority.
    if ((await req.server.db.select({ id: owner.id }).from(owner).limit(1)).length > 0) {
      return reply.code(409).send(alreadySetUp);
    }
    const inserted = await req.server.db.insert(owner).values({
      passwordHash: await hashPassword(req.body.password),
    }).onConflictDoNothing().returning({ id: owner.id });
    if (inserted.length === 0) return reply.code(409).send(alreadySetUp);

    await startSession(req, reply);
    return reply.code(201).send({ ok: true });
  });

  app.post('/login', {
    schema: {
      body: Type.Object({
        password: Type.String({ maxLength: MAX_PASSWORD_LENGTH }),
      }),
      response: {
        200: Type.Object({ ok: Type.Boolean() }),
        401: Type.Object({ error: Type.String(), code: Type.String() }),
        409: Type.Object({ error: Type.String(), code: Type.String() }),
      },
    },
  }, async (req: FastifyRequest<{ Body: { password: string } }>, reply: FastifyReply) => {
    if (!checkOrigin(req)) return reply.code(403).send(CROSS_SITE);

    const result = await attemptLogin(req, reply, req.body.password);
    if (result.ok) return reply.code(200).send({ ok: true });
    switch (result.reason) {
      case 'setup_required': return reply.code(409).send({ error: 'Setup required', code: 'setup_required' });
      case 'rate_limited': return rateLimited(reply, 'Too many login attempts', result.retryAfter);
      case 'bad_password': return reply.code(401).send({ error: 'Wrong password', code: 'bad_password' });
    }
  });

  app.post('/token', {
    schema: {
      body: TokenBody,
      response: {
        200: Type.Object({
          token: Type.String(),
          tokenId: Type.String(),
          name: Type.String(),
        }),
        400: Type.Object({ error: Type.String(), code: Type.String() }),
      },
    },
    // A malformed request gets the same answer as a bad code: no oracle.
    attachValidation: true,
  }, async (req: FastifyRequest<{ Body: { code: string; code_verifier: string; redirect_uri: string } }>, reply: FastifyReply) => {
    const { db } = req.server;
    const limit = req.server.rateLimiter.check(req.ip, 'token');
    if (!limit.allowed) return rateLimited(reply, 'Too many token exchange attempts', limit.retryAfter);

    await deleteStaleAuthCodes(db);
    if (req.validationError) return reply.code(400).send(INVALID_GRANT);

    const { code, code_verifier, redirect_uri } = req.body;
    // Claiming burns the code even if the checks below fail: it was presented.
    const [claimed] = await db.update(authCodes)
      .set({ usedAt: dsql`now()` })
      .where(and(
        eq(authCodes.codeHash, sha256hex(code)),
        isNull(authCodes.usedAt),
        dsql`${authCodes.expiresAt} > now()`,
      ))
      .returning();
    if (!claimed
      || claimed.redirectUri !== redirect_uri
      || !safeEqualString(pkceS256(code_verifier), claimed.codeChallenge)) {
      return reply.code(400).send(INVALID_GRANT);
    }

    const token = await createAccessToken(db, claimed.clientName);
    return reply.code(200).send({ token: token.token, tokenId: token.id, name: token.name });
  });
}
