import { sha256Hex } from '@bukmark/shared';
import { and, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { azukDeliveries, captures, links, quotes, reviewProposals } from '../db/schema.js';
import { changeLinkHubs } from '../links/setLinkHubs.js';
import type { AzukClient, AzukList } from '../azuk/client.js';
import { itemLabel, watchTrigger, type AzukApproval } from '../azuk/model.js';
import {
  canApply, cleanDraft, productListing, sourceVersion, suggestAction,
  type ReviewDraft, type ReviewState, type ReviewSuggestion,
} from './model.js';

export const REVIEW_BATCH_LIMIT = 25;
const DEFAULT_BATCH = 12;

const sourceFields = {
  id: links.id, url: links.url, title: links.title, note: links.note, status: links.status,
};
const evidenceFields = {
  dupeCount: links.dupeCount,
  oneTab: sql<boolean>`exists (select 1 from ${captures} where ${captures.linkId} = ${links.id}
    and ${captures.source} = 'onetab_import') and not exists (select 1 from ${captures}
    where ${captures.linkId} = ${links.id} and ${captures.source} <> 'onetab_import')`,
  folder: sql<string | null>`(select ${captures.groupHint} from ${captures}
    where ${captures.linkId} = ${links.id} and ${captures.groupHint} is not null
    order by ${captures.capturedAt} desc, ${captures.id} desc limit 1)`,
};

export async function reviewCandidates(db: Db, { linkId, limit = DEFAULT_BATCH, offset = 0 }: {
  linkId?: string; limit?: number; offset?: number;
}) {
  const rows = await db.select({
    ...sourceFields, ...evidenceFields,
    pageExcerpt: sql<string | null>`left(${links.contentText}, 1500)`,
    quotes: sql<string[]>`array(select left(${quotes.text}, 500) from ${quotes}
      where ${quotes.linkId} = ${links.id} order by ${quotes.createdAt} desc, ${quotes.id} desc limit 2)`,
  }).from(links).where(and(eq(links.status, 'active'), linkId ? eq(links.id, linkId) : undefined))
    .orderBy(desc(links.firstSeen), desc(links.id)).limit(limit + 1).offset(offset);
  return {
    items: rows.slice(0, limit).map((row) => ({
      ...row, note: row.note.slice(0, 1500), sourceVersion: sourceVersion(row),
      listingUrl: productListing(row.url),
    })),
    more: rows.length > limit,
  };
}

export async function reviewQueue(db: Db, { linkId, state, offset = 0 }: {
  linkId?: string; state: 'pending' | 'deferred' | 'decided'; offset?: number;
}) {
  const rows = await db.select({
    id: reviewProposals.id,
    revision: reviewProposals.revision,
    status: reviewProposals.status,
    draft: reviewProposals.draft,
    reason: reviewProposals.reason,
    origin: reviewProposals.origin,
    draftSourceVersion: reviewProposals.sourceVersion,
    link: sourceFields,
    ...evidenceFields,
  }).from(reviewProposals).innerJoin(links, eq(links.id, reviewProposals.linkId))
    .where(and(
      linkId ? eq(links.id, linkId) : undefined,
      state === 'decided'
        ? inArray(reviewProposals.status, ['applied', 'dismissed'])
        : and(eq(reviewProposals.status, state), eq(links.status, 'active')),
    ))
    .orderBy(desc(reviewProposals.updatedAt), desc(reviewProposals.id))
    .limit(REVIEW_BATCH_LIMIT + 1).offset(offset);

  return {
    items: rows.slice(0, REVIEW_BATCH_LIMIT).map(({ draftSourceVersion, ...row }) => {
      const version = sourceVersion(row.link);
      return { ...row, sourceVersion: version, sourceChanged: draftSourceVersion !== version, listingUrl: productListing(row.link.url) };
    }),
    more: rows.length > REVIEW_BATCH_LIMIT,
  };
}

type ProposalSource =
  | { origin: 'rule' }
  | ({ origin: 'assistant'; sourceVersion: string } & ReviewSuggestion);

async function saveProposal(db: Db, linkId: string, input: ProposalSource) {
  return db.transaction(async (tx) => {
    // Serialize draft changes and decisions by locking the source link first.
    const [link] = await tx.select(sourceFields).from(links).where(eq(links.id, linkId)).for('update');
    if (!link || link.status !== 'active') return 'inactive' as const;
    const version = sourceVersion(link);
    if (input.origin === 'assistant' && input.sourceVersion !== version) return 'changed' as const;
    const suggestion = input.origin === 'rule' ? suggestAction(link.url) : input;
    const draft = cleanDraft(suggestion.draft);
    if (draft.action === 'product' && !productListing(link.url)) return 'incomplete' as const;
    // A reworded explanation alone is the same suggestion.
    const inputKey = sha256Hex(JSON.stringify([version, draft.action, draft.hub, draft.nextStep]));
    const [existing] = await tx.select().from(reviewProposals).where(eq(reviewProposals.linkId, linkId));
    if (existing && (
      existing.inputKey === inputKey || existing.origin === 'owner'
      || (input.origin === 'rule' && existing.origin === 'assistant')
      // Applying a next step changes the source note, but should not recreate the same action.
      || (existing.status === 'applied' && existing.draft.action === draft.action
        && existing.draft.hub === draft.hub && existing.draft.nextStep === draft.nextStep)
    )) return 'unchanged' as const;

    const values = {
      draft, reason: suggestion.reason.trim(), origin: input.origin, status: 'pending' as const,
      sourceVersion: version, inputKey,
    };
    if (existing) {
      await tx.update(reviewProposals).set({
        ...values, revision: existing.revision + 1, updatedAt: sql`now()`,
      }).where(eq(reviewProposals.id, existing.id));
    } else {
      await tx.insert(reviewProposals).values({ ...values, linkId });
    }
    return 'prepared' as const;
  });
}

export async function prepareReviews(db: Db, linkId?: string, limit = DEFAULT_BATCH) {
  const ids = linkId ? [{ id: linkId }] : await db.select({ id: links.id }).from(links)
    .where(and(eq(links.status, 'active'), notExists(db.select({ id: reviewProposals.id })
      .from(reviewProposals).where(eq(reviewProposals.linkId, links.id)))))
    .orderBy(desc(links.firstSeen), desc(links.id)).limit(limit);
  const results = [];
  for (const { id } of ids) results.push({ linkId: id, outcome: await saveProposal(db, id, { origin: 'rule' }) });
  return { items: results };
}

export async function proposeReviews(db: Db, proposals: Array<Omit<Extract<ProposalSource, { origin: 'assistant' }>, 'origin'> & { linkId: string }>) {
  const items = [];
  for (const { linkId, ...proposal } of proposals) {
    items.push({ linkId, outcome: await saveProposal(db, linkId, { ...proposal, origin: 'assistant' }) });
  }
  return { items };
}

const decisionState = {
  approve: 'applied', edit: 'pending', defer: 'deferred', dismiss: 'dismissed', resume: 'pending',
} satisfies Record<string, ReviewState>;

export interface ReviewDecision {
  id: string;
  revision: number;
  sourceVersion: string;
  decision: keyof typeof decisionState;
  draft?: ReviewDraft;
  azuk?: AzukApproval;
}

type Destination = { connection: string; lists: AzukList[] };

async function decideReview(db: Db, input: ReviewDecision, destination: Destination | undefined) {
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ linkId: reviewProposals.linkId })
      .from(reviewProposals).where(eq(reviewProposals.id, input.id));
    if (!target) return 'inactive';
    const [link] = await tx.select(sourceFields).from(links).where(eq(links.id, target.linkId)).for('update');
    if (!link || link.status !== 'active') return 'inactive';
    const [proposal] = await tx.select().from(reviewProposals).where(eq(reviewProposals.id, input.id));
    const version = sourceVersion(link);
    if (!proposal || proposal.revision !== input.revision || version !== input.sourceVersion) return 'changed';
    const { decision } = input;
    if (proposal.status !== (decision === 'resume' ? 'deferred' : 'pending')) return 'changed';
    const draft = input.draft ? cleanDraft(input.draft) : proposal.draft;
    if ((draft.action === 'product' && !productListing(link.url))
      || (decision === 'approve' && draft.action !== 'product' && !canApply(draft))) {
      return 'incomplete';
    }
    let outcome: 'saved' | 'existing' = 'saved';
    if (decision === 'approve') {
      if (draft.action === 'product') {
        const approved = input.azuk;
        if (!approved) return 'incomplete';
        const { connection, listId, listName, listingUrl, target } = approved;
        const productName = approved.productName.trim().replace(/\s+/g, ' ');
        if (!productName || listingUrl !== productListing(link.url)
          || [...itemLabel(productName, listingUrl)].length > 200 || (target && Number(target.price) <= 0)) return 'incomplete';
        if (connection !== destination?.connection
          || !destination.lists.some((list) => list.id === listId && list.name === listName)) return 'destination';
        const inserted = await tx.insert(azukDeliveries).values({
          linkId: link.id, proposalId: proposal.id, revision: proposal.revision,
          connection, listId, listName, listingUrl, productName, trigger: watchTrigger(target),
        }).onConflictDoNothing({
          target: [azukDeliveries.connection, azukDeliveries.listId, azukDeliveries.listingUrl],
        }).returning({ id: azukDeliveries.id });
        if (!inserted.length) outcome = 'existing';
      }
      if (draft.action === 'archive') {
        await tx.update(links).set({ status: 'archived', updatedAt: sql`now()` }).where(eq(links.id, link.id));
      }
      if (draft.hub) await changeLinkHubs(tx, link.id, [draft.hub], []);
      if (draft.action === 'next_step') {
        const addition = `Next step for ${draft.hub}\n${draft.nextStep}`;
        const note = link.note ? `${link.note}\n\n${addition}` : addition;
        await tx.update(links).set({ note, updatedAt: sql`now()` }).where(eq(links.id, link.id));
      }
    }
    await tx.update(reviewProposals).set({
      draft, status: decisionState[decision], revision: proposal.revision + 1, updatedAt: sql`now()`,
      ...(input.draft ? { origin: 'owner', sourceVersion: version } : {}),
    }).where(eq(reviewProposals.id, input.id));
    return outcome;
  });
}

export async function decideReviews(db: Db, decisions: ReviewDecision[], azuk?: AzukClient) {
  let destination: Destination | undefined;
  if (azuk && decisions.some((input) => input.decision === 'approve' && input.azuk?.connection === azuk.connection)) {
    const lists = await azuk.lists().catch(() => null);
    if (Array.isArray(lists)) destination = { connection: azuk.connection, lists };
  }
  const items = [];
  for (const input of decisions) items.push({ id: input.id, outcome: await decideReview(db, input, destination) });
  return { items };
}
