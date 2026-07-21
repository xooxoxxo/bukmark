import { sql } from 'drizzle-orm';
import {
  boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

export const links = pgTable('links', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  url: text('url').notNull(),
  urlHash: text('url_hash').notNull(),
  title: text('title').notNull().default(''),
  note: text('note').notNull().default(''),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  junkRule: text('junk_rule'),
  relevance: integer('relevance'),
  dupeCount: integer('dupe_count').notNull().default(1),
  imageUrl: text('image_url'),
  ogFetchedAt: timestamp('og_fetched_at', { withTimezone: true }),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('links_url_hash_uq').on(t.urlHash),
  index('links_status_idx').on(t.status),
]);

export const captures = pgTable('captures', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  linkId: uuid('link_id').notNull().references(() => links.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  originalUrl: text('original_url').notNull().default(''),
  originalTitle: text('original_title').notNull().default(''),
  groupHint: text('group_hint'),
  raw: jsonb('raw'),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('captures_link_idx').on(t.linkId)]);

export const hubs = pgTable('hubs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  status: text('status', { enum: ['active', 'dormant', 'archived'] }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('hubs_name_uq').on(t.name)]);

export const hubLinks = pgTable('hub_links', {
  hubId: uuid('hub_id').notNull().references(() => hubs.id, { onDelete: 'cascade' }),
  linkId: uuid('link_id').notNull().references(() => links.id, { onDelete: 'cascade' }),
  relevance: real('relevance'),
  assignedBy: text('assigned_by', { enum: ['user', 'auto'] }).notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.hubId, t.linkId] })]);

export const importJobs = pgTable('import_jobs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  source: text('source').notNull(),
  filename: text('filename').notNull().default(''),
  fileSha256: text('file_sha256').notNull(),
  status: text('status', { enum: ['pending', 'running', 'completed', 'failed'] }).notNull().default('pending'),
  totalItems: integer('total_items').notNull().default(0),
  processedItems: integer('processed_items').notNull().default(0),
  errors: jsonb('errors'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deletedHashes = pgTable('deleted_hashes', {
  urlHash: text('url_hash').primaryKey(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
});
