import { and, eq, sql as dsql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { sessions } from '../db/schema.js';
import { randomToken, sha256hex } from './crypto.js';

export const SESSION_COOKIE = 'bukmark_session';

export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60,
    // Never forced: browsers drop Secure cookies set over plain http.
    secure: req.protocol === 'https',
  });
}

export async function createSession(db: Db): Promise<{ sessionId: string; expiresAt: Date }> {
  const sessionId = randomToken(32);
  const [row] = await db.insert(sessions).values({
    idHash: sha256hex(sessionId),
    expiresAt: dsql`now() + interval '30 days'`,
  }).returning({ expiresAt: sessions.expiresAt });
  return { sessionId, expiresAt: row!.expiresAt };
}

export async function startSession(req: FastifyRequest, reply: FastifyReply): Promise<string> {
  const { sessionId } = await createSession(req.server.db);
  setSessionCookie(req, reply, sessionId);
  return sessionId;
}

export async function resolveSession(db: Db, sessionId: string): Promise<{ idHash: string } | null> {
  const [row] = await db.select({ idHash: sessions.idHash }).from(sessions)
    .where(and(eq(sessions.idHash, sha256hex(sessionId)), dsql`${sessions.expiresAt} > now()`))
    .limit(1);
  return row ?? null;
}

/** Slides the expiry at most once per 24 h; true when it did (the caller re-sets the cookie). */
export async function renewSession(db: Db, idHash: string): Promise<boolean> {
  const rows = await db.update(sessions)
    .set({ expiresAt: dsql`now() + interval '30 days'`, renewedAt: dsql`now()` })
    .where(and(eq(sessions.idHash, idHash), dsql`${sessions.renewedAt} < now() - interval '24 hours'`))
    .returning({ idHash: sessions.idHash });
  return rows.length > 0;
}

export async function deleteSession(db: Db, idHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.idHash, idHash));
}

export async function cleanupExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(dsql`${sessions.expiresAt} < now()`);
}
