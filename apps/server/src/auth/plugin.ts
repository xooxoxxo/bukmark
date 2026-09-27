import type { FastifyReply, FastifyRequest } from 'fastify';
import { owner } from '../db/schema.js';
import { findToken, touchLastUsed } from './tokens.js';
import { SESSION_COOKIE, renewSession, resolveSession, setSessionCookie } from './sessions.js';

export type AuthContext = { kind: 'session'; idHash: string } | { kind: 'token'; tokenId: string };

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** The request's auth, for handlers inside the protected context (requireAuth has run). */
export function authOf(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new Error(`${req.routeOptions.url} is registered outside the protected context`);
  return req.auth;
}

/**
 * The token of an `Authorization: Bearer` header ('' when it carries none), or
 * null when there is no bearer header. The scheme is case-insensitive; other
 * schemes (a reverse proxy's Basic auth) are not ours and fall through.
 */
export function bearerToken(req: FastifyRequest): string | null {
  const m = /^bearer(?:\s+(.*))?$/i.exec(req.headers.authorization ?? '');
  return m ? (m[1] ?? '').trim() : null;
}

/** Origin host (port included) must equal the Host header; scheme is ignored since proxies terminate TLS. */
export function checkOrigin(req: FastifyRequest): boolean {
  const { origin, host } = req.headers;
  if (!origin || !host) return false;
  try {
    const o = new URL(origin);
    // Parsing Host with the Origin's scheme drops a default port a proxy may write out.
    return new URL(`${o.protocol}//${host}`).host === o.host;
  } catch {
    return false;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  const { db } = req.server;
  // Checked per request, not cached: the reset script deletes the owner while the
  // server keeps running, and a cache would answer differently before and after
  // the next restart. It is a primary-key read of a one-row table.
  if ((await db.select({ id: owner.id }).from(owner).limit(1)).length === 0) {
    return reply.code(401).send({ error: 'Setup required', code: 'setup_required' });
  }

  const token = bearerToken(req);
  if (token !== null) {
    const found = token ? await findToken(db, token) : null;
    if (!found) {
      return reply.code(401).send({ error: 'Invalid token', code: 'unauthenticated' });
    }
    req.auth = { kind: 'token', tokenId: found.id };
    touchLastUsed(db, found.id).catch((err: unknown) => req.log.warn({ err }, 'last_used_at update failed'));
    return undefined;
  }

  const cookie = req.cookies[SESSION_COOKIE];
  if (!cookie) {
    return reply.code(401).send({ error: 'Not authenticated', code: 'unauthenticated' });
  }
  const session = await resolveSession(db, cookie);
  if (!session) {
    reply.clearCookie(SESSION_COOKIE);
    return reply.code(401).send({ error: 'Session expired', code: 'unauthenticated' });
  }
  if (UNSAFE_METHODS.has(req.method) && !checkOrigin(req)) {
    return reply.code(403).send({ error: 'Cross-site request refused', code: 'bad_origin' });
  }

  req.auth = { kind: 'session', idHash: session.idHash };
  if (await renewSession(db, session.idHash)) setSessionCookie(req, reply, cookie);
  return undefined;
}
