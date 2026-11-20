import { sql } from 'drizzle-orm';
import {
  boolean, check, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import type { ReviewDraft, ReviewState } from '../review/model.js';
import type { WatchTrigger } from '../azuk/client.js';
import type { DeliveryStatus, DeliveryStep, WatchReceipt } from '../azuk/model.js';
import type { BuilderEdits, BuilderRecord } from '../builder/model.js';
import type { KnowledgeEvidence, KnowledgeExport, KnowledgeFields, RecipeDraftData, RecipeExport } from '@bukmark/shared/review';
import type { KnowledgeMismatch } from '../knowledge/service.js';
import type { RecipeEdits } from '../recipe/service.js';
import type { SiftBaselineInput, SiftComputed } from '@bukmark/shared/review';
import type { SiftGuard, SiftRules } from '../sift/historyModel.js';
import type { SiftApplicationEntry, SiftTarget } from '../sift/applyModel.js';

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
  sessionProtected: boolean('session_protected').notNull().default(false),
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
  // Match keys can include long URL paths and are only queried for equality.
  index('links_match_key_idx').using('hash', t.matchKey),
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
  sessionOccurrenceKey: text('session_occurrence_key'),
  raw: jsonb('raw'),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('captures_link_idx').on(t.linkId), uniqueIndex('captures_session_occurrence_uq').on(t.sessionOccurrenceKey)]);

export const reviewProposals = pgTable('review_proposals', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  linkId: uuid('link_id').notNull().references(() => links.id, { onDelete: 'cascade' }),
  draft: jsonb('draft').$type<ReviewDraft>().notNull(),
  reason: text('reason').notNull(),
  origin: text('origin', { enum: ['rule', 'assistant', 'owner'] }).notNull(),
  status: text('status').$type<ReviewState>().notNull().default('pending'),
  revision: integer('revision').notNull().default(1),
  sourceVersion: text('source_version').notNull(),
  inputKey: text('input_key').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('review_proposals_link_uq').on(t.linkId),
  index('review_proposals_queue_idx').on(t.status, t.updatedAt, t.id),
]);

export const azukDeliveries = pgTable('azuk_deliveries', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  // Keep the receipt after the source link or review is deleted.
  linkId: uuid('link_id').notNull(),
  proposalId: uuid('proposal_id').notNull(),
  revision: integer('revision').notNull(),
  connection: text('connection').notNull(),
  listId: uuid('list_id').notNull(),
  listName: text('list_name').notNull(),
  listingUrl: text('listing_url').notNull(),
  productName: text('product_name').notNull(),
  trigger: jsonb('trigger').$type<WatchTrigger>().notNull(),
  status: text('status').$type<DeliveryStatus>().notNull().default('queued'),
  itemId: uuid('item_id'),
  watchId: uuid('watch_id'),
  watch: jsonb('watch').$type<WatchReceipt>(),
  error: text('error'),
  pendingStep: text('pending_step').$type<DeliveryStep>(),
  claim: uuid('claim'),
  claimUntil: timestamp('claim_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('azuk_deliveries_destination_uq').on(t.connection, t.listId, t.listingUrl),
  index('azuk_deliveries_queue_idx').on(t.connection, t.status, t.updatedAt),
]);

export const builderDrafts = pgTable('builder_drafts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  key: text('key').notNull(),
  record: jsonb('record').$type<BuilderRecord>().notNull(),
  edits: jsonb('edits').$type<BuilderEdits>().notNull().default({}),
  revision: integer('revision').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('builder_drafts_key_uq').on(t.key),
  index('builder_drafts_queue_idx').on(t.updatedAt, t.id),
]);

export const builderDraftSources = pgTable('builder_draft_sources', {
  draftId: uuid('draft_id').notNull().references(() => builderDrafts.id, { onDelete: 'cascade' }),
  linkId: uuid('link_id').notNull().references(() => links.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.draftId, t.linkId] }),
  index('builder_draft_sources_link_idx').on(t.linkId),
]);

export const builderExports = pgTable('builder_exports', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  key: text('key').notNull(),
  revisions: jsonb('revisions').$type<{ id: string; revision: number }[]>().notNull(),
  records: jsonb('records').$type<BuilderRecord[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('builder_exports_key_uq').on(t.key)]);

export const recipeDrafts = pgTable('recipe_drafts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  key: text('key').notNull(),
  data: jsonb('data').$type<RecipeDraftData>().notNull(),
  edits: jsonb('edits').$type<RecipeEdits>().notNull().default({}),
  selectedVariations: jsonb('selected_variations').$type<string[]>().notNull().default([]),
  reviewedUnassigned: boolean('reviewed_unassigned').notNull().default(false),
  revision: integer('revision').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('recipe_drafts_key_uq').on(t.key),
  index('recipe_drafts_queue_idx').on(t.updatedAt, t.id),
]);

export const recipeDraftSources = pgTable('recipe_draft_sources', {
  draftId: uuid('draft_id').notNull().references(() => recipeDrafts.id, { onDelete: 'cascade' }),
  linkId: uuid('link_id').notNull().references(() => links.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.draftId, t.linkId] }),
  index('recipe_draft_sources_link_idx').on(t.linkId),
]);

export const recipeExports = pgTable('recipe_exports', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  draftId: uuid('draft_id').notNull(),
  revision: integer('revision').notNull(),
  requestKey: text('request_key').notNull(),
  payload: jsonb('payload').$type<RecipeExport>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('recipe_exports_revision_uq').on(t.draftId, t.revision),
  uniqueIndex('recipe_exports_request_key_uq').on(t.requestKey),
]);

export const knowledgeNotes = pgTable('knowledge_notes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  linkId: uuid('link_id').references(() => links.id, { onDelete: 'set null' }),
  savedUrl: text('saved_url').notNull(),
  fields: jsonb('fields').$type<KnowledgeFields>().notNull(),
  evidence: jsonb('evidence').$type<KnowledgeEvidence>(),
  mismatch: jsonb('mismatch').$type<KnowledgeMismatch>(),
  revision: integer('revision').notNull().default(1),
  approvedRevision: integer('approved_revision').notNull().default(0),
  latestExportId: uuid('latest_export_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('knowledge_notes_link_idx').on(t.linkId),
  index('knowledge_notes_queue_idx').on(t.updatedAt, t.id),
]);

export const knowledgeExports = pgTable('knowledge_exports', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  noteId: uuid('note_id').notNull(),
  draftRevision: integer('draft_revision').notNull(),
  payload: jsonb('payload').$type<KnowledgeExport>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('knowledge_exports_revision_uq').on(t.noteId, t.draftRevision)]);

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

export const siftBaselines = pgTable('sift_baselines', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  key: text('key').notNull(),
  reference: text('reference').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
  manifest: jsonb('manifest').$type<SiftBaselineInput>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('sift_baselines_key_uq').on(t.key)]);

/** Existing owner choices, recorded without changing their source memberships. */
export const siftDecisions = pgTable('sift_decisions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  linkId: uuid('link_id').notNull(),
  baselineId: uuid('baseline_id').references(() => siftBaselines.id),
  applicationId: uuid('application_id').references(() => siftApplications.id),
  field: text('field').notNull().default('bin'),
  hubId: uuid('hub_id').notNull(),
  bin: text('bin').notNull(),
  membershipCreatedAt: text('membership_created_at').notNull(),
  revision: integer('revision').notNull().default(1),
}, (t) => [uniqueIndex('sift_decisions_source_field_uq').on(t.linkId, t.field),
  check('sift_decisions_one_approval', sql`num_nonnulls(${t.baselineId}, ${t.applicationId}) = 1`)]);

export const siftResults = pgTable('sift_results', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  key: text('key').notNull(),
  input: jsonb('input').$type<{ url: string; title: string; status: 'active' | 'archived'; pageText?: string }>().notNull(),
  rulesDigest: text('rules_digest').notNull(),
  computed: jsonb('computed').$type<SiftComputed>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('sift_results_key_uq').on(t.key)]);

export const siftRuns = pgTable('sift_runs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  key: text('key').notNull(),
  scopeKey: text('scope_key').notNull(),
  sourceIds: jsonb('source_ids').$type<string[]>().notNull(),
  rules: jsonb('rules').$type<SiftRules>().notNull(),
  digest: text('digest').notNull(),
  previousRunId: uuid('previous_run_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('sift_runs_key_uq').on(t.key), index('sift_runs_history_idx').on(t.createdAt, t.id)]);

export const siftRunItems = pgTable('sift_run_items', {
  runId: uuid('run_id').notNull().references(() => siftRuns.id, { onDelete: 'cascade' }),
  linkId: uuid('link_id').notNull(),
  resultId: uuid('result_id').notNull().references(() => siftResults.id),
  guard: jsonb('guard').$type<SiftGuard>().notNull(),
  guardDigest: text('guard_digest').notNull(),
}, (t) => [primaryKey({ columns: [t.runId, t.linkId] })]);

export const siftApplicationPreviews = pgTable('sift_application_previews', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  digest: text('digest').notNull(),
  runId: uuid('run_id').notNull().references(() => siftRuns.id),
  runDigest: text('run_digest').notNull(),
  target: jsonb('target').$type<SiftTarget | null>(),
  entries: jsonb('entries').$type<SiftApplicationEntry[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('sift_application_previews_digest_uq').on(t.digest)]);

export const siftApplications = pgTable('sift_applications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  previewId: uuid('preview_id').notNull().references(() => siftApplicationPreviews.id),
  entries: jsonb('entries').$type<SiftApplicationEntry[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('sift_applications_preview_uq').on(t.previewId)]);

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

/** Server-wide settings, one jsonb value per key ('updates': UpdatesSettings). */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
