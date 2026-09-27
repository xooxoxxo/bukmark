import { and, desc, eq, sql as dsql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiTokens, authCodes } from '../db/schema.js';
import { randomToken, sha256hex } from './crypto.js';

export async function createAccessToken(
  db: Db,
  name: string,
): Promise<{ id: string; token: string; prefix: string; name: string; createdAt: Date }> {
  const token = `bkm_${randomToken(32)}`;
  const prefix = token.slice(0, 12);
  const [row] = await db.insert(apiTokens).values({
    name,
    tokenHash: sha256hex(token),
    prefix,
  }).returning({ id: apiTokens.id, createdAt: apiTokens.createdAt });

  return { id: row!.id, token, prefix, name, createdAt: row!.createdAt };
}

export async function findToken(db: Db, token: string): Promise<{ id: string; name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null } | null> {
  const tokenHash = sha256hex(token);
  const rows = await db.select({
    id: apiTokens.id,
    name: apiTokens.name,
    prefix: apiTokens.prefix,
    createdAt: apiTokens.createdAt,
    lastUsedAt: apiTokens.lastUsedAt,
  }).from(apiTokens).where(eq(apiTokens.tokenHash, tokenHash)).limit(1);

  return rows.length ? rows[0]! : null;
}

export async function listTokens(db: Db): Promise<Array<{ id: string; name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null }>> {
  return db.select({
    id: apiTokens.id,
    name: apiTokens.name,
    prefix: apiTokens.prefix,
    createdAt: apiTokens.createdAt,
    lastUsedAt: apiTokens.lastUsedAt,
  }).from(apiTokens).orderBy(desc(apiTokens.createdAt));
}

export async function deleteToken(db: Db, id: string): Promise<boolean> {
  try {
    const result = await db.delete(apiTokens).where(eq(apiTokens.id, id)).returning();
    return result.length > 0;
  } catch {
    return false;
  }
}

/** Records use at most once an hour, so a busy client does not write on every request. */
export async function touchLastUsed(db: Db, id: string): Promise<void> {
  await db.update(apiTokens)
    .set({ lastUsedAt: dsql`now()` })
    .where(and(
      eq(apiTokens.id, id),
      dsql`(${apiTokens.lastUsedAt} IS NULL OR ${apiTokens.lastUsedAt} < now() - interval '1 hour')`,
    ));
}

export async function deleteStaleAuthCodes(db: Db): Promise<void> {
  await db.delete(authCodes).where(dsql`${authCodes.expiresAt} < now() - interval '1 hour'`);
}
