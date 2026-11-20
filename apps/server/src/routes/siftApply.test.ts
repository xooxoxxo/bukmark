import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchKey, sha256Hex } from '@bukmark/shared';
import { type SiftApplicationView } from '@bukmark/shared/review';
import { buildApp } from '../app.js';
import { getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { builderExports, hubs, hubLinks, links, reviewProposals, siftApplications, siftApplicationPreviews, siftDecisions } from '../db/schema.js';
import { sourceVersion } from '../review/model.js';
import { authCookie, authHeaders, SAME_ORIGIN } from '../test/auth.js';

const URL=process.env.TEST_DATABASE_URL??'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const BASE='/api/review/sift';
const AT='2026-01-02T03:04:05.123456Z';

describe('guarded bin application',()=>{
  let app:FastifyInstance;
  let cookie:{bukmark_session:string};
  const external=vi.fn(async()=>{throw new Error('External access is forbidden');});
  beforeAll(async()=>{
    await runMigrations(URL);vi.stubGlobal('fetch',external);
    app=await buildApp({databaseUrl:URL,checkUpdates:false,siftApply:true,azuk:null,checkPage:external,builderFetch:external});
  });
  afterAll(async()=>{await app.close();vi.unstubAllGlobals();});
  beforeEach(async()=>{
    await app.db.execute(sql`TRUNCATE links,hubs,sift_runs,sift_baselines,owner,sessions,api_tokens,builder_exports,recipe_exports,knowledge_exports,azuk_deliveries CASCADE`);
    cookie={bukmark_session:(await authCookie(app.db)).cookie};external.mockClear();
  });
  const request=(method:'GET'|'POST',path:string,payload?:unknown)=>app.inject({method,url:BASE+path,payload:payload as object,cookies:cookie,headers:SAME_ORIGIN});
  async function source(overrides:Partial<typeof links.$inferInsert>={}) {
    const url=overrides.url??`https://example.org/${randomUUID()}`;
    return (await app.db.insert(links).values({url,urlHash:sha256Hex(url),matchKey:matchKey(url),title:'Synthetic public guide',...overrides}).returning())[0]!;
  }
  async function hub(name='Reviewed references') {return (await app.db.insert(hubs).values({name}).returning())[0]!;}
  async function save(ids:string[]) {
    const response=await request('POST','/runs',{scope:{kind:'links',linkIds:ids}});expect(response.statusCode,response.body).toBe(200);
    const run=(await request('GET','/runs/'+response.json().id)).json();
    return {id:run.id as string,digest:run.digest as string};
  }
  async function prepare(ids:string[],target:string|null,run?:{id:string;digest:string}) {
    const selected=run??await save(ids);
    const response=await request('POST',`/runs/${selected.id}/application-previews`,{digest:selected.digest,selection:{kind:'links',linkIds:ids},hubId:target});
    expect(response.statusCode,response.body).toBe(200);return response.json() as SiftApplicationView;
  }
  async function apply(plan:SiftApplicationView) {
    const response=await request('POST',`/application-previews/${plan.previewId}/apply`,{digest:plan.digest});
    expect(response.statusCode,response.body).toBe(200);return response.json() as SiftApplicationView;
  }
  async function importChoice(row:typeof links.$inferSelect) {
    const bin=(await app.db.insert(hubs).values({name:'Owner choice',createdAt:sql`${AT}::timestamptz`}).returning())[0]!;
    await app.db.insert(hubLinks).values({linkId:row.id,hubId:bin.id,createdAt:sql`${AT}::timestamptz`});
    const response=await request('POST','/baselines',{reference:'Owner approved this bin',approvedAt:AT,
      bins:[{id:bin.id,name:bin.name,count:1,createdAt:AT}],items:[{linkId:row.id,hubId:bin.id,membershipCreatedAt:AT}]});
    expect(response.statusCode,response.body).toBe(200);return bin;
  }

  it('holds an earlier approval when the consumed cached page text changes',async()=>{
    const row=await source({url:'https://maker.example/',title:'Maker',contentText:'We design synthesizers.',httpStatus:200,checkError:null});
    const target=await hub('Buying research');
    const plan=await prepare([row.id],target.id);
    expect(plan.counts.ready).toBe(1);
    await app.db.update(links).set({contentText:'We sell other manufacturers products.'}).where(eq(links.id,row.id));
    const receipt=await apply(plan);
    expect(receipt.counts).toEqual({ready:0,applied:0,unchanged:0,held:1});
    expect(receipt.items[0]!.reasons).toContain('source-or-evidence-changed');
    expect(await app.db.select().from(siftDecisions)).toEqual([]);
    expect(await app.db.select().from(hubLinks)).toEqual([]);
    expect(external).not.toHaveBeenCalled();
  });

  it('adds only the selected membership and records approval provenance while preserving source fields and topics',async()=>{
    const a=await source({note:'Keep the owner note'}),b=await source(),target=await hub(),topic=await hub('Existing topic');
    await app.db.insert(hubLinks).values({linkId:a.id,hubId:topic.id});
    const run=await save([a.id,b.id]);const plan=await prepare([a.id],target.id,run);
    expect(plan.counts).toEqual({ready:1,applied:0,unchanged:0,held:0});
    expect(await app.db.select().from(siftDecisions)).toHaveLength(0);
    const receipt=await apply(plan);
    expect(receipt.counts).toEqual({ready:0,applied:1,unchanged:0,held:0});
    const [after]=await app.db.select().from(links).where(eq(links.id,a.id));
    const {updatedAt:beforeSync,...beforeFields}=a;
    const {updatedAt:afterSync,...afterFields}=after!;
    expect(afterFields).toEqual(beforeFields);expect(afterSync.getTime()).toBeGreaterThanOrEqual(beforeSync.getTime());
    expect((await app.db.select().from(hubLinks)).map(x=>[x.linkId,x.hubId])).toEqual(expect.arrayContaining([[a.id,topic.id],[a.id,target.id]]));
    expect(await app.db.select().from(hubLinks).where(eq(hubLinks.linkId,b.id))).toHaveLength(0);
    const [decision]=await app.db.select().from(siftDecisions);
    expect(decision).toMatchObject({linkId:a.id,hubId:target.id,bin:target.name,baselineId:null,applicationId:receipt.id,revision:1});
    const next=(await request('GET',`/runs/${run.id}`)).json();
    expect(next.items.find((x:{link:{id:string}})=>x.link.id===a.id).decision).toMatchObject({id:decision!.id,bin:target.name,revision:1});
    expect(next.applicationPreviews).toEqual([{id:plan.id,createdAt:plan.createdAt,selectedCount:1,applicationId:receipt.id}]);
    expect(external).not.toHaveBeenCalled();
  });

  it('reuses preview order and one durable application and decision across concurrent retries',async()=>{
    const a=await source(),b=await source(),target=await hub(),run=await save([a.id,b.id]);
    const plan=await prepare([a.id,b.id],target.id,run);
    expect((await prepare([b.id,a.id],target.id,run)).id).toBe(plan.id);
    const receipts=await Promise.all([apply(plan),apply(plan)]);
    expect(receipts[0]!.id).toBe(receipts[1]!.id);
    const decisions=await app.db.select().from(siftDecisions);
    expect(await apply(plan)).toEqual(receipts[0]);
    expect(await app.db.select().from(siftApplications)).toHaveLength(1);
    expect(await app.db.select().from(siftDecisions)).toEqual(decisions);
    expect(await app.db.select().from(hubLinks)).toHaveLength(2);
    const subset=await prepare([a.id],target.id,run);
    expect(subset.id).not.toBe(plan.id);
    const other=await hub('Another target');expect((await prepare([a.id],other.id,run)).id).not.toBe(subset.id);
  });

  it.each([{title:'Owner edited title'},{note:'Owner edited note'},{status:'archived' as const}])('holds an entry changed after preview: %j',async patch=>{
    const row=await source(),target=await hub(),plan=await prepare([row.id],target.id);
    await app.db.update(links).set(patch).where(eq(links.id,row.id));
    const receipt=await apply(plan);expect(receipt.counts.held).toBe(1);
    expect(receipt.items[0]!.reasons).toContain('source-or-evidence-changed');
    expect(await app.db.select().from(hubLinks)).toHaveLength(0);
    expect(await app.db.select().from(siftDecisions)).toHaveLength(0);
  });

  it('holds new owner decisions and never replaces a recorded decision ID or revision',async()=>{
    const row=await source(),target=await hub(),plan=await prepare([row.id],target.id);
    const ownerBin=await importChoice(row);
    await app.db.update(siftDecisions).set({revision:2}).where(eq(siftDecisions.linkId,row.id));
    const before=await app.db.select().from(siftDecisions);
    const receipt=await apply(plan);expect(receipt.counts.held).toBe(1);
    expect(receipt.items[0]!.reasons).toContain('owner-approved-bin');
    expect(await app.db.select().from(siftDecisions)).toEqual(before);
    expect((await app.db.select().from(hubLinks)).map(x=>x.hubId)).toEqual([ownerBin.id]);
  });

  it.each([{status:'deferred',origin:'assistant'},{status:'dismissed',origin:'assistant'},{status:'pending',origin:'owner'}] as const)(
    'holds a new $status $origin review decision',async({status,origin})=>{
      const row=await source(),target=await hub(),plan=await prepare([row.id],target.id);
      await app.db.insert(reviewProposals).values({linkId:row.id,draft:{action:'reference'},reason:'Owner review',origin,status,sourceVersion:sourceVersion(row),inputKey:'test'});
      const receipt=await apply(plan);expect(receipt.items[0]!.reasons).toContain('owner-review-decision');
      expect(await app.db.select().from(hubLinks)).toHaveLength(0);
    });

  it('holds changed memberships rather than replacing an owner edit',async()=>{
    const row=await source(),target=await hub(),plan=await prepare([row.id],target.id),topic=await hub('Owner added topic');
    await app.db.insert(hubLinks).values({linkId:row.id,hubId:topic.id});
    expect((await apply(plan)).items[0]!.reasons).toContain('source-or-evidence-changed');
    expect((await app.db.select().from(hubLinks)).map(x=>x.hubId)).toEqual([topic.id]);
  });

  it('preserves a new immutable Builder export and its selected commit pin',async()=>{
    const row=await source({url:'https://github.com/sample/tools/blob/main/example.ts'}),target=await hub(),plan=await prepare([row.id],target.id);
    const commit='a'.repeat(40);
    const record={key:'github:42',kind:'repository' as const,name:'sample/tools',repository:'sample/tools',canonicalUrl:'https://github.com/sample/tools',synopsis:'Examples',tags:[],
      context:[{key:'code:approved',kind:'code' as const,entryType:'file' as const,url:`https://github.com/sample/tools/blob/${commit}/example.ts`,sourceUrl:row.url,commit,ref:'main',path:'example.ts'}]};
    await app.db.insert(builderExports).values({key:'approved-context',records:[record],revisions:[]});
    const before=await app.db.select().from(builderExports);
    expect((await apply(plan)).items[0]!.reasons).toContain('approved-export');
    expect(await app.db.select().from(builderExports)).toEqual(before);
    expect(await app.db.select().from(hubLinks)).toHaveLength(0);
  });

  it('holds a new delivery receipt without changing or repeating it',async()=>{
    const row=await source(),target=await hub(),plan=await prepare([row.id],target.id);
    await app.db.execute(sql`insert into azuk_deliveries (link_id,proposal_id,revision,connection,list_id,list_name,listing_url,product_name,trigger,status)
      values (${row.id}::uuid,gen_random_uuid(),1,'test',gen_random_uuid(),'test','https://example.org/listing','test','{"kind":"any_drop"}'::jsonb,'queued')`);
    expect((await apply(plan)).items[0]!.reasons).toContain('existing-delivery');
    expect(await app.db.select().from(hubLinks)).toHaveLength(0);expect(external).not.toHaveBeenCalled();
  });

  it.each(['rename','archive','delete'] as const)('holds a target changed by %s',async change=>{
    const row=await source(),target=await hub(),plan=await prepare([row.id],target.id);
    if(change==='delete') await app.db.delete(hubs).where(eq(hubs.id,target.id));
    else await app.db.update(hubs).set(change==='rename'?{name:'Renamed target'}:{status:'archived'}).where(eq(hubs.id,target.id));
    expect((await apply(plan)).items[0]!.reasons).toContain('target-changed');
    expect(await app.db.select().from(hubLinks)).toHaveLength(0);
  });

  it('reports existing membership as unchanged and never creates a duplicate or inferred decision',async()=>{
    const row=await source(),target=await hub();await app.db.insert(hubLinks).values({linkId:row.id,hubId:target.id});
    const plan=await prepare([row.id],target.id);expect(plan.counts.unchanged).toBe(1);
    expect((await apply(plan)).counts.unchanged).toBe(1);
    expect(await app.db.select().from(hubLinks)).toHaveLength(1);expect(await app.db.select().from(siftDecisions)).toHaveLength(0);
  });

  it('does not revive held entries and applies only the still-current subset',async()=>{
    const good=await source(),changed=await source(),held=await source({status:'archived'}),target=await hub();
    const plan=await prepare([good.id,changed.id,held.id],target.id);
    await app.db.update(links).set({status:'active'}).where(eq(links.id,held.id));
    await app.db.update(links).set({note:'New context'}).where(eq(links.id,changed.id));
    const receipt=await apply(plan);expect(receipt.counts).toEqual({ready:0,applied:1,unchanged:0,held:2});
    expect((await app.db.select().from(hubLinks)).map(x=>x.linkId)).toEqual([good.id]);
  });

  it('redacts newly protected and deleted sources from previews, approval and historical receipt retries',async()=>{
    const protectedRow=await source({title:'Synthetic secret title'}),deleted=await source(),target=await hub();
    const plan=await prepare([protectedRow.id,deleted.id],target.id);
    await app.db.update(links).set({sessionProtected:true}).where(eq(links.id,protectedRow.id));
    await app.db.delete(links).where(eq(links.id,deleted.id));
    const receipt=await apply(plan);
    for(const path of [`/application-previews/${plan.id}`,`/applications/${receipt.id}`]) {
      const result=await request('GET',path);expect(result.json()).toMatchObject({items:[],localOnlyCount:1,unavailableCount:1});
      for(const value of [protectedRow.id,protectedRow.url,protectedRow.title,deleted.id,deleted.url]) expect(result.body).not.toContain(value);
    }
    expect(receipt.items).toEqual([]);expect(receipt.counts.held).toBe(2);
    expect((await apply(plan)).id).toBe(receipt.id);expect(await app.db.select().from(hubLinks)).toHaveLength(0);
    const [sync]=await Promise.all([app.inject({method:'GET',url:'/api/links/changes',cookies:cookie,headers:SAME_ORIGIN})]);
    expect(sync.body).not.toContain(protectedRow.id);expect(external).not.toHaveBeenCalled();
  });

  it('redacts a successful historical receipt after its source becomes protected',async()=>{
    const row=await source(),target=await hub(),plan=await prepare([row.id],target.id),receipt=await apply(plan);
    await app.db.update(links).set({sessionProtected:true}).where(eq(links.id,row.id));
    const retried=await apply(plan);expect(retried).toMatchObject({id:receipt.id,items:[],localOnlyCount:1,counts:{applied:1}});
    expect(JSON.stringify(retried)).not.toContain(row.id);expect(JSON.stringify(retried)).not.toContain(row.url);
    expect(await app.db.select().from(hubLinks)).toHaveLength(1);
  });

  it('rolls back every membership, decision and receipt when a later write fails',async()=>{
    const a=await source(),b=await source(),target=await hub(),plan=await prepare([a.id,b.id],target.id);
    const failId=[a.id,b.id].sort()[1]!;
    await app.db.execute(sql`create function sift_test_fail() returns trigger language plpgsql as $$ begin
      if NEW.link_id = '${sql.raw(failId)}'::uuid then raise exception 'Synthetic failure'; end if; return NEW; end $$`);
    await app.db.execute(sql`create trigger sift_test_failure before insert on sift_decisions for each row execute function sift_test_fail()`);
    try {
      const response=await request('POST',`/application-previews/${plan.id}/apply`,{digest:plan.digest});expect(response.statusCode).toBe(500);
      expect(await app.db.select().from(hubLinks)).toHaveLength(0);expect(await app.db.select().from(siftDecisions)).toHaveLength(0);
      expect(await app.db.select().from(siftApplications)).toHaveLength(0);
    } finally {await app.db.execute(sql`drop trigger sift_test_failure on sift_decisions; drop function sift_test_fail()`);}
    expect((await apply(plan)).counts.applied).toBe(2);
  });

  it('blocks a concurrent membership editor between guard checking and commit',async()=>{
    const row=await source(),target=await hub(),topic=await hub('Original topic');
    await app.db.insert(hubLinks).values({linkId:row.id,hubId:topic.id});
    const plan=await prepare([row.id],target.id),raw=getDb(URL);
    const controller=await raw.sql.reserve(),writer=await raw.sql.reserve();
    await app.db.execute(sql`create function sift_test_pause() returns trigger language plpgsql as $$ begin
      perform pg_advisory_xact_lock(915427); return NEW; end $$`);
    await app.db.execute(sql`create trigger sift_test_pause before insert on hub_links for each row execute function sift_test_pause()`);
    await controller`select pg_advisory_lock(915427)`;
    let applying:Promise<SiftApplicationView>|undefined,editing:Promise<unknown>|undefined;
    try {
      applying=apply(plan);
      let applyingPid=0;
      await vi.waitFor(async()=>{
        const [waiting]=await raw.sql`select pid from pg_locks where locktype='advisory' and objid=915427 and not granted`;
        expect(waiting).toBeDefined();applyingPid=waiting!.pid;
      });
      const [session]=await writer`select pg_backend_pid() pid`;
      editing=writer`delete from hub_links where hub_id=${topic.id} and link_id=${row.id}`.execute();
      await vi.waitFor(async()=>{
        const [blocked]=await raw.sql`select pg_blocking_pids(${session!.pid}::int) blockers`;
        expect(blocked!.blockers).toContain(applyingPid);
      });
      await controller`select pg_advisory_unlock(915427)`;
      expect((await applying).counts.applied).toBe(1);await editing;
      expect((await app.db.select().from(hubLinks)).map(x=>x.hubId)).toEqual([target.id]);
    } finally {
      await controller`select pg_advisory_unlock(915427)`;
      await applying?.catch(()=>{});await editing?.catch(()=>{});
      await app.db.execute(sql`drop trigger sift_test_pause on hub_links; drop function sift_test_pause()`);
      controller.release();writer.release();await raw.sql.end();
    }
  },10000);

  it('returns a retryable conflict without a partial receipt on database lock contention',async()=>{
    const row=await source(),target=await hub(),plan=await prepare([row.id],target.id);
    await app.db.execute(sql`create function sift_test_busy() returns trigger language plpgsql as $$ begin
      raise exception using errcode='55P03', message='Synthetic lock contention'; end $$`);
    await app.db.execute(sql`create trigger sift_test_busy before insert on sift_applications for each row execute function sift_test_busy()`);
    try {
      const response=await request('POST',`/application-previews/${plan.id}/apply`,{digest:plan.digest});
      expect(response.statusCode).toBe(409);expect(response.json().code).toBe('library_busy');
      expect(await app.db.select().from(siftApplications)).toHaveLength(0);expect(await app.db.select().from(hubLinks)).toHaveLength(0);
    } finally {await app.db.execute(sql`drop trigger sift_test_busy on sift_applications; drop function sift_test_busy()`);}
  });

  it('rejects a wrong digest or scope without recording a plan or application',async()=>{
    const row=await source(),outside=await source(),target=await hub(),run=await save([row.id]);
    const input={digest:run.digest,selection:{kind:'links',linkIds:[row.id]},hubId:target.id};
    for(const [id,payload,status] of [[run.id,{...input,digest:'0'.repeat(64)},409],[randomUUID(),input,404],
      [run.id,{...input,selection:{kind:'links',linkIds:[outside.id]}},409],
      [run.id,{...input,selection:{kind:'links',linkIds:[]}},400],
      [run.id,{...input,selection:{kind:'links',linkIds:[row.id,row.id]}},400],
      [run.id,{...input,execute:true},400]] as const) {
      expect((await request('POST',`/runs/${id}/application-previews`,payload)).statusCode).toBe(status);
    }
    expect(await app.db.select().from(siftApplicationPreviews)).toHaveLength(0);
    const plan=await prepare([row.id],target.id,run);
    expect((await request('POST',`/application-previews/${plan.id}/apply`,{digest:'0'.repeat(64)})).statusCode).toBe(409);
    expect((await request('POST',`/application-previews/${plan.id}/apply`,{digest:plan.digest,hubId:target.id})).statusCode).toBe(400);
    expect(await app.db.select().from(siftApplications)).toHaveLength(0);
  });

  it('accepts 1000 explicit selected sources, rejects 1001, and paginates independently of totals',async()=>{
    const rows=await app.db.insert(links).values(Array.from({length:1000},(_,i)=>({url:`https://example.org/boundary/${i}`,urlHash:sha256Hex(String(i))}))).returning();
    const ids=rows.map(x=>x.id),target=await hub(),run=await save(ids),plan=await prepare(ids,target.id,run);
    expect(plan.selectedCount).toBe(1000);expect(plan.items).toHaveLength(25);expect(plan.more).toBe(true);
    const page=(await request('GET',`/application-previews/${plan.id}?offset=975`)).json();
    expect(page.items).toHaveLength(25);expect(page.more).toBe(false);expect(page.counts.ready).toBe(1000);
    const tooMany=await request('POST',`/runs/${run.id}/application-previews`,{digest:run.digest,hubId:target.id,selection:{kind:'links',linkIds:[...ids,randomUUID()]}});
    expect(tooMany.statusCode).toBe(400);
  });

  it('requires the owner session, correct origin and default-off application permission',async()=>{
    const row=await source(),target=await hub(),run=await save([row.id]),plan=await prepare([row.id],target.id,run);
    const token=await authHeaders(app.db),path=`/application-previews/${plan.id}/apply`,payload={digest:plan.digest};
    expect((await app.inject({method:'POST',url:BASE+path,payload})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:BASE+path,payload,headers:token})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:BASE+`/runs/${run.id}/application-previews`,
      payload:{digest:run.digest,hubId:target.id,selection:{kind:'run'}},headers:token})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:BASE+path,payload,cookies:cookie,headers:{...SAME_ORIGIN,origin:'https://wrong.example'}})).statusCode).toBe(403);
    for(const read of [`/application-previews/${plan.id}`,`/applications/${randomUUID()}`])
      expect((await app.inject({method:'GET',url:BASE+read,headers:token})).statusCode).toBe(403);
    const disabled=await buildApp({databaseUrl:URL,checkUpdates:false,azuk:null});
    try {
      const result=await disabled.inject({method:'POST',url:BASE+path,payload,cookies:cookie,headers:SAME_ORIGIN});
      expect(result.statusCode).toBe(403);expect(result.json().code).toBe('apply_disabled');
    } finally {await disabled.close();}
    expect(await app.db.select().from(hubLinks)).toHaveLength(0);expect(await app.db.select().from(siftApplications)).toHaveLength(0);
  });
});
