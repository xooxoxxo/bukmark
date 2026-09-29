import { sql } from 'drizzle-orm';
import {
  boolean, check, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

export const links = pgTable('links', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  url: text('url').notNull(),
  urlHash: text('url_hash').notNull(),
  matchKey: text('match_key'),
  title: text('title').notNull().default(''),
  note: text('note').notNull().default(''),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  junkRule: text('junk_rule'),
  relevance: integer('relevance'),
  dupeCount: integer('dupe_count').notNull().default(1),
  imageUrl: text('image_url'),
  ogFetchedAt: timestamp('og_fetched_at', { withTimezone: true }),
  /** The page's readable text, from its last check: searched, and kept as a copy. */
  contentText: text('content_text'),
  /** The last check's final HTTP status; null when no response came. */
  httpStatus: integer('http_status'),
  /** Why the last check got no response: 'dns', 'timeout', 'blocked', 'network', 'redirects'. */
  checkError: text('check_error'),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('links_url_hash_uq').on(t.urlHash),
  index('links_status_idx').on(t.status),
  index('links_checked_at_idx').on(t.checkedAt),
  index('links_match_key_idx').on(t.matchKey),
  // The sync feed reads links in (updated_at, id) order from a cursor.
  index('links_updated_at_idx').on(t.updatedAt, t.id),
]);

/**
 * Links deleted for good, so a sync client that last pulled before the delete
 * learns to drop them. Written by a trigger on links (drizzle/0008), not by app code.
 */
export const linkDeletions = pgTable('link_deletions', {
  linkId: uuid('link_id').primaryKey(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('link_deletions_deleted_at_idx').on(t.deletedAt)]);

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

/**
 * Passages saved from pages. link_id goes null when the link is deleted; the
 * source_url/source_title copy keeps the quote readable. Beyond what drizzle
 * expresses, drizzle/0010 adds search_tsv (generated from text and note, like
 * links.search_tsv) and its GIN index.
 */
export const quotes = pgTable('quotes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  linkId: uuid('link_id').references(() => links.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  textKey: text('text_key').notNull(),
  note: text('note').notNull().default(''),
  sourceUrl: text('source_url').notNull(),
  sourceTitle: text('source_title').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('quotes_link_idx').on(t.linkId),
  uniqueIndex('quotes_link_text_key_uq').on(t.linkId, t.textKey).where(sql`${t.linkId} is not null`),
  index('quotes_created_at_idx').on(t.createdAt.desc(), t.id),
]);

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

export const owner = pgTable('owner', {
  id: integer('id').primaryKey().default(1),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check('owner_single_row', sql`${t.id} = 1`)]);

export const sessions = pgTable('sessions', {
  idHash: text('id_hash').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  renewedAt: timestamp('renewed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
});

export const authCodes = pgTable('auth_codes', {
  codeHash: text('code_hash').primaryKey(),
  codeChallenge: text('code_challenge').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  clientName: text('client_name').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});
