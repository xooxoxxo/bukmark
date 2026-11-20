import type { FastifyInstance } from 'fastify';
import { Type, type Static } from 'typebox';
import { BOOKMARK_REVIEW_LIMIT, canDownloadReviewedBookmark } from '@bukmark/shared';
import { toNetscapeHtml } from '../export/netscape.js';
import { requireOwnerSession } from '../auth/plugin.js';
import {
  getSiftPreview, importSiftBaseline, listSiftBaselines, listSiftRuns, saveSiftRun,
} from '../sift/history.js';
import { SiftConflict, SIFT_SCOPE_LIMIT } from '../sift/historyModel.js';
import { applySiftApplication, getSiftApplication, getSiftApplicationPreview, prepareSiftApplication } from '../sift/apply.js';

const id=Type.String({format:'uuid'});
const text=(maxLength:number)=>Type.String({minLength:1,maxLength,pattern:'^[^\\u0000]*\\S[^\\u0000]*$'});
const at=Type.String({format:'date-time'});
const object=<T extends Record<string,import('typebox').TSchema>>(properties:T)=>Type.Object(properties,{additionalProperties:false});
const baseline=object({
  reference:text(500),approvedAt:at,
  bins:Type.Array(object({id,name:text(120),count:Type.Integer({minimum:1,maximum:SIFT_SCOPE_LIMIT}),createdAt:at}),{minItems:1,maxItems:100}),
  items:Type.Array(object({linkId:id,hubId:id,membershipCreatedAt:at}),{minItems:1,maxItems:SIFT_SCOPE_LIMIT}),
});
const scope=Type.Union([
  object({kind:Type.Literal('baseline'),id}),object({kind:Type.Literal('run'),id}),
  object({kind:Type.Literal('links'),linkIds:Type.Array(id,{minItems:1,maxItems:SIFT_SCOPE_LIMIT,uniqueItems:true})}),
  object({kind:Type.Literal('next'),limit:Type.Integer({minimum:1,maximum:SIFT_SCOPE_LIMIT})}),
]);
const save=object({scope});
const page=object({offset:Type.Optional(Type.Integer({minimum:0}))});
const digest=Type.String({pattern:'^[a-f0-9]{64}$'});
const applicationPreview=object({digest,hubId:Type.Union([id,Type.Null()]),selection:Type.Union([
  object({kind:Type.Literal('links'),linkIds:Type.Array(id,{minItems:1,maxItems:SIFT_SCOPE_LIMIT,uniqueItems:true})}),
  object({kind:Type.Literal('run')}),
])});
const failures={
  missing:{status:404,body:{error:'Sifting run or decision baseline not found.',code:'missing'}},
  baseline_changed:{status:409,body:{error:'A bin or membership changed. No decision baseline was imported.',code:'baseline_changed'}},
  decision_conflict:{status:409,body:{error:'These sources already have a different recorded owner decision. Existing choices were preserved.',code:'decision_conflict'}},
  scope_changed:{status:409,body:{error:'The selected sources changed or the scope is empty. Review the current selection.',code:'scope_changed'}},
  preview_changed:{status:409,body:{error:'The preview or target bin changed. Create and review a new preview.',code:'preview_changed'}},
  library_busy:{status:409,body:{error:'The library is being edited. Nothing was applied; retry the same approval.',code:'library_busy'}},
} as const;

function unknownKeys(value:unknown,allowed:string[]) {
  return value!==null && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).some(key=>!allowed.includes(key));
}

export async function siftRoutes(app:FastifyInstance, opts:{applyEnabled?:boolean}) {
  // Fastify normally strips additional JSON properties. Explicitly reject execution flags instead.
  app.addHook('preValidation',async(req,reply)=>{
    if(req.method!=='POST' || !req.body || typeof req.body!=='object') return;
    const body=req.body as Record<string,unknown>;
    if(req.routeOptions.url?.endsWith('/application-previews')) {
      const selection=body.selection as Record<string,unknown>|undefined;
      if(unknownKeys(body,['digest','selection','hubId'])
        ||unknownKeys(selection,selection?.kind==='links'?['kind','linkIds']:['kind'])) {
        return reply.code(400).send({error:'Only the reviewed run, selected sources and target bin are accepted.'});
      }
    } else if(req.routeOptions.url?.endsWith('/apply')) {
      if(unknownKeys(body,['digest'])) return reply.code(400).send({error:'Approval accepts only the reviewed preview digest.'});
    } else if(req.routeOptions.url?.endsWith('/runs')) {
      const selected=body.scope as Record<string,unknown>|undefined;
      const allowed=selected?.kind==='links'?['kind','linkIds']:selected?.kind==='next'?['kind','limit']:['kind','id'];
      if(unknownKeys(body,['scope'])||unknownKeys(selected,allowed)) return reply.code(400).send({error:'Only a local preview scope is accepted.'});
    } else if(req.routeOptions.url?.endsWith('/baselines')) {
      if(unknownKeys(body,['reference','approvedAt','bins','items'])
        || (Array.isArray(body.bins)&&body.bins.some(x=>unknownKeys(x,['id','name','count','createdAt'])))
        || (Array.isArray(body.items)&&body.items.some(x=>unknownKeys(x,['linkId','hubId','membershipCreatedAt'])))) {
        return reply.code(400).send({error:'Only owner-decision baseline fields are accepted.'});
      }
    }
  });
  app.addHook('preHandler',requireOwnerSession);
  app.addHook('onSend',async (_req,reply,payload)=>{ reply.header('Cache-Control','no-store'); return payload; });
  app.setErrorHandler((error,_req,reply)=>{
    if (error instanceof SiftConflict) {
      const failure=failures[error.code];
      return reply.code(failure.status).send(failure.body);
    }
    return reply.send(error);
  });
  app.get('/review/sift/baselines',()=>listSiftBaselines(app.db));
  app.post('/review/sift/baselines',{schema:{body:baseline}},req=>importSiftBaseline(app.db,req.body as Static<typeof baseline>));
  app.post('/review/sift/runs',{schema:{body:save}},req=>saveSiftRun(app.db,(req.body as Static<typeof save>).scope));
  app.get('/review/sift/runs',{schema:{querystring:page}},req=>listSiftRuns(app.db,(req.query as Static<typeof page>).offset));
  // Export only the small set the owner reviewed, with current visibility and guards.
  const folderChoices = object({ choices: Type.Array(object({ linkId: id, folder: text(120) }),
    { minItems: 1, maxItems: BOOKMARK_REVIEW_LIMIT }) });
  app.post('/review/sift/runs/:id/bookmark-file', {
    schema: { params: object({ id }), body: folderChoices },
  }, async (req, reply) => {
    const { choices } = req.body as Static<typeof folderChoices>;
    const preview = await getSiftPreview(app.db, (req.params as { id: string }).id);
    if (new Set(choices.map(choice => choice.linkId)).size !== choices.length) {
      return reply.code(400).send({ error: 'Choose each bookmark once.' });
    }
    const records = [];
    for (const choice of choices) {
      const item = preview.items.find(row => row.link.id === choice.linkId);
      if (!item || !canDownloadReviewedBookmark(item)) {
        return reply.code(409).send({ error: 'A selected bookmark needs another review. Reopen the suggestions and check your selection.' });
      }
      records.push({ url: item.link.url, title: item.link.title, hubs: [choice.folder.trim()], note: '' });
    }
    return reply.type('text/html; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="bukmark-reading-list.html"')
      .header('Content-Security-Policy', "default-src 'none'")
      .send(toNetscapeHtml(records, { literalFolderNames: true }));
  });
  app.get('/review/sift/runs/:id',{schema:{params:object({id}),querystring:page}},req=>
    getSiftPreview(app.db,(req.params as {id:string}).id,(req.query as Static<typeof page>).offset));
  app.post('/review/sift/runs/:id/application-previews',{schema:{params:object({id}),body:applicationPreview}},req=>
    prepareSiftApplication(app.db,(req.params as {id:string}).id,req.body as Static<typeof applicationPreview>,opts.applyEnabled));
  app.get('/review/sift/application-previews/:id',{schema:{params:object({id}),querystring:page}},req=>
    getSiftApplicationPreview(app.db,(req.params as {id:string}).id,opts.applyEnabled,(req.query as Static<typeof page>).offset));
  app.post('/review/sift/application-previews/:id/apply',{schema:{params:object({id}),body:object({digest})}},(req,reply)=>{
    if(!opts.applyEnabled) return reply.code(403).send({error:'Applying bin changes is disabled on this instance.',code:'apply_disabled'});
    return applySiftApplication(app.db,(req.params as {id:string}).id,(req.body as {digest:string}).digest);
  });
  app.get('/review/sift/applications/:id',{schema:{params:object({id}),querystring:page}},req=>
    getSiftApplication(app.db,(req.params as {id:string}).id,opts.applyEnabled,(req.query as Static<typeof page>).offset));
}
