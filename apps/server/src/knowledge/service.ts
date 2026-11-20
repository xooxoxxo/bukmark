import { createHash } from 'node:crypto';
import type { KnowledgeDraft, KnowledgeEvidence, KnowledgeEvidenceAction, KnowledgeExport, KnowledgeFields } from '@bukmark/shared/review';
import { and, desc, eq } from 'drizzle-orm';
import { canonicalJson } from '../canonicalJson.js';
import type { Db } from '../db/client.js';
import { knowledgeExports, knowledgeNotes, links, quotes } from '../db/schema.js';
import { SAVED_PAGE_SIZE } from '../og/savedPageCandidates.js';
import {
  captureKnowledgePassage, evidenceText, knowledgeReading, publicCitationUrl, readKnowledgeArticle, type KnowledgePageReader,
} from './source.js';

type Note = typeof knowledgeNotes.$inferSelect;
export type KnowledgeMismatch = { key: string; kept: boolean };

export function previewNote(row: Note): KnowledgeDraft {
  const { id, linkId, savedUrl, revision, fields, evidence, mismatch, latestExportId } = row;
  return { id, linkId, savedUrl, revision, fields, evidence, sourceChanged: Boolean(mismatch && !mismatch.kept), latestExportId };
}

export async function listKnowledgeNotes(db: Db, { linkId, offset = 0 }: { linkId?: string; offset?: number }) {
  const rows = await db.select().from(knowledgeNotes)
    .where(linkId ? eq(knowledgeNotes.linkId, linkId) : undefined)
    .orderBy(desc(knowledgeNotes.updatedAt), desc(knowledgeNotes.id)).limit(SAVED_PAGE_SIZE + 1).offset(offset);
  return { items: rows.slice(0, SAVED_PAGE_SIZE).map(previewNote), more: rows.length > SAVED_PAGE_SIZE };
}

export async function startKnowledgeNote(db: Db, linkId: string, another: boolean) {
  return db.transaction(async (tx) => {
    const [link] = await tx.select({ url: links.url, title: links.title }).from(links).where(eq(links.id, linkId)).for('update');
    if (!link) return { outcome: 'missing' as const };
    if (!another) {
      const [existing] = await tx.select().from(knowledgeNotes).where(eq(knowledgeNotes.linkId, linkId))
        .orderBy(desc(knowledgeNotes.updatedAt), desc(knowledgeNotes.id)).limit(1);
      if (existing) return { outcome: 'saved' as const, draft: previewNote(existing) };
    }
    const url = publicCitationUrl(link.url);
    if (!url) return { outcome: 'unavailable' as const };
    const [created] = await tx.insert(knowledgeNotes).values({
      linkId, savedUrl: url.href,
      fields: { title: link.title.slice(0, 200), bodyMarkdown: '', tags: [], includeExcerpt: false },
    }).returning();
    return { outcome: 'saved' as const, draft: previewNote(created!) };
  });
}

async function updateNote(
  db: Db, row: Note, changes: Partial<Pick<Note, 'fields' | 'evidence' | 'mismatch'>>,
) {
  if (Object.entries(changes).every(([key, value]) => canonicalJson(row[key as keyof Note]) === canonicalJson(value))) {
    return { outcome: 'saved' as const, draft: previewNote(row) };
  }
  const [updated] = await db.update(knowledgeNotes).set({ ...changes, revision: row.revision + 1, updatedAt: new Date() })
    .where(and(eq(knowledgeNotes.id, row.id), eq(knowledgeNotes.revision, row.revision))).returning();
  return updated ? { outcome: 'saved' as const, draft: previewNote(updated) } : { outcome: 'changed' as const };
}

export async function saveKnowledgeNote(db: Db, id: string, revision: number, fields: KnowledgeFields) {
  const [row] = await db.select().from(knowledgeNotes).where(eq(knowledgeNotes.id, id));
  if (!row || row.revision !== revision) return { outcome: 'changed' as const };
  return updateNote(db, row, {
    fields: {
      title: fields.title.trim(), bodyMarkdown: fields.bodyMarkdown, whyItMatters: fields.whyItMatters?.trim() || undefined,
      tags: [...new Set(fields.tags.map((tag) => tag.trim()).filter(Boolean))], includeExcerpt: fields.includeExcerpt,
    },
  });
}

async function quoteEvidence(db: Db, row: Note, quoteId: string, excerpt: string, locator?: string): Promise<KnowledgeEvidence | 'excerpt'> {
  if (!row.linkId) return 'excerpt';
  const [quote] = await db.select({ text: quotes.text, url: quotes.sourceUrl, title: quotes.sourceTitle, at: quotes.createdAt })
    .from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.linkId, row.linkId)));
  const url = quote && publicCitationUrl(quote.url);
  const text = evidenceText(excerpt);
  if (!quote || !url || !text || !evidenceText(quote.text).includes(text)) return 'excerpt';
  return { kind: 'quote', citation: {
    url: url.href, title: quote.title || url.hostname, locator: locator?.trim() || undefined,
    observedOn: quote.at.toISOString().slice(0, 10),
  }, excerpt: text };
}

function sameEvidence(previous: KnowledgeEvidence | null, next: KnowledgeEvidence) {
  if (!previous) return false;
  const comparable = (value: KnowledgeEvidence) => ({
    ...value, citation: { ...value.citation, observedOn: undefined },
  });
  return canonicalJson(comparable(previous)) === canonicalJson(comparable(next));
}

export async function updateKnowledgeEvidence(
  db: Db, id: string, revision: number, action: KnowledgeEvidenceAction, read: KnowledgePageReader,
) {
  const [row] = await db.select().from(knowledgeNotes).where(eq(knowledgeNotes.id, id));
  if (!row || row.revision !== revision) return { outcome: 'changed' as const };
  if (action.mode === 'read') {
    const article = await readKnowledgeArticle(read, row.savedUrl);
    if (!article) return { outcome: 'unavailable' as const };
    const reading = knowledgeReading(article);
    const text = evidenceText(article.text);
    let mismatch: KnowledgeMismatch | null = null;
    if (row.evidence && (row.evidence.citation.url !== reading.url || !text.includes(row.evidence.excerpt))) {
      const key = createHash('sha256').update(canonicalJson([reading.url, text])).digest('hex');
      mismatch = row.mismatch?.key === key ? row.mismatch : { key, kept: false };
    }
    const saved = await updateNote(db, row, { mismatch });
    return saved.outcome === 'saved' ? { ...saved, reading } : saved;
  }
  if (action.mode === 'keep') {
    return updateNote(db, row, { mismatch: row.mismatch ? { ...row.mismatch, kept: true } : null });
  }
  const evidence = action.mode === 'page'
    ? await captureKnowledgePassage(read, row.savedUrl, action.excerpt, action.locator, action.versionUrl)
    : await quoteEvidence(db, row, action.quoteId, action.excerpt, action.locator);
  if (typeof evidence === 'string') return { outcome: evidence };
  return updateNote(db, row, { evidence: sameEvidence(row.evidence, evidence) ? row.evidence : evidence, mismatch: null });
}

export async function approveKnowledgeNote(db: Db, id: string, revision: number) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(knowledgeNotes).where(eq(knowledgeNotes.id, id)).for('update');
    if (!row) return { outcome: 'changed' as const };
    const [existing] = await tx.select({ id: knowledgeExports.id }).from(knowledgeExports)
      .where(and(eq(knowledgeExports.noteId, id), eq(knowledgeExports.draftRevision, revision)));
    if (existing) return { outcome: 'saved' as const, id: existing.id };
    if (row.revision !== revision) return { outcome: 'changed' as const };
    const { fields, evidence, mismatch } = row;
    if (mismatch && !mismatch.kept) return { outcome: 'evidence-changed' as const };
    if (!fields.title || !fields.bodyMarkdown.trim() || !evidence) return { outcome: 'incomplete' as const };

    const approvedRevision = row.approvedRevision + 1;
    const payload: KnowledgeExport = { schemaVersion: 1, notes: [{
      key: `note:${id}`, revision: approvedRevision, title: fields.title, bodyMarkdown: fields.bodyMarkdown,
      whyItMatters: fields.whyItMatters, tags: fields.tags,
      sources: [{ ...evidence.citation, excerpt: fields.includeExcerpt ? evidence.excerpt : undefined }],
    }] };
    const [created] = await tx.insert(knowledgeExports).values({ noteId: id, draftRevision: revision, payload })
      .returning({ id: knowledgeExports.id });
    await tx.update(knowledgeNotes).set({ approvedRevision, latestExportId: created!.id, updatedAt: new Date() })
      .where(eq(knowledgeNotes.id, id));
    return { outcome: 'saved' as const, id: created!.id };
  });
}

export async function getKnowledgeExport(db: Db, id: string) {
  const [row] = await db.select({ payload: knowledgeExports.payload }).from(knowledgeExports).where(eq(knowledgeExports.id, id));
  return row?.payload;
}
