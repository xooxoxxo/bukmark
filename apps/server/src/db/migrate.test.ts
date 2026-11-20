import { randomUUID } from 'node:crypto';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { expect, it } from 'vitest';
import { getDb } from './client.js';
import { runMigrations } from './migrate.js';

const testUrl = process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const migrations = readMigrationFiles({ migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });

it.each(['public release', 'early review build'] as const)('upgrades the %s without repeating SQL on retry', async lineage => {
  const admin = getDb(testUrl).sql;
  const name = 'bukmark_upgrade_' + randomUUID().replaceAll('-', '');
  const url = new URL(testUrl);
  url.pathname = '/' + name;
  try {
    await admin`CREATE DATABASE ${admin(name)}`;
    const db = getDb(url.href).sql;
    try {
      // The first 12 migrations are shared. The public release added sessions next.
      // The early review build instead applied review tables (now at indices 14–18).
      const baseline = lineage === 'public release' ? migrations.slice(0, 14)
        : [...migrations.slice(0, 12), ...migrations.slice(14, 19)];
      await db.begin(async tx => {
        await tx`CREATE SCHEMA drizzle`;
        await tx`CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
        for (const file of baseline) {
          for (const statement of file.sql) await tx.unsafe(statement);
          await tx`INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES (${file.hash},${file.folderMillis})`;
        }
        await tx`INSERT INTO links (url,url_hash,title) VALUES ('https://example.org/guide','test-hash','My guide')`;
      });
      await Promise.all([runMigrations(url.href), runMigrations(url.href)]);
      const receipt = () => db`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
      const after = await receipt();
      expect(after.map(row => row.hash).sort()).toEqual(migrations.map(file => file.hash).sort());
      expect(after.slice(0, baseline.length).map(row => row.hash)).toEqual(baseline.map(file => file.hash));
      expect(await db`SELECT title, session_protected FROM links WHERE url_hash='test-hash'`)
        .toMatchObject([{ title: 'My guide', session_protected: false }]);
      await runMigrations(url.href);
      expect(await receipt()).toEqual(after);
    } finally {
      await db.end();
      await admin`DROP DATABASE ${admin(name)}`;
    }
  } finally {
    await admin.end();
  }
});
