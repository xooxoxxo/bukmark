import { readFileSync } from 'node:fs';
import type { Store } from '@bookmarkt/shared';
import { getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { importStore } from './storeImport.js';

const storePath = process.argv[2] ?? '../../data/store.json';
const store = JSON.parse(readFileSync(storePath, 'utf8')) as Store;
await runMigrations();
const { db, sql } = getDb();
const r = await importStore(db, store);
console.log(JSON.stringify(r));
await sql.end();
