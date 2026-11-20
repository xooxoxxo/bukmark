import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex, matchKey } from '@bukmark/shared';
import { type SiftBaselineInput, type SiftPreview } from '@bukmark/shared/review';
import { buildApp } from '../app.js';
import { runMigrations } from '../db/migrate.js';
import { builderDrafts, builderDraftSources, builderExports, hubLinks, hubs, links, reviewProposals, siftResults } from '../db/schema.js';
import { authCookie, authHeaders, SAME_ORIGIN } from '../test/auth.js';

const TEST_URL=process.env.TEST_DATABASE_URL??'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const BASE='/api/review/sift';
const AT='2026-01-02T03:04:05.123456Z';
const COMMIT='a'.repeat(40);

describe('saved local sifting previews',()=>{
  let app:FastifyInstance;
  let cookie:{bukmark_session:string};
  const external=vi.fn(async()=>{throw new Error('No external read is allowed');});
  beforeAll(async()=>{
    await runMigrations(TEST_URL);
    vi.stubGlobal('fetch',external);
    app=await buildApp({databaseUrl:TEST_URL,checkUpdates:false,azuk:null,checkPage:external,builderFetch:external});
  });
  afterAll(async()=>{await app.close();vi.unstubAllGlobals();});
  beforeEach(async()=>{
    await app.db.execute(sql`TRUNCATE sift_run_items,sift_runs,sift_results,sift_decisions,sift_baselines,
      links,hubs,builder_drafts,builder_exports,recipe_drafts,recipe_exports,knowledge_notes,knowledge_exports,
      azuk_deliveries,owner,sessions,api_tokens CASCADE`);
    cookie={bukmark_session:(await authCookie(app.db)).cookie};
    external.mockClear();
  });
  const request=(method:'GET'|'POST',path:string,payload?:unknown)=>app.inject({method,url:BASE+path,payload:payload as object,cookies:cookie,headers:SAME_ORIGIN});
  async function source(url='https://example.org/guide',overrides:Partial<typeof links.$inferInsert>={}) {
    const [row]=await app.db.insert(links).values({url,urlHash:sha256Hex(url),matchKey:matchKey(url),title:'Stored guide',...overrides}).returning();
    return row!;
  }
  async function baseline(rows:Array<typeof links.$inferSelect>) {
    const [hub]=await app.db.insert(hubs).values({name:'Buying research',createdAt:sql`${AT}::timestamptz`}).returning();
    await app.db.insert(hubLinks).values(rows.map(row=>({linkId:row.id,hubId:hub!.id,createdAt:sql`${AT}::timestamptz`})));
    const input:SiftBaselineInput={reference:'Owner approved fixture',approvedAt:AT,
      bins:[{id:hub!.id,name:hub!.name,count:rows.length,createdAt:AT}],
      items:rows.map(row=>({linkId:row.id,hubId:hub!.id,membershipCreatedAt:AT}))};
    return input;
  }
  async function save(ids:string[]) {
    const response=await request('POST','/runs',{scope:{kind:'links',linkIds:ids}});
    expect(response.statusCode,response.body).toBe(200);
    return response.json() as {id:string;reusedRun:boolean;createdResults:number;reusedResults:number};
  }
  async function preview(id:string,offset=0) {
    const response=await request('GET',`/runs/${id}?offset=${offset}`);
    expect(response.statusCode,response.body).toBe(200);
    return response.json() as SiftPreview;
  }
  async function originalRows() {
    const rows=await app.db.execute(sql`select jsonb_build_object(
      'links',(select jsonb_agg(to_jsonb(t) order by id) from links t),
      'memberships',(select jsonb_agg(to_jsonb(t) order by link_id,hub_id) from hub_links t),
      'reviews',(select jsonb_agg(to_jsonb(t) order by id) from review_proposals t),
      'exports',(select jsonb_agg(to_jsonb(t) order by id) from builder_exports t),
      'deliveries',(select jsonb_agg(to_jsonb(t) order by id) from azuk_deliveries t)) snapshot`);
    return rows[0]!.snapshot;
  }

  it('downloads only the chosen current bookmarks and checks protection again on retry', async () => {
    const guide = await source('https://example.org/docs/intro', { title: 'Guide & examples' });
    const account = await source('https://example.org/account');
    const other = await source('https://example.org/outside');
    const { id } = await save([guide.id, account.id]);
    const before = await originalRows();
    const download = (...ids: string[]) => request('POST', `/runs/${id}/bookmark-file`, {
      choices: ids.map(linkId => ({ linkId, folder: 'Read <later>' })),
    });
    const first = await download(guide.id);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.headers['content-disposition']).toContain('attachment');
    expect(first.body).toContain('Read &lt;later&gt;');
    expect(first.body).toContain('Guide &amp; examples');
    expect(first.body).not.toContain(account.url);
    expect((await download(guide.id)).body).toBe(first.body);
    const named = await request('POST', `/runs/${id}/bookmark-file`, { choices: [{ linkId: guide.id, folder: 'Unsorted' }] });
    expect(named.body).toContain('<H3>Unsorted</H3>');
    expect((await download(guide.id, guide.id)).statusCode).toBe(400);
    expect((await download(guide.id, other.id)).statusCode).toBe(409);
    expect((await download(guide.id, account.id)).statusCode).toBe(409);
    expect(await originalRows()).toEqual(before);
    await app.db.update(links).set({ sessionProtected: true }).where(eq(links.id, guide.id));
    expect((await download(guide.id)).statusCode).toBe(409);
    expect(external).not.toHaveBeenCalled();
  });

  it('records imported approval once and reuses saved results without changing library records',async()=>{
    const a=await source('https://mod.example/dwarf/');
    const b=await source('https://example.org/reference');
    const input=await baseline([a,b]);
    const before=await originalRows();
    const imported=await request('POST','/baselines',input);
    expect(imported.statusCode,imported.body).toBe(200);
    const retry=await request('POST','/baselines',{...input,items:[...input.items].reverse()});
    expect(retry.json()).toEqual({id:imported.json().id,count:2,reused:true});
    const first=await save([a.id,b.id]);
    expect(first).toEqual({id:first.id,reusedRun:false,reusedResults:0,createdResults:2});
    expect(await save([b.id,a.id])).toEqual({id:first.id,reusedRun:true,reusedResults:2,createdResults:0});
    const current=await preview(first.id);
    expect(current.counts.bins).toEqual({'Buying research':2});
    expect(current.counts.suggestedBins).toEqual({'Needs review':2});
    expect(current.items.every(x=>x.computed.bin?.ruleId==='fallback')).toBe(true);
    expect(current.rulesVersion).toBe('local-seven-bin-v5');
    expect(current.items.find(x=>x.link.id===a.id)?.decision).toMatchObject({bin:'Buying research',reference:'Owner approved fixture',revision:1});
    expect(current.proposedChanges).toBe(0);
    expect(current.usage).toEqual({pageReads:0,modelRequests:0,reportedInputTokens:0,newProviderCostUsd:0});
    expect(await originalRows()).toEqual(before);
    expect(external).not.toHaveBeenCalled();
  });

  it('rejects a stale membership atomically and refuses to replace existing provenance',async()=>{
    const row=await source();
    const input=await baseline([row]);
    expect((await request('POST','/baselines',{...input,items:[{...input.items[0]!,membershipCreatedAt:'2026-01-02T03:04:05.123457Z'}]})).statusCode).toBe(409);
    expect((await request('GET','/baselines')).json()).toEqual({items:[]});
    expect((await request('POST','/baselines',input)).statusCode).toBe(200);
    const conflict=await request('POST','/baselines',{...input,reference:'A different unapproved reference'});
    expect(conflict.json().code).toBe('decision_conflict');
    expect((await request('GET','/baselines')).json().items).toHaveLength(1);
  });

  it('reads historical computed JSON without inventing bin evidence or changing its owner decision',async()=>{
    const row=await source();await request('POST','/baselines',await baseline([row]));
    const run=await save([row.id]);const current=await preview(run.id);
    const historical={disposition:'needs_review' as const,handoff:'none' as const,reason:'Historical local analysis.'};
    await app.db.update(siftResults).set({computed:historical}).where(eq(siftResults.id,current.items[0]!.resultId));
    const old=await preview(run.id);
    expect(old.items[0]!.computed).toEqual(historical);
    expect(old.counts.suggestedBins).toEqual({});
    expect(old.items[0]!.decision).toEqual(current.items[0]!.decision);
    expect(old.items[0]!.holds).toContain('owner-approved-bin');
  });

  it('rejects a changed bin count rather than importing a partial historical cohort',async()=>{
    const a=await source();const input=await baseline([a]);
    const b=await source('https://example.org/new');
    await app.db.insert(hubLinks).values({linkId:b.id,hubId:input.bins[0]!.id,createdAt:sql`${AT}::timestamptz`});
    expect((await request('POST','/baselines',input)).statusCode).toBe(409);
    expect((await request('GET','/baselines')).json()).toEqual({items:[]});
  });

  it('creates one new result for a consumed input change and only a new guard for a note change',async()=>{
    const a=await source();const b=await source('https://example.org/two');
    const input=await baseline([a,b]);await request('POST','/baselines',input);
    const first=await save([a.id,b.id]);const original=await preview(first.id);
    await app.db.update(links).set({title:'An edited title'}).where(eq(links.id,a.id));
    const changed=await save([a.id,b.id]);
    expect(changed.createdResults).toBe(1);expect(changed.reusedResults).toBe(1);
    expect((await preview(changed.id)).comparison).toEqual({added:0,removed:0,changedAnalysis:1,unchangedAnalysis:1,changedGuards:1});
    expect((await preview(changed.id)).counts.bins).toEqual({'Buying research':2});
    await app.db.update(links).set({note:'Private context never consumed by the classifier'}).where(eq(links.id,b.id));
    const note=await save([a.id,b.id]);
    expect(note.createdResults).toBe(0);expect(note.reusedResults).toBe(2);
    expect((await preview(note.id)).comparison).toEqual({added:0,removed:0,changedAnalysis:0,unchangedAnalysis:2,changedGuards:1});
    expect((await preview(first.id)).items.find(x=>x.link.id===a.id)?.sourceChanged).toBe(true);
    expect(original.items.every(x=>!x.sourceChanged)).toBe(true);
  });

  it('keeps protected results on the server and redacts older history after protection changes',async()=>{
    const privateRow=await source('https://github.com/private/tools',{title:'Never transmit this title',sessionProtected:true});
    const publicRow=await source('https://example.org/public');
    const saved=await save([privateRow.id,publicRow.id]);
    const first=await preview(saved.id);
    expect(first.localOnlyCount).toBe(1);expect(first.items.map(x=>x.link.id)).toEqual([publicRow.id]);
    expect(await app.db.select().from(siftResults)).toHaveLength(2);
    await app.db.update(links).set({sessionProtected:true}).where(eq(links.id,publicRow.id));
    for(const path of [`/runs/${saved.id}`,`/runs/${saved.id}?offset=25`,'/runs','/baselines']) {
      const response=await request('GET',path);
      for(const secret of [privateRow.id,privateRow.url,privateRow.title,publicRow.id,publicRow.url]) expect(response.body).not.toContain(secret);
    }
    const hidden=await preview(saved.id);
    expect(hidden.localOnlyCount).toBe(2);expect(hidden.items).toEqual([]);
    expect(hidden.counts.ownerChoices).toBe(0);
    expect(external).not.toHaveBeenCalled();
  });

  it('keys and guards consumed page evidence while preserving owner choices and ignoring text beyond its bound',async()=>{
    const prefix='We design synthesizers. '.padEnd(4096,'x');
    const row=await source('https://maker.example/',{title:'Maker',contentText:prefix+' old tail',httpStatus:200,checkError:null});
    await request('POST','/baselines',await baseline([row]));
    const first=await save([row.id]);const original=await preview(first.id);
    expect(original.items[0]!.computed.bin?.name).toBe('Buying research');
    expect((await app.db.select().from(siftResults))[0]!.input).toEqual({
      url:'https://maker.example/',title:'Maker',status:'active',pageText:prefix,
    });
    await app.db.update(links).set({contentText:prefix+' changed tail'}).where(eq(links.id,row.id));
    expect(await save([row.id])).toEqual({id:first.id,reusedRun:true,reusedResults:1,createdResults:0});
    await app.db.update(links).set({contentText:'We sell plugins from other makers.'}).where(eq(links.id,row.id));
    const changed=await save([row.id]);expect(changed.createdResults).toBe(1);
    const current=await preview(changed.id);
    expect(current.items[0]!.computed.bin?.name).toBe('Needs review');
    expect(current.items[0]!.decision).toEqual(original.items[0]!.decision);
    expect(current.items[0]!.holds).toContain('owner-approved-bin');
    expect((await preview(first.id)).items[0]!.sourceChanged).toBe(true);
    expect(current.comparison).toEqual({added:0,removed:0,changedAnalysis:1,unchangedAnalysis:0,changedGuards:1});
    expect(external).not.toHaveBeenCalled();
  });

  it('withholds protected cached text from responses and excludes a failed cached check from analysis',async()=>{
    const row=await source('https://maker.example/',{title:'Maker',contentText:'We design synthesizers. Private local sentinel',httpStatus:404,sessionProtected:true});
    const saved=await save([row.id]);
    const response=await request('GET','/runs/'+saved.id);
    expect(response.body).not.toContain('Private local sentinel');
    expect(response.json().items).toEqual([]);
    const results=await app.db.select().from(siftResults);
    expect(results[0]!.input).not.toHaveProperty('pageText');
    expect(external).not.toHaveBeenCalled();
  });

  it('keeps technical article evidence local and creates a new result when consumed instruction text changes',async()=>{
    const row=await source('https://example.org/css-layout',{title:'CSS layout details',httpStatus:200,checkError:null,
      contentText:'This article explains how grid sizing works.'});
    await request('POST','/baselines',await baseline([row]));
    const first=await save([row.id]);const old=await preview(first.id);
    expect(old.items[0]!.computed.bin?.name).toBe('Technical reference');
    await app.db.update(links).set({contentText:'A general CSS topic without an instructional context.'}).where(eq(links.id,row.id));
    const changed=await save([row.id]);expect(changed.createdResults).toBe(1);
    const current=await preview(changed.id);
    expect(current.items[0]!.computed.bin?.name).toBe('Needs review');
    expect(current.items[0]!.decision).toEqual(old.items[0]!.decision);
    expect((await preview(first.id)).items[0]!.sourceChanged).toBe(true);
    await app.db.update(links).set({sessionProtected:true}).where(eq(links.id,row.id));
    const response=await request('GET','/runs/'+first.id);
    expect(response.json().items).toEqual([]);
    for(const value of [row.id,row.url,row.title,'This article explains how grid sizing works.'])expect(response.body).not.toContain(value);
    expect(external).not.toHaveBeenCalled();
  });

  it('records new AI evidence without replacing a prior owner bin and redacts it after protection changes',async()=>{
    const row=await source('https://example.org/neural-networks',{title:'Neural network details',httpStatus:200,checkError:null,
      contentText:'This article explains model inference. Local-only sentinel'});
    await request('POST','/baselines',await baseline([row]));
    const first=await save([row.id]);const original=await preview(first.id);
    expect(original.items[0]!.computed.bin?.name).toBe('Technical reference');
    expect(original.items[0]!.decision?.bin).toBe('Buying research');
    expect(await save([row.id])).toEqual({id:first.id,reusedRun:true,reusedResults:1,createdResults:0});
    await app.db.update(links).set({contentText:'Unstructured neural network information.'}).where(eq(links.id,row.id));
    const changed=await save([row.id]);expect(changed.createdResults).toBe(1);
    expect((await preview(changed.id)).items[0]!.decision).toEqual(original.items[0]!.decision);
    expect((await preview(first.id)).items[0]!.sourceChanged).toBe(true);
    await app.db.update(links).set({sessionProtected:true}).where(eq(links.id,row.id));
    const response=await request('GET','/runs/'+first.id);
    expect(response.json().items).toEqual([]);expect(response.body).not.toContain('Local-only sentinel');
    expect(response.body).not.toContain(row.url);expect(external).not.toHaveBeenCalled();
  });

  it('reuses a forum-reply result when cached body changes while retaining the exact reply and owner decision',async()=>{
    const row=await source('https://community.example.org/t/prompt-tips/123/2',{title:'AI model training guide',httpStatus:200,
      contentText:'This article explains model training. Local reply sentinel'});
    await request('POST','/baselines',await baseline([row]));
    const first=await save([row.id]);const original=await preview(first.id);
    expect(original.items[0]!.computed.bin?.name).toBe('Discussions and answers');
    expect(original.items[0]!.link.url).toBe('https://community.example.org/t/prompt-tips/123/2');
    expect((await app.db.select().from(siftResults))[0]!.input).not.toHaveProperty('pageText');
    await app.db.update(links).set({contentText:'Changed reply content.'}).where(eq(links.id,row.id));
    expect(await save([row.id])).toEqual({id:first.id,reusedRun:true,reusedResults:1,createdResults:0});
    expect((await preview(first.id)).items[0]!.decision).toEqual(original.items[0]!.decision);
    await app.db.update(links).set({sessionProtected:true}).where(eq(links.id,row.id));
    const response=await request('GET','/runs/'+first.id);
    expect(response.json().items).toEqual([]);expect(response.body).not.toContain(row.url);
    expect(response.body).not.toContain('Local reply sentinel');expect(external).not.toHaveBeenCalled();
  });

  it('records a changed primary-post interpretation without replacing its owner choice',async()=>{
    const row=await source('https://community.example.org/t/topic/123/1',{title:'A general update'});
    await request('POST','/baselines',await baseline([row]));
    const first=await save([row.id]);const original=await preview(first.id);
    expect(original.items[0]!.computed.bin?.name).toBe('Discussions and answers');
    await app.db.update(links).set({title:'AI model training guide'}).where(eq(links.id,row.id));
    const next=await save([row.id]);expect(next.createdResults).toBe(1);
    const current=await preview(next.id);expect(current.items[0]!.computed.bin?.name).toBe('Technical reference');
    expect(current.items[0]!.decision).toEqual(original.items[0]!.decision);
    expect((await preview(first.id)).items[0]!.sourceChanged).toBe(true);expect(external).not.toHaveBeenCalled();
  });

  it('recognizes only selected immutable export context and preserves pending source proposals',async()=>{
    const a=await source('https://github.com/sample/tools/blob/main/example.ts');
    const b=await source('https://github.com/sample/tools/blob/main/later.ts');
    const record={key:'github:42',kind:'repository' as const,name:'sample/tools',repository:'sample/tools',canonicalUrl:'https://github.com/sample/tools',synopsis:'Examples',tags:[],
      context:[{key:'code:approved',kind:'code' as const,entryType:'file' as const,url:`https://github.com/sample/tools/blob/${COMMIT}/example.ts`,sourceUrl:a.url,commit:COMMIT,ref:'main',path:'example.ts'}]};
    const [draft]=await app.db.insert(builderDrafts).values({key:record.key,record}).returning();
    await app.db.insert(builderDraftSources).values([a,b].map(x=>({draftId:draft!.id,linkId:x.id})));
    const [exported]=await app.db.insert(builderExports).values({key:'selected-export',revisions:[],records:[record]}).returning();
    await app.db.insert(reviewProposals).values({linkId:a.id,draft:{action:'undecided'},reason:'Pending context',origin:'assistant',sourceVersion:'old',inputKey:'old'});
    const before=await originalRows();
    const saved=await save([a.id,b.id]);const current=await preview(saved.id);
    expect(current.items.find(x=>x.link.id===a.id)?.exports).toEqual([{id:exported!.id,route:'builder',contextKey:'code:approved',commit:COMMIT}]);
    expect(current.items.find(x=>x.link.id===a.id)?.holds).toContain('approved-export');
    expect(current.items.find(x=>x.link.id===b.id)?.exports).toEqual([]);
    expect(current.counts.commitPins).toBe(1);
    expect(await originalRows()).toEqual(before);
  });

  it.each([
    {status:'deferred',origin:'assistant'},{status:'dismissed',origin:'assistant'},
    {status:'applied',origin:'assistant'},{status:'pending',origin:'owner'},
  ] as const)('holds an $origin-origin $status owner decision',async({status,origin})=>{
    const row=await source();
    await app.db.insert(reviewProposals).values({linkId:row.id,draft:{action:'reference'},reason:'Reviewed',origin,status,sourceVersion:'v1',inputKey:status});
    const saved=await save([row.id]);
    expect((await preview(saved.id)).items[0]?.holds).toContain('owner-review-decision');
  });

  it('retains recorded decisions when a membership or source disappears',async()=>{
    const row=await source();const input=await baseline([row]);await request('POST','/baselines',input);
    const saved=await save([row.id]);
    await app.db.delete(hubLinks).where(eq(hubLinks.linkId,row.id));
    expect((await preview(saved.id)).items[0]?.holds).toContain('bin-membership-changed');
    expect((await preview(saved.id)).items[0]?.decision?.bin).toBe('Buying research');
    await app.db.delete(links).where(eq(links.id,row.id));
    const gone=await preview(saved.id);expect(gone.items).toEqual([]);expect(gone.unavailableCount).toBe(1);
    expect((await request('POST','/runs',{scope:{kind:'run',id:saved.id}})).statusCode).toBe(409);
  });

  it('requires an owner session for history and baseline writes and offers no apply endpoint',async()=>{
    const token=await authHeaders(app.db);
    expect((await app.inject({method:'GET',url:BASE+'/runs'})).statusCode).toBe(401);
    for(const path of ['/runs','/baselines']) expect((await app.inject({method:'GET',url:BASE+path,headers:token})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:BASE+'/runs',headers:token,payload:{scope:{kind:'next',limit:1}}})).statusCode).toBe(403);
    expect((await request('POST','/apply',{})).statusCode).toBe(404);
  });

  it('rejects invalid scope and unknown execution controls without creating runs',async()=>{
    const row=await source();
    for(const payload of [
      {scope:{kind:'links',linkIds:[]}}, {scope:{kind:'links',linkIds:[row.id,row.id]}},
      {scope:{kind:'next',limit:1001}}, {scope:{kind:'next',limit:0}},
      {scope:{kind:'links',linkIds:[row.id]},apply:true}, {scope:{kind:'next',limit:1,model:true}},
    ]) expect((await request('POST','/runs',payload)).statusCode).toBe(400);
    expect((await request('POST','/runs',{scope:{kind:'links',linkIds:Array.from({length:1000},()=>randomUUID())}})).statusCode).toBe(409);
    expect((await request('GET','/runs')).json().items).toEqual([]);
  });

  it('paginates preview items at 25 with total counts independent of the page',async()=>{
    const rows=[];for(let i=0;i<26;i++) rows.push(await source(`https://example.org/${i}`));
    const saved=await save(rows.map(x=>x.id));
    const first=await preview(saved.id);const second=await preview(saved.id,25);
    expect(first.items).toHaveLength(25);expect(first.more).toBe(true);
    expect(second.items).toHaveLength(1);expect(second.more).toBe(false);
    expect(second.counts).toEqual(first.counts);
    expect(new Set([...first.items,...second.items].map(x=>x.link.id)).size).toBe(26);
  });

  it('reuses one committed run when identical preview requests arrive together',async()=>{
    const row=await source();
    const receipts=await Promise.all([save([row.id]),save([row.id])]);
    expect(receipts[0]!.id).toBe(receipts[1]!.id);
    expect(receipts.map(x=>x.createdResults).sort()).toEqual([0,1]);
    expect((await request('GET','/runs')).json().items).toHaveLength(1);
    expect(await app.db.select().from(siftResults)).toHaveLength(1);
  });

  it('paginates saved run history without losing earlier previews',async()=>{
    const row=await source();const saved=[];
    for(let i=0;i<26;i++) {
      await app.db.update(links).set({title:`Preview input ${i}`}).where(eq(links.id,row.id));
      saved.push(await save([row.id]));
    }
    const first=(await request('GET','/runs?offset=0')).json();
    const second=(await request('GET','/runs?offset=25')).json();
    expect(first.items).toHaveLength(25);expect(first.more).toBe(true);
    expect(second.items).toHaveLength(1);expect(second.more).toBe(false);
    expect(new Set([...first.items,...second.items].map(x=>x.id))).toEqual(new Set(saved.map(x=>x.id)));
  });
});
