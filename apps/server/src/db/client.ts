import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

export function getDb(url: string = config.databaseUrl) {
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  return { db: drizzle(sql, { schema }), sql };
}
export type Db = ReturnType<typeof getDb>['db'];

/** The SQLSTATE of a failed query, whether the driver's error arrives bare or wrapped. */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = typeof e?.code === 'string' ? e.code : e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}
