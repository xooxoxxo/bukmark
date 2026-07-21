import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDb } from './client.js';

export async function runMigrations(url?: string): Promise<void> {
  const { db, sql } = getDb(url);
  await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  await sql.end();
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  await runMigrations();
  console.log('migrations applied');
}
