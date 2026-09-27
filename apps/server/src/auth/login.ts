import type { FastifyReply, FastifyRequest } from 'fastify';
import { owner } from '../db/schema.js';
import { verifyPassword } from './crypto.js';
import { cleanupExpiredSessions, startSession } from './sessions.js';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

/**
 * Length in code points, the unit JSON Schema's minLength/maxLength use. String
 * .length counts UTF-16 units, so an emoji would count once at setup and twice
 * at login, and a password setup accepted could then never be used to log in.
 */
export function passwordLength(password: string): number {
  return [...password].length;
}

export function isAcceptablePassword(password: unknown): password is string {
  if (typeof password !== 'string') return false;
  const n = passwordLength(password);
  return n >= MIN_PASSWORD_LENGTH && n <= MAX_PASSWORD_LENGTH;
}

export type LoginResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: 'setup_required' | 'bad_password' }
  | { ok: false; reason: 'rate_limited'; retryAfter: number };

/** Password sign-in for both /api/auth/login and /authorize; on success the session cookie is set on `reply`. */
export async function attemptLogin(req: FastifyRequest, reply: FastifyReply, password: unknown): Promise<LoginResult> {
  const { db, rateLimiter } = req.server;
  const [row] = await db.select({ passwordHash: owner.passwordHash }).from(owner).limit(1);
  if (!row) return { ok: false, reason: 'setup_required' };

  const limit = rateLimiter.check(req.ip, 'login');
  if (!limit.allowed) return { ok: false, reason: 'rate_limited', retryAfter: limit.retryAfter };

  const valid = typeof password === 'string'
    && password.length > 0
    && passwordLength(password) <= MAX_PASSWORD_LENGTH
    && await verifyPassword(password, row.passwordHash);
  if (!valid) return { ok: false, reason: 'bad_password' };

  rateLimiter.reset(req.ip, 'login');
  await cleanupExpiredSessions(db);
  return { ok: true, sessionId: await startSession(req, reply) };
}
