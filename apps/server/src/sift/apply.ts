import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { SiftApplicationInput, SiftApplicationView } from '@bukmark/shared';
import { pgCode, type Db } from '../db/client.js';
import { hubs, hubLinks, links, siftApplicationPreviews, siftApplications, siftDecisions, siftRunItems, siftRuns } from '../db/schema.js';
import { siftContextFor } from './history.js';
import { SiftConflict, siftDigest, SIFT_PAGE_SIZE, SIFT_SCOPE_LIMIT } from './historyModel.js';
import type { SiftApplicationEntry, SiftTarget } from './applyModel.js';

type Reader = Pick<Db, 'select' | 'execute'>;
type Plan = typeof siftApplicationPreviews.$inferSelect;
type Receipt = typeof siftApplications.$inferSelect;
type Source = typeof links.$inferSelect;
type Context = Awaited<ReturnType<typeof siftContextFor>>;

function targetVersion(hub: typeof hubs.$inferSelect): string {
  return siftDigest(hub);
}

async function currentState(db: Reader, entries: SiftApplicationEntry[], target: SiftTarget | null) {
  const sources = await db.select().from(links).where(inArray(links.id, entries.map(x => x.linkId))).orderBy(asc(links.id));
  const context = await siftContextFor(db, sources);
  const [hub] = target ? await db.select().from(hubs).where(eq(hubs.id, target.id)) : [];
  const targetCurrent = Boolean(target && hub?.status === 'active' && target.version === targetVersion(hub));
  return { sources, context, targetCurrent };
}

function evaluate(entry: SiftApplicationEntry, source: Source | undefined, context: Context, target: SiftTarget | null, targetCurrent: boolean): SiftApplicationEntry {
  const current = source && context.get(source.id);
  const reasons = [
    ...(!source ? ['source-unavailable'] : []),
    ...(current?.holds ?? []),
    ...(current && (siftDigest(current.guard) !== entry.expectedGuardDigest
      || current.guard.decisionRevision !== entry.expectedDecisionRevision) ? ['source-or-evidence-changed'] : []),
    ...(!target ? ['choose-bin'] : !targetCurrent ? ['target-changed'] : []),
  ];
  if (reasons.length) return { ...entry, state: 'held', reasons: [...new Set(reasons)] };
  const member = current!.guard.memberships.some(x => x.hubId === target!.id);
  return { ...entry, state: member ? 'unchanged' : 'ready', reasons: member ? ['already-in-bin'] : [] };
}

/** Historical holds cannot become approval just because their cause later disappears. */
function recheck(entry: SiftApplicationEntry, source: Source | undefined, context: Context, target: SiftTarget | null, targetCurrent: boolean) {
  const current = evaluate(entry, source, context, target, targetCurrent);
  return entry.state === 'held'
    ? { ...entry, reasons: [...new Set([...entry.reasons, ...current.reasons])] }
    : current;
}

async function project(db: Reader, plan: Plan, receipt: Receipt | undefined, applyEnabled: boolean, offset: number): Promise<SiftApplicationView> {
  const stored = receipt?.entries ?? plan.entries;
  const { sources, context, targetCurrent } = await currentState(db, stored, plan.target);
  const byId = new Map(sources.map(x => [x.id, x]));
  const entries = receipt ? stored : stored.map(x => recheck(x, byId.get(x.linkId), context, plan.target, targetCurrent));
  const counts: SiftApplicationView['counts'] = { ready: 0, applied: 0, unchanged: 0, held: 0 };
  for (const entry of entries) counts[entry.state]++;
  // Never return protected/deleted IDs, result IDs, guards or old evidence, including on retry.
  const visible = entries.filter(x => { const source = byId.get(x.linkId); return source && !source.sessionProtected; });
  const [application] = receipt ? [receipt] : await db.select().from(siftApplications).where(eq(siftApplications.previewId, plan.id));
  return {
    id: receipt?.id ?? plan.id, previewId: plan.id, runId: plan.runId, digest: plan.digest,
    createdAt: (receipt?.createdAt ?? plan.createdAt).toISOString(), kind: receipt ? 'receipt' : 'preview',
    target: visible.length && plan.target ? { id: plan.target.id, name: plan.target.name } : null,
    selectedCount: entries.length, localOnlyCount: sources.filter(x => x.sessionProtected).length,
    unavailableCount: entries.length - sources.length, counts,
    items: visible.slice(offset, offset + SIFT_PAGE_SIZE).map(entry => {
      const source = byId.get(entry.linkId)!;
      return { link: { id: source.id, url: source.url, title: source.title, status: source.status },
        resultId: entry.resultId, expectedDecisionRevision: entry.expectedDecisionRevision, state: entry.state, reasons: entry.reasons };
    }),
    more: visible.length > offset + SIFT_PAGE_SIZE, applyEnabled, applicationId: application?.id ?? null,
  };
}

export async function prepareSiftApplication(db: Db, runId: string, input: SiftApplicationInput, applyEnabled = false) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'bukmark-sift-plan:' + runId}, 0))`);
    const [run] = await tx.select().from(siftRuns).where(eq(siftRuns.id, runId));
    if (!run) throw new SiftConflict('missing');
    if (run.digest !== input.digest) throw new SiftConflict('preview_changed');
    const ids = input.selection.kind === 'run' ? [...run.sourceIds].sort()
      : input.selection.linkIds.map(x => x.toLowerCase()).sort();
    if (!ids.length || ids.length > SIFT_SCOPE_LIMIT || new Set(ids).size !== ids.length
      || ids.some(id => !run.sourceIds.includes(id))) throw new SiftConflict('scope_changed');
    const saved = await tx.select().from(siftRunItems).where(and(eq(siftRunItems.runId, run.id), inArray(siftRunItems.linkId, ids))).orderBy(asc(siftRunItems.linkId));
    if (saved.length !== ids.length) throw new SiftConflict('scope_changed');
    const [hub] = input.hubId ? await tx.select().from(hubs).where(eq(hubs.id, input.hubId)) : [];
    if (input.hubId && !hub) throw new SiftConflict('preview_changed');
    const target: SiftTarget | null = hub ? { id: hub.id, name: hub.name, version: targetVersion(hub) } : null;
    const initial: SiftApplicationEntry[] = saved.map(item => ({ linkId: item.linkId, resultId: item.resultId,
      expectedGuardDigest: item.guardDigest, expectedDecisionRevision: item.guard.decisionRevision,
      state: 'ready', reasons: [] }));
    const { sources, context, targetCurrent } = await currentState(tx, initial, target);
    const byId = new Map(sources.map(x => [x.id, x]));
    const entries = initial.map(x => evaluate(x, byId.get(x.linkId), context, target, targetCurrent));
    const digest = siftDigest({ version: 1, runId: run.id, runDigest: run.digest, target, entries });
    const [created] = await tx.insert(siftApplicationPreviews).values({ digest, runId: run.id, runDigest: run.digest, target, entries })
      .onConflictDoNothing({ target: siftApplicationPreviews.digest }).returning();
    const [plan] = created ? [created] : await tx.select().from(siftApplicationPreviews).where(eq(siftApplicationPreviews.digest, digest));
    return project(tx, plan!, undefined, applyEnabled, 0);
  });
}

export async function getSiftApplicationPreview(db: Db, id: string, applyEnabled = false, offset = 0) {
  return db.transaction(async tx => {
    const [plan] = await tx.select().from(siftApplicationPreviews).where(eq(siftApplicationPreviews.id, id));
    if (!plan) throw new SiftConflict('missing');
    return project(tx, plan, undefined, applyEnabled, offset);
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

export async function getSiftApplication(db: Db, id: string, applyEnabled = false, offset = 0) {
  return db.transaction(async tx => {
    const [receipt] = await tx.select().from(siftApplications).where(eq(siftApplications.id, id));
    if (!receipt) throw new SiftConflict('missing');
    const [plan] = await tx.select().from(siftApplicationPreviews).where(eq(siftApplicationPreviews.id, receipt.previewId));
    return project(tx, plan!, receipt, applyEnabled, offset);
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

/** Only local database writes. No page, provider, export or delivery port exists. */
export async function applySiftApplication(db: Db, id: string, digest: string) {
  try {
    return await db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout = '5s'`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('bukmark-sift-apply', 0))`);
      const [plan] = await tx.select().from(siftApplicationPreviews).where(eq(siftApplicationPreviews.id, id)).for('update');
      if (!plan) throw new SiftConflict('missing');
      if (plan.digest !== digest) throw new SiftConflict('preview_changed');
      const [prior] = await tx.select().from(siftApplications).where(eq(siftApplications.previewId, plan.id));
      if (prior) return project(tx, plan, prior, true, 0);

      // Existing editors do not all lock the parent source. Cover their child-row writes too.
      // Readers remain available; bounded approval requests briefly serialize library writers.
      await tx.execute(sql`lock table links, hubs, hub_links, sift_decisions, review_proposals,
        builder_exports, recipe_exports, knowledge_exports, azuk_deliveries in share row exclusive mode`);
      await tx.select({ id: links.id }).from(links).where(inArray(links.id, plan.entries.map(x => x.linkId))).orderBy(asc(links.id)).for('update');
      const { sources, context, targetCurrent } = await currentState(tx, plan.entries, plan.target);
      const byId = new Map(sources.map(x => [x.id, x]));
      const entries = plan.entries.map(x => recheck(x, byId.get(x.linkId), context, plan.target, targetCurrent));
      const [receipt] = await tx.insert(siftApplications).values({ previewId: plan.id, entries }).returning();
      for (const entry of entries) {
        if (entry.state !== 'ready') continue;
        const membership = await tx.execute<{ at: string }>(sql`
          insert into hub_links (hub_id, link_id, assigned_by) values (${plan.target!.id}::uuid, ${entry.linkId}::uuid, 'user')
          returning to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`);
        await tx.insert(siftDecisions).values({ linkId: entry.linkId, applicationId: receipt!.id, field: 'bin',
          hubId: plan.target!.id, bin: plan.target!.name, membershipCreatedAt: membership[0]!.at, revision: 1 });
        entry.state = 'applied';
      }
      const [saved] = await tx.update(siftApplications).set({ entries }).where(eq(siftApplications.id, receipt!.id)).returning();
      return project(tx, plan, saved!, true, 0);
    });
  } catch (error) {
    if (['55P03', '40P01', '40001'].includes(pgCode(error) ?? '')) throw new SiftConflict('library_busy');
    throw error;
  }
}
