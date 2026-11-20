import { createHash } from 'node:crypto';
import { and, desc, eq, exists, ilike, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { builderDrafts, builderDraftSources, builderExports, captures, links } from '../db/schema.js';
import { BuilderMetadataError, builderResolver } from './metadata.js';
import { canonicalJson } from '../canonicalJson.js';
import { builderSource, type BuilderPin, type BuilderRecord, previewRecord } from './model.js';
import { BuilderContextError, readRepositoryContext } from './repositoryContext.js';

const PAGE_SIZE = 25;
const SUPPORTED_PAGE = '^https?://(www[.])?(github[.]com/[a-z0-9-]+/[a-z0-9_.-]+(/(issues|discussions)/[1-9][0-9]{0,8}|/(blob|tree)/[^?#]+)?/?|npmjs[.]com/package/[^?#]+)([?#].*)?$';

interface Page {
  linkId?: string;
  offset?: number;
}

export interface BuilderApproval {
  id: string;
  revision: number;
  synopsis: string;
  tags: string[];
  contextKeys: string[];
}

export async function builderCandidates(db: Db, { linkId, q, offset = 0 }: Page & { q?: string }) {
  const term = q?.trim();
  const pattern = term ? '%' + term.replace(/[\\%_]/g, '\\$&') + '%' : undefined;
  const rows = await db.select({ id: links.id, url: links.url, title: links.title }).from(links)
    .where(and(
      eq(links.status, 'active'),
      sql`${links.url} ~* ${SUPPORTED_PAGE}`,
      linkId ? eq(links.id, linkId) : undefined,
      pattern ? or(ilike(links.title, pattern), ilike(links.url, pattern)) : undefined,
    ))
    .orderBy(desc(links.lastSeen), desc(links.id))
    .limit(PAGE_SIZE + 1).offset(offset);
  return { items: rows.slice(0, PAGE_SIZE).filter(({ url }) => builderSource(url)), more: rows.length > PAGE_SIZE };
}

export async function listBuilderDrafts(db: Db, { linkId, offset = 0 }: Page) {
  const rows = await db.select().from(builderDrafts)
    .where(linkId ? exists(db.select({ id: builderDraftSources.linkId }).from(builderDraftSources)
      .where(and(eq(builderDraftSources.draftId, builderDrafts.id), eq(builderDraftSources.linkId, linkId)))) : undefined)
    .orderBy(desc(builderDrafts.updatedAt), desc(builderDrafts.id))
    .limit(PAGE_SIZE + 1).offset(offset);
  return {
    items: rows.slice(0, PAGE_SIZE).map(({ id, revision, record, edits }) => ({
      id, revision, record: previewRecord(record, { ...edits, excluded: [] }), excluded: edits.excluded ?? [],
    })),
    more: rows.length > PAGE_SIZE,
  };
}

type SavedSource = Pick<typeof links.$inferSelect, 'id' | 'url' | 'status' | 'sessionProtected'>;

function sameContextSource(a: string, b: string) {
  return a.split('#')[0] === b.split('#')[0];
}

async function saveDraft(db: Db, source: SavedSource, record: BuilderRecord) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ url: links.url, status: links.status, sessionProtected: links.sessionProtected }).from(links)
      .where(eq(links.id, source.id)).for('update');
    if (current?.status !== 'active' || current.url !== source.url) return 'inactive' as const;
    const attachment = record.context.find(({ kind }) => kind === 'code' || kind === 'discussion');
    if (attachment && current.sessionProtected) return 'inactive' as const;

    const [created] = await tx.insert(builderDrafts).values({ key: record.key, record })
      .onConflictDoNothing({ target: builderDrafts.key }).returning({ id: builderDrafts.id });
    const [existing] = created ? [] : await tx.select().from(builderDrafts).where(eq(builderDrafts.key, record.key)).for('update');
    let changed = Boolean(created);
    if (existing) {
      const context = new Map(existing.record.context.map((item) => [item.key, item]));
      if (attachment?.kind === 'code' && existing.record.context.some((item) => item.kind === 'code'
        && sameContextSource(item.sourceUrl, attachment.sourceUrl) && item.key !== attachment.key)) return 'different-pin' as const;
      for (const item of record.context) {
        const previous = context.get(item.key);
        if ((item.kind === 'code' || item.kind === 'discussion') && previous?.kind === item.kind) {
          context.set(item.key, { ...item, sourceUrl: previous.sourceUrl, ...(previous.kind === 'code' ? { url: previous.url, ref: previous.ref } : {}) });
        } else {
          context.set(item.key, item);
        }
      }
      const next = { ...(attachment ? existing.record : record), context: [...context.values()].sort((a, b) => a.key.localeCompare(b.key)) };
      if (canonicalJson(existing.record) !== canonicalJson(next)) {
        await tx.update(builderDrafts).set({ record: next, revision: existing.revision + 1, updatedAt: new Date() })
          .where(eq(builderDrafts.id, existing.id));
        changed = true;
      }
    }
    await tx.insert(builderDraftSources).values({ draftId: (created ?? existing)!.id, linkId: source.id }).onConflictDoNothing();
    return changed ? 'prepared' as const : 'unchanged' as const;
  });
}

export async function prepareBuilderDrafts(db: Db, linkIds: string[], fetcher: typeof fetch, pins = new Map<string, BuilderPin>()) {
  const rows = await db.select({ id: links.id, url: links.url, status: links.status, sessionProtected: links.sessionProtected })
    .from(links).where(inArray(links.id, linkIds));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const sources = await db.select({ linkId: builderDraftSources.linkId, record: builderDrafts.record })
    .from(builderDraftSources).innerJoin(builderDrafts, eq(builderDraftSources.draftId, builderDrafts.id))
    .where(inArray(builderDraftSources.linkId, linkIds));
  const resolve = builderResolver(fetcher);
  const items = await Promise.all(linkIds.map(async (linkId) => {
    const row = byId.get(linkId);
    if (row?.status !== 'active') return { linkId, outcome: 'inactive' };
    let source = builderSource(row.url);
    if (!source) return { linkId, outcome: 'unverified', reason: 'This link is outside the supported GitHub and npm pages.' };
    if (source.kind === 'github-context' && row.sessionProtected) return { linkId, outcome: 'inactive' };
    const pin = pins.get(linkId);
    if (pin && (source.kind !== 'github-context' || source.page === 'discussion')) {
      return { linkId, outcome: 'unverified', reason: 'A commit pin requires a GitHub file or folder.' };
    }

    let record: BuilderRecord;
    try {
      if (source.kind === 'github-context') {
        const originalSource = source;
        const savedPin = sources.filter((item) => item.linkId === linkId).flatMap((item) => item.record.context)
          .find((item) => item.kind === 'code' && sameContextSource(item.sourceUrl, originalSource.sourceUrl));
        if (source.page === 'blob' && !source.lines) {
          if (savedPin?.kind === 'code') {
            const stagedSource = builderSource(savedPin.sourceUrl);
            if (stagedSource?.kind === 'github-context' && stagedSource.page === 'blob') source = stagedSource;
          } else {
            const capturesWithLines = await db.select({ url: captures.originalUrl }).from(captures)
              .where(and(eq(captures.linkId, linkId), sql`${captures.originalUrl} LIKE '%#L%'`))
              .orderBy(desc(captures.capturedAt), desc(captures.id));
            const captured = capturesWithLines.map(({ url }) => builderSource(url)).find((item) =>
              item?.kind === 'github-context' && item.page === 'blob' && item.lines
              && sameContextSource(item.sourceUrl, originalSource.sourceUrl));
            if (captured?.kind === 'github-context') source = captured;
          }
        }
        record = await readRepositoryContext(source, fetcher, pin ?? (savedPin?.kind === 'code' ? savedPin : undefined));
      } else {
        record = await resolve(source);
      }
    } catch (error) {
      return {
        linkId, outcome: 'unverified',
        reason: error instanceof BuilderMetadataError || error instanceof BuilderContextError
          ? error.message : 'The provider could not confirm this link. Try again later.',
      };
    }
    const outcome = await saveDraft(db, row, record);
    if (outcome === 'different-pin') return { linkId, outcome: 'unverified', reason: 'This bookmark already has a different pinned commit.' };
    return { linkId, outcome, key: record.key };
  }));
  return { items };
}

export async function approveBuilderExport(db: Db, items: BuilderApproval[]) {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(builderDrafts).where(inArray(builderDrafts.id, items.map(({ id }) => id)))
      .orderBy(builderDrafts.id).for('update');
    const approvals = new Map(items.map((item) => [item.id, item]));
    if (rows.length !== items.length || rows.some((row) => row.revision !== approvals.get(row.id)?.revision)) {
      return { outcome: 'changed' as const };
    }
    if (rows.some(({ id, record }) => approvals.get(id)!.contextKeys.some((key) => !record.context.some((item) => item.key === key)))) {
      return { outcome: 'context' as const };
    }

    const records: BuilderRecord[] = [];
    const revisions: { id: string; revision: number }[] = [];
    for (const row of rows) {
      const input = approvals.get(row.id)!;
      const included = new Set(input.contextKeys);
      const excluded = row.record.context.filter(({ key }) => !included.has(key)).map(({ key }) => key);
      const current = previewRecord(row.record, row.edits);
      const edits = { ...row.edits };
      if (input.synopsis !== current.synopsis) edits.synopsis = input.synopsis;
      if (canonicalJson(input.tags) !== canonicalJson(current.tags)) edits.tags = input.tags;
      if (canonicalJson(excluded) !== canonicalJson(edits.excluded ?? [])) edits.excluded = excluded;

      let revision = row.revision;
      if (canonicalJson(row.edits) !== canonicalJson(edits)) {
        revision++;
        await tx.update(builderDrafts).set({ edits, revision, updatedAt: new Date() }).where(eq(builderDrafts.id, row.id));
      }
      revisions.push({ id: row.id, revision });
      records.push(previewRecord(row.record, edits));
    }

    records.sort((a, b) => a.key.localeCompare(b.key));
    const key = createHash('sha256').update(canonicalJson(revisions)).digest('hex');
    const [created] = await tx.insert(builderExports).values({ key, revisions, records })
      .onConflictDoNothing({ target: builderExports.key }).returning({ id: builderExports.id });
    const [receipt] = created ? [created] : await tx.select({ id: builderExports.id }).from(builderExports)
      .where(eq(builderExports.key, key));
    return { outcome: 'saved' as const, id: receipt!.id, recordCount: records.length };
  });
}

export async function getBuilderExport(db: Db, id: string) {
  const [row] = await db.select({ records: builderExports.records }).from(builderExports).where(eq(builderExports.id, id));
  if (!row) return null;
  const hasRepositoryContext = row.records.some(({ context }) => context.some(({ kind }) => kind === 'code' || kind === 'discussion'));
  return { schemaVersion: hasRepositoryContext ? 2 : 1, records: row.records };
}
