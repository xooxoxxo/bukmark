import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { ImportDecision, ImportReviewItem, ImportView } from '@bukmark/shared/review';
import type { Db } from '../db/client.js';
import { captures, links, reviewProposals } from '../db/schema.js';
import { importSuggestion } from './importSuggestion.js';
import { decideReview } from './service.js';
import { sourceVersion, type ReviewDraft } from './model.js';

// Old session captures already carry their snapshot identity. File imports share one ID across chunks.
const groupId = sql<string>`case when ${captures.source} = 'browser-session'
  then encode(sha256(convert_to('session:' || (${captures.raw}->>'snapshotId'), 'UTF8')), 'hex')
  when ${captures.source} = 'browser-import' then ${captures.raw}->>'importId' end`;
const groupName = sql<string>`coalesce(nullif(${captures.raw}->>'snapshotName',''), nullif(${captures.raw}->>'importName',''), 'Bookmark import')`;

export function listImports(db: Db) {
  return db.select({ id: groupId, name: sql<string>`min(${groupName})`,
    count: sql<number>`count(distinct ${captures.linkId})::int`,
    reviewed: sql<number>`(count(distinct ${captures.linkId}) filter (where ${links.status} = 'archived' or ${reviewProposals.status} in ('applied','dismissed')))::int`,
    skipped: sql<number>`(count(distinct ${captures.linkId}) filter (where ${links.status} = 'active' and ${reviewProposals.status} = 'deferred'))::int`,
    lastImported: sql<string>`max(${captures.capturedAt})` })
    .from(captures).innerJoin(links, eq(links.id, captures.linkId)).leftJoin(reviewProposals, eq(reviewProposals.linkId, links.id))
    .where(isNotNull(groupId)).groupBy(groupId).orderBy(desc(sql`max(${captures.capturedAt})`), groupId);
}

async function members(db: Pick<Db, 'select' | 'selectDistinctOn'>, id: string, selection?: string[]) {
  const cohort = db.selectDistinctOn([captures.linkId], { linkId: captures.linkId, name: groupName.as('import_name') })
    .from(captures).where(and(eq(groupId, id), selection ? inArray(captures.linkId, selection) : undefined))
    .orderBy(captures.linkId, captures.capturedAt, captures.id).as('cohort');
  return db.select({ id: links.id, title: links.title, url: links.url, note: links.note, status: links.status,
    protected: links.sessionProtected, proposal: reviewProposals, name: cohort.name })
    .from(cohort).innerJoin(links, eq(cohort.linkId, links.id)).leftJoin(reviewProposals, eq(links.id, reviewProposals.linkId))
    .orderBy(asc(links.title), asc(links.id));
}

type Member = Awaited<ReturnType<typeof members>>[number];
function present(row: Member): ImportReviewItem {
  const p = row.proposal;
  const suggestion = importSuggestion(row.title, row.url);
  let state: ImportReviewItem['state'] = suggestion.question ? 'question' : 'clear';
  let outcome: string | null = null;
  if (p?.status === 'applied' || p?.status === 'dismissed' || row.status === 'archived') {
    state = 'saved';
    outcome = row.status === 'archived' ? 'Archived' : p?.status === 'dismissed' ? 'Dismissed'
      : p?.draft.nextStep || p?.draft.hub || 'Kept as a bookmark';
  } else if (p?.status === 'deferred') {
    state = 'skipped';
  } else if (p && p.origin !== 'rule') {
    state = 'question';
    suggestion.question = 'How would you like to finish this existing review?';
    suggestion.reason = p.reason;
  }
  return { id: row.id, title: row.title || 'Untitled bookmark', host: URL.parse(row.url)?.hostname ?? '',
    address: row.url, protected: row.protected, state, outcome, suggestion, revision: p?.revision ?? 0, version: sourceVersion(row) };
}
export async function readImport(db: Db, group: string): Promise<ImportView | null> {
  const rows = await members(db, group);
  return rows.length ? { name: rows[0]!.name, items: rows.map(present) } : null;
}

export class StaleImport extends Error {}
function changed(): never { throw new StaleImport('This review changed. Reload the import to see the latest decisions.'); }

function localDraft(input: ImportDecision, item: ImportReviewItem): ReviewDraft {
  switch (input.choice) {
    case 'accept':
      if (item.state !== 'clear' || !item.suggestion.folder) return changed();
      return { action: 'reference', hub: item.suggestion.folder };
    case 'keep': return { action: 'reference' };
    case 'archive': return { action: 'archive' };
    case 'answer':
      if (!input.answer?.trim()) return changed();
      return { action: 'next_step', hub: 'Follow up', nextStep: input.answer.trim() };
    case 'skip': return { action: 'undecided' };
  }
}

// Lock in stable order before checking revisions. Any stale member rolls back the whole selection.
export async function saveImportDecisions(db: Db, group: string, inputs: ImportDecision[]) {
  const ids = inputs.map(d => d.id);
  if (new Set(ids).size !== ids.length) return changed();
  await db.transaction(async tx => {
    await tx.select({ id: links.id }).from(links).where(inArray(links.id, ids)).orderBy(links.id).for('update');
    const rows = await members(tx, group, ids);
    if (rows.length !== ids.length) return changed();
    const byId = new Map(rows.map(r => [r.id, r]));
    for (const input of inputs) {
      const row = byId.get(input.id)!;
      const item = present(row);
      if (item.revision !== input.revision || item.version !== input.version || item.state === 'saved') return changed();
      const draft = input.choice === 'skip' && row.proposal ? row.proposal.draft : localDraft(input, item);
      let proposal: Member['proposal'] | undefined = row.proposal;
      if (!proposal) {
        [proposal] = await tx.insert(reviewProposals).values({ linkId: row.id, origin: 'rule', draft,
          reason: item.suggestion.reason, sourceVersion: item.version, inputKey: item.version }).returning();
      }
      if (!proposal) return changed();
      const decision = { id: proposal.id, revision: proposal.revision, sourceVersion: item.version };
      if (proposal.status === 'deferred') {
        if (input.choice === 'skip') continue;
        const resumed = await decideReview(tx, { ...decision, decision: 'resume' });
        if (resumed !== 'saved') return changed();
        decision.revision++;
      }
      const result = await decideReview(tx, { ...decision, draft, decision: input.choice === 'skip' ? 'defer' : 'approve' });
      if (result !== 'saved') return changed();
    }
  });
}
