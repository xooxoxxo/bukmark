import { and, asc, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { SiftBaselineInput, SiftPreview, SiftPreviewItem, SiftRunReceipt, SiftScope } from '@bukmark/shared/review';
import type { Db } from '../db/client.js';
import {
  azukDeliveries, builderExports, hubLinks, hubs, knowledgeExports, links, recipeExports, reviewProposals,
  siftApplicationPreviews, siftApplications, siftBaselines, siftDecisions, siftResults, siftRunItems, siftRuns,
} from '../db/schema.js';
import { builderSource, type BuilderRecord } from '../builder/model.js';
import { sourceVersion } from '../review/model.js';
import { localSiftInput } from './evidence.js';
import {
  localSiftResult, localSiftRules, SiftConflict, siftDigest, SIFT_PAGE_SIZE, SIFT_SCOPE_LIMIT, type SiftGuard,
} from './historyModel.js';

type Reader = Pick<Db, 'select' | 'execute'>;
type Source = typeof links.$inferSelect;
const timeText = sql<string>`to_char(${hubLinks.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export async function importSiftBaseline(db: Db, input: SiftBaselineInput) {
  input={...input,bins:input.bins.map(bin=>({...bin,id:bin.id.toLowerCase()})),
    items:input.items.map(item=>({...item,linkId:item.linkId.toLowerCase(),hubId:item.hubId.toLowerCase()}))};
  if (!input.items.length || input.items.length > SIFT_SCOPE_LIMIT
    || new Set(input.items.map(x => x.linkId)).size !== input.items.length
    || new Set(input.bins.map(x => x.id)).size !== input.bins.length
    || input.bins.some(bin => input.items.filter(x => x.hubId === bin.id).length !== bin.count)
    || input.items.some(item => !input.bins.some(bin => bin.id === item.hubId))) throw new SiftConflict('baseline_changed');
  return db.transaction(async tx => {
    // Serialize legacy imports without changing any source row or current choice.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('bukmark-sift-baseline', 0))`);
    await tx.select({id:hubs.id}).from(hubs).where(inArray(hubs.id,input.bins.map(x=>x.id))).orderBy(asc(hubs.id)).for('update');
    await tx.select({id:hubLinks.linkId}).from(hubLinks).where(inArray(hubLinks.linkId,input.items.map(x=>x.linkId))).orderBy(asc(hubLinks.linkId)).for('share');
    const expectedBins = sql.join(input.bins.map(bin => sql`(${bin.id}::uuid, ${bin.name}::text, ${bin.count}::int, ${bin.createdAt}::timestamptz)`), sql`, `);
    const foundBins = await tx.execute<{ id: string }>(sql`
      select h.id from (values ${expectedBins}) e(id, name, n, at)
      join hubs h on h.id=e.id and h.name=e.name and h.created_at=e.at
      where (select count(*) from hub_links hl where hl.hub_id=h.id)=e.n`);
    const expectedItems = sql.join(input.items.map(item => sql`(${item.linkId}::uuid, ${item.hubId}::uuid, ${item.membershipCreatedAt}::timestamptz)`), sql`, `);
    const found = await tx.execute<{ link_id: string; hub_id: string; at: string }>(sql`
      select hl.link_id, hl.hub_id,
        to_char(hl.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at
      from (values ${expectedItems}) e(link_id, hub_id, at)
      join hub_links hl on hl.link_id=e.link_id and hl.hub_id=e.hub_id and hl.created_at=e.at
      order by hl.link_id`);
    if (foundBins.length !== input.bins.length || found.length !== input.items.length) throw new SiftConflict('baseline_changed');
    const manifest: SiftBaselineInput = {
      reference: input.reference.trim(), approvedAt: new Date(input.approvedAt).toISOString(),
      bins: [...input.bins].sort((a,b) => a.id.localeCompare(b.id)),
      items: found.map(item => ({ linkId:item.link_id, hubId:item.hub_id, membershipCreatedAt:item.at })),
    };
    const key = siftDigest(manifest);
    const existingDecisions = await tx.select().from(siftDecisions).where(inArray(siftDecisions.linkId, manifest.items.map(x=>x.linkId)));
    const [prior] = await tx.select().from(siftBaselines).where(eq(siftBaselines.key,key));
    if (existingDecisions.some(decision => decision.baselineId !== prior?.id)) throw new SiftConflict('decision_conflict');
    if (prior) return { id:prior.id, count:manifest.items.length, reused:true };
    const [baseline] = await tx.insert(siftBaselines).values({ key, reference:manifest.reference,
      approvedAt:new Date(manifest.approvedAt), manifest }).returning();
    await tx.insert(siftDecisions).values(manifest.items.map(item => ({
      linkId:item.linkId, baselineId:baseline!.id, field:'bin', hubId:item.hubId,
      bin:manifest.bins.find(bin=>bin.id===item.hubId)!.name, membershipCreatedAt:item.membershipCreatedAt,
    })));
    return { id:baseline!.id, count:manifest.items.length, reused:false };
  });
}

export async function listSiftBaselines(db: Reader) {
  const rows = await db.select().from(siftBaselines).orderBy(desc(siftBaselines.createdAt), desc(siftBaselines.id));
  return { items:rows.map(row=>({id:row.id,reference:row.reference,approvedAt:row.approvedAt.toISOString(),count:row.manifest.items.length})) };
}

function builderCoverage(source: Source, records: BuilderRecord[], id: string): SiftGuard['exports'] {
  const parsed = builderSource(source.url);
  const out: SiftGuard['exports'] = [];
  for (const record of records) {
    for (const context of record.context) {
      const exact = ('sourceUrl' in context && context.sourceUrl === source.url) || context.url === source.url;
      const issue = parsed?.kind === 'repository' && parsed.issue !== undefined
        && record.kind === 'repository' && record.repository.toLowerCase() === parsed.repository
        && context.kind === 'issue' && context.number === parsed.issue;
      if (exact || issue) out.push({id,route:'builder',contextKey:context.key,...(context.kind==='code'?{commit:context.commit}:{})});
    }
    if (parsed?.kind==='repository' && parsed.issue===undefined && record.kind==='repository'
      && record.repository.toLowerCase()===parsed.repository) out.push({id,route:'builder'});
    if (parsed?.kind==='package' && record.kind==='package' && record.name===parsed.name
      && (!parsed.version || record.context.some(c=>c.kind==='package-version' && c.version===parsed.version))) {
      out.push({id,route:'builder'});
    }
  }
  return out;
}

export async function siftContextFor(db: Reader, sources: Source[]) {
  const ids=sources.map(x=>x.id);
  if (!ids.length) return new Map<string, { guard:SiftGuard; decision:SiftPreviewItem['decision']; holds:string[] }>();
  const [memberships,decisions,reviews,builder,recipes,knowledge,deliveries] = await Promise.all([
    db.select({linkId:hubLinks.linkId,hubId:hubLinks.hubId,createdAt:timeText}).from(hubLinks).where(inArray(hubLinks.linkId,ids)),
    db.select({decision:siftDecisions,baseline:siftBaselines,application:siftApplications}).from(siftDecisions)
      .leftJoin(siftBaselines,eq(siftDecisions.baselineId,siftBaselines.id))
      .leftJoin(siftApplications,eq(siftDecisions.applicationId,siftApplications.id)).where(inArray(siftDecisions.linkId,ids)),
    db.select().from(reviewProposals).where(inArray(reviewProposals.linkId,ids)),
    db.select().from(builderExports), db.select().from(recipeExports), db.select().from(knowledgeExports),
    db.select({id:azukDeliveries.id,linkId:azukDeliveries.linkId,status:azukDeliveries.status}).from(azukDeliveries).where(inArray(azukDeliveries.linkId,ids)),
  ]);
  return new Map(sources.map(source=>{
    const owner=decisions.find(x=>x.decision.linkId===source.id);
    const review=reviews.find(x=>x.linkId===source.id);
    const member=memberships.filter(x=>x.linkId===source.id).map(({hubId,createdAt})=>({hubId,createdAt})).sort((a,b)=>a.hubId.localeCompare(b.hubId));
    const exports: SiftGuard['exports'] = builder.flatMap(row=>builderCoverage(source,row.records,row.id));
    for (const row of recipes) if (row.payload.recipes.some(r=>r.source.url===source.url)) exports.push({id:row.id,route:'recipe'});
    for (const row of knowledge) if (row.payload.notes.some(n=>n.sources.some(s=>s.url===source.url || s.versionUrl===source.url))) exports.push({id:row.id,route:'knowledge'});
    exports.sort((a,b)=>`${a.id}:${a.contextKey??''}`.localeCompare(`${b.id}:${b.contextKey??''}`));
    const guard:SiftGuard={sourceVersion:sourceVersion(source),protected:source.sessionProtected,
      ...(localSiftInput(source).pageText?{analysisInputDigest:siftDigest(localSiftInput(source))}:{}),
      decisionId:owner?.decision.id??null,decisionRevision:owner?.decision.revision??null,
      memberships:member,review:review?{id:review.id,status:review.status,origin:review.origin,revision:review.revision}:null,
      exports,deliveries:deliveries.filter(x=>x.linkId===source.id).map(({id,status})=>({id,status})).sort((a,b)=>a.id.localeCompare(b.id)),
    };
    const holds:string[]=[];
    if (source.sessionProtected) holds.push('protected-local-only');
    if (source.status!=='active') holds.push('archived');
    if (owner) {
      holds.push('owner-approved-bin');
      if (!member.some(x=>x.hubId===owner.decision.hubId && x.createdAt===owner.decision.membershipCreatedAt)) holds.push('bin-membership-changed');
    }
    if (review && (review.origin==='owner'||review.status!=='pending')) holds.push('owner-review-decision');
    if (exports.length) holds.push('approved-export');
    if (guard.deliveries.length) holds.push('existing-delivery');
    const decision=owner?{id:owner.decision.id,hubId:owner.decision.hubId,bin:owner.decision.bin,
      revision:owner.decision.revision,reference:owner.baseline?.reference??`Approved bin changes ${owner.application!.id}`,
      approvedAt:(owner.baseline?.approvedAt??owner.application!.createdAt).toISOString()}:null;
    return [source.id,{guard,decision,holds}];
  }));
}

async function resolveScope(db: Reader, scope:SiftScope) {
  if (scope.kind==='links') return scope.linkIds.map(x=>x.toLowerCase()).sort();
  if (scope.kind==='baseline') {
    const [row]=await db.select().from(siftBaselines).where(eq(siftBaselines.id,scope.id));
    if (!row) throw new SiftConflict('missing');
    return row.manifest.items.map(x=>x.linkId).sort();
  }
  if (scope.kind==='run') {
    const [row]=await db.select().from(siftRuns).where(eq(siftRuns.id,scope.id));
    if (!row) throw new SiftConflict('missing');
    return [...row.sourceIds];
  }
  const rows=await db.select({id:links.id}).from(links).where(and(eq(links.status,'active'),
    notExists(db.select({id:siftDecisions.id}).from(siftDecisions).where(eq(siftDecisions.linkId,links.id)))))
    .orderBy(desc(links.firstSeen),asc(links.id)).limit(scope.limit);
  return rows.map(x=>x.id).sort();
}

/** Saves analysis only. No reader, provider, route-preparation or apply port exists here. */
export async function saveSiftRun(db: Db, scope:SiftScope):Promise<SiftRunReceipt> {
  const rules=await localSiftRules();
  return db.transaction(async tx=>{
    const ids=await resolveScope(tx,scope);
    if (!ids.length || ids.length>SIFT_SCOPE_LIMIT || new Set(ids).size!==ids.length) throw new SiftConflict('scope_changed');
    // Serialize retries for the same cohort, including its first result inserts.
    const scopeKey=siftDigest(ids);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`);
    const sources=await tx.select().from(links).where(inArray(links.id,ids)).orderBy(asc(links.id)).for('share');
    if (sources.length!==ids.length) throw new SiftConflict('scope_changed');
    const context=await siftContextFor(tx,sources);
    const evaluated=sources.map(source=>{
      const input=localSiftInput(source);
      const key=siftDigest({sourceId:source.id,input,rules:rules.digest,inputVersion:2,mode:'local'});
      const guard=context.get(source.id)!.guard;
      return {source,input,key,guard,guardDigest:siftDigest(guard)};
    });
    const digest=siftDigest(evaluated.map(x=>({linkId:x.source.id,resultKey:x.key,guardDigest:x.guardDigest})));
    const key=siftDigest({scopeKey,rules:rules.digest,digest});
    const [prior]=await tx.select({id:siftRuns.id}).from(siftRuns).where(eq(siftRuns.key,key));
    if (prior) return {id:prior.id,reusedRun:true,reusedResults:ids.length,createdResults:0};
    let createdResults=0;
    const resultIds=new Map<string,string>();
    const cached=await tx.select({id:siftResults.id,key:siftResults.key}).from(siftResults).where(inArray(siftResults.key,evaluated.map(x=>x.key)));
    const cachedByKey=new Map(cached.map(x=>[x.key,x.id]));
    for (const item of evaluated) {
      const cachedId=cachedByKey.get(item.key);
      if (cachedId) {resultIds.set(item.source.id,cachedId);continue;}
      const [created]=await tx.insert(siftResults).values({key:item.key,input:item.input,rulesDigest:rules.digest,computed:localSiftResult(item.input)})
        .onConflictDoNothing({target:siftResults.key}).returning({id:siftResults.id});
      const [result]=created?[created]:await tx.select({id:siftResults.id}).from(siftResults).where(eq(siftResults.key,item.key));
      resultIds.set(item.source.id,result!.id);
      if (created) createdResults++;
    }
    const [previous]=await tx.select({id:siftRuns.id}).from(siftRuns).where(eq(siftRuns.scopeKey,scopeKey))
      .orderBy(desc(siftRuns.createdAt),desc(siftRuns.id)).limit(1);
    const [run]=await tx.insert(siftRuns).values({key,scopeKey,sourceIds:ids,rules,digest,previousRunId:previous?.id??null}).returning({id:siftRuns.id});
    await tx.insert(siftRunItems).values(evaluated.map(x=>({runId:run!.id,linkId:x.source.id,
      resultId:resultIds.get(x.source.id)!,guard:x.guard,guardDigest:x.guardDigest})));
    return {id:run!.id,reusedRun:false,reusedResults:ids.length-createdResults,createdResults};
  });
}

async function runView(db: Reader, id:string) {
  const [run]=await db.select().from(siftRuns).where(eq(siftRuns.id,id));
  if (!run) throw new SiftConflict('missing');
  const sources=await db.select().from(links).where(inArray(links.id,run.sourceIds));
  const visible=sources.filter(x=>!x.sessionProtected);
  // Old snapshots are private too: current protection is checked on every response.
  const summary={id:run.id,createdAt:run.createdAt.toISOString(),scopeCount:run.sourceIds.length,
    visibleCount:visible.length,localOnlyCount:sources.length-visible.length,
    unavailableCount:run.sourceIds.length-sources.length,digest:run.digest,
    rulesVersion:run.rules.version,previousRunId:run.previousRunId};
  return {run,sources:visible,summary};
}

export async function listSiftRuns(db: Db, offset=0) {
  return db.transaction(async tx=>{
    const rows=await tx.select({id:siftRuns.id}).from(siftRuns).orderBy(desc(siftRuns.createdAt),desc(siftRuns.id)).offset(offset).limit(SIFT_PAGE_SIZE+1);
    const items=[];
    for (const row of rows.slice(0,SIFT_PAGE_SIZE)) items.push((await runView(tx,row.id)).summary);
    return {items,more:rows.length>SIFT_PAGE_SIZE};
  },{isolationLevel:'repeatable read',accessMode:'read only'});
}

export async function getSiftPreview(db: Db, id:string, offset=0):Promise<SiftPreview> {
  return db.transaction(async tx=>{
    const {run,sources,summary}=await runView(tx,id);
    const ids=sources.map(x=>x.id);
    const context=await siftContextFor(tx,sources);
    const stored=ids.length?await tx.select({item:siftRunItems,result:siftResults}).from(siftRunItems)
      .innerJoin(siftResults,eq(siftRunItems.resultId,siftResults.id))
      .where(and(eq(siftRunItems.runId,id),inArray(siftRunItems.linkId,ids))).orderBy(asc(siftRunItems.linkId)):[];
    const items:SiftPreviewItem[]=stored.map(({item,result})=>{
      const source=sources.find(x=>x.id===item.linkId)!;
      const current=context.get(source.id)!;
      const changed=item.guardDigest!==siftDigest(current.guard);
      return {link:{id:source.id,url:source.url,title:source.title,status:source.status},resultId:result.id,
        computed:result.computed,decision:current.decision,holds:[...current.holds,...(changed?['source-or-evidence-changed']:[])],
        sourceChanged:changed,review:current.guard.review?{status:current.guard.review.status,origin:current.guard.review.origin,revision:current.guard.review.revision}:null,
        exports:current.guard.exports};
    });
    const counts:SiftPreview['counts']={bins:Object.create(null) as Record<string,number>,suggestedBins:{},dispositions:{},handoffs:{},ownerChoices:0,held:0,exportedSources:0,commitPins:0};
    for (const item of items) {
      if (item.computed.bin) counts.suggestedBins![item.computed.bin.name]=(counts.suggestedBins![item.computed.bin.name]??0)+1;
      counts.dispositions[item.computed.disposition]=(counts.dispositions[item.computed.disposition]??0)+1;
      counts.handoffs[item.computed.handoff]=(counts.handoffs[item.computed.handoff]??0)+1;
      if (item.decision) { counts.ownerChoices++; counts.bins[item.decision.bin]=(counts.bins[item.decision.bin]??0)+1; }
      if (item.holds.length) counts.held++;
      if (item.exports.length) counts.exportedSources++;
      counts.commitPins+=item.exports.filter(x=>x.commit).length;
    }
    let comparison:SiftPreview['comparison']=null;
    if (run.previousRunId) {
      const previous=ids.length?await tx.select().from(siftRunItems).where(and(eq(siftRunItems.runId,run.previousRunId),inArray(siftRunItems.linkId,ids))):[];
      const priorById=new Map(previous.map(x=>[x.linkId,x]));
      comparison={added:0,removed:0,changedAnalysis:0,unchangedAnalysis:0,changedGuards:0};
      for (const {item} of stored) {
        const prior=priorById.get(item.linkId);
        if (!prior) comparison.added++;
        else {
          if (prior.resultId===item.resultId) comparison.unchangedAnalysis++; else comparison.changedAnalysis++;
          if (prior.guardDigest!==item.guardDigest) comparison.changedGuards++;
        }
      }
      comparison.removed=previous.filter(x=>!stored.some(y=>y.item.linkId===x.linkId)).length;
    }
    const applications=await tx.select({preview:siftApplicationPreviews,applicationId:siftApplications.id}).from(siftApplicationPreviews)
      .leftJoin(siftApplications,eq(siftApplications.previewId,siftApplicationPreviews.id))
      .where(eq(siftApplicationPreviews.runId,run.id)).orderBy(desc(siftApplicationPreviews.createdAt),desc(siftApplicationPreviews.id));
    return {...summary,items:items.slice(offset,offset+SIFT_PAGE_SIZE),more:items.length>offset+SIFT_PAGE_SIZE,counts,comparison,
      applicationPreviews:applications.map(({preview,applicationId})=>({id:preview.id,createdAt:preview.createdAt.toISOString(),selectedCount:preview.entries.length,applicationId})),
      usage:{pageReads:0,modelRequests:0,reportedInputTokens:0,newProviderCostUsd:0},proposedChanges:0};
  },{isolationLevel:'repeatable read',accessMode:'read only'});
}
