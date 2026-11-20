import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDb } from './client.js';

const config = { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname };

// Early review builds created review tables before session import shipped publicly.
// Drizzle skips files older than the last applied timestamp. Only those builds
// may be missing the two released session migrations. Later review builds ran
// the very same SQL with different timestamps, so compare their SQL hashes.
async function completeEarlyReviewUpgrade(client: ReturnType<typeof getDb>['sql']) {
  const [table] = await client`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`;
  if (!table?.present) return;

  await client.begin(async tx => {
    const rows = await tx`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`;
    const migrations = readMigrationFiles(config);
    const reviewStart = migrations[14]!;
    const earlyReview = rows.some(row => Number(row.created_at) === reviewStart.folderMillis && row.hash === reviewStart.hash);
    if (!earlyReview) return;

    const applied = new Set(rows.map(row => row.hash));
    for (const session of migrations.slice(12, 14)) {
      if (applied.has(session.hash)) continue;
      for (const statement of session.sql) await tx.unsafe(statement);
      await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${session.hash}, ${session.folderMillis})`;
    }
  });
}

export async function runMigrations(url?: string): Promise<void> {
  const { db, sql } = getDb(url);
  try {
    // A second app starting against the same database must wait for both phases.
    // The separate lock connection lets Drizzle own its normal transaction.
    await sql.begin(async lock => {
      await lock`SELECT pg_advisory_xact_lock(hashtext('bukmark.schema.migrations'))`;
      await completeEarlyReviewUpgrade(sql);
      await migrate(db, config);
    });
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  await runMigrations();
  console.log('migrations applied');
}
