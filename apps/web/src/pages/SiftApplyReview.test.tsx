import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { SiftApplicationView, SiftPreview } from '@bukmark/shared/review';
import { makeWrapper } from '../test/utils';
import { SiftApplyReview } from './SiftApplyReview';

afterEach(()=>vi.unstubAllGlobals());
function run():SiftPreview {
  return {id:'run-1',digest:'run-digest',createdAt:'2026-01-01T00:00:00Z',scopeCount:427,visibleCount:427,
    localOnlyCount:0,unavailableCount:0,rulesVersion:'local-url-v1',previousRunId:null,
    items:[{link:{id:'source-1',url:'https://example.org/reference',title:'Public guide',status:'active'},resultId:'result-1',
      computed:{disposition:'reference',handoff:'none',reason:'Guide'},decision:null,holds:[],sourceChanged:false,review:null,exports:[]}],more:false,
    counts:{bins:{},dispositions:{},handoffs:{},ownerChoices:0,held:0,exportedSources:0,commitPins:0},comparison:null,
    usage:{pageReads:0,modelRequests:0,reportedInputTokens:0,newProviderCostUsd:0},proposedChanges:0};
}
function plan(overrides:Partial<SiftApplicationView>={}):SiftApplicationView {
  return {id:'plan-1',previewId:'plan-1',runId:'run-1',digest:'approval-digest',createdAt:'2026-01-01T00:00:00Z',kind:'preview',
    target:{id:'hub-1',name:'References'},selectedCount:427,localOnlyCount:0,unavailableCount:0,
    counts:{ready:0,applied:0,unchanged:0,held:427},items:[],more:false,applyEnabled:false,applicationId:null,...overrides};
}
function mock(view:SiftApplicationView, writes:Array<{path:string;body:unknown}>, approve?:()=>Promise<Response>) {
  const receipt={...view,id:'receipt-1',kind:'receipt' as const,applicationId:'receipt-1',counts:{ready:0,applied:1,unchanged:0,held:0}};
  vi.stubGlobal('fetch',async(input:string,init?:RequestInit)=>{
    const path=new URL(input,'http://localhost').pathname;
    if(path==='/api/hubs') return Response.json({items:[{id:'hub-1',name:'References',status:'active'},{id:'hub-2',name:'Research',status:'active'}]});
    if(init?.method==='POST') {
      writes.push({path,body:JSON.parse(String(init.body))});
      if(path.endsWith('/apply')) return approve?approve():Response.json(receipt);
      return Response.json(view);
    }
    return Response.json(path.includes('/applications/')?receipt:view);
  });
}

it('previews all 427 choices as held and keeps approval disabled',async()=>{
  const writes:Array<{path:string;body:unknown}>=[];mock(plan(),writes);
  const user=userEvent.setup();render(<SiftApplyReview run={run()}/>,{wrapper:makeWrapper()});
  await user.click(screen.getByRole('button',{name:'Preview guarded changes'}));
  expect(await screen.findByRole('status')).toHaveTextContent('427 selected · 0 ready · 0 applied · 0 unchanged · 427 held');
  expect(screen.getByRole('button',{name:'Approve 0 bin changes'})).toBeDisabled();
  expect(screen.getByText('Applying bin changes is disabled on this instance.')).toBeInTheDocument();
  expect(writes).toEqual([{path:'/api/review/sift/runs/run-1/application-previews',body:{digest:'run-digest',hubId:null,selection:{kind:'run'}}}]);
});

it('approves only the reviewed checked subset and retries the exact same digest',async()=>{
  const writes:Array<{path:string;body:unknown}>=[];
  mock(plan({applyEnabled:true,selectedCount:1,counts:{ready:1,applied:0,unchanged:0,held:0}}),writes);
  const user=userEvent.setup();render(<SiftApplyReview run={run()}/>,{wrapper:makeWrapper()});
  await screen.findByRole('option',{name:'References'});
  await user.selectOptions(screen.getByRole('combobox',{name:'Change selection'}),'links');
  expect(screen.getByRole('button',{name:'Preview guarded changes'})).toBeDisabled();
  await user.click(screen.getByRole('checkbox',{name:'Public guide'}));
  await user.selectOptions(screen.getByRole('combobox',{name:'Target bin'}),'hub-1');
  await user.click(screen.getByRole('button',{name:'Preview guarded changes'}));
  await user.click(await screen.findByRole('button',{name:'Approve 1 bin changes'}));
  expect(await screen.findByText('receipt-1')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Retry same approval'}));
  expect(writes).toEqual([
    {path:'/api/review/sift/runs/run-1/application-previews',body:{digest:'run-digest',hubId:'hub-1',selection:{kind:'links',linkIds:['source-1']}}},
    {path:'/api/review/sift/application-previews/plan-1/apply',body:{digest:'approval-digest'}},
    {path:'/api/review/sift/application-previews/plan-1/apply',body:{digest:'approval-digest'}},
  ]);
});

it('discards approval when the target or scope changes and disables held source selection',async()=>{
  const writes:Array<{path:string;body:unknown}>=[];
  mock(plan({applyEnabled:true,counts:{ready:1,applied:0,unchanged:0,held:0}}),writes);
  const source=run();source.items[0]!.holds=['owner-approved-bin'];
  const user=userEvent.setup();render(<SiftApplyReview run={source}/>,{wrapper:makeWrapper()});
  await user.click(screen.getByRole('button',{name:'Preview guarded changes'}));
  await screen.findByRole('button',{name:'Approve 1 bin changes'});
  await user.selectOptions(screen.getByRole('combobox',{name:'Target bin'}),'hub-2');
  expect(screen.queryByRole('button',{name:/Approve/})).not.toBeInTheDocument();
  await user.selectOptions(screen.getByRole('combobox',{name:'Change selection'}),'links');
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(writes).toHaveLength(1);
});

it('preserves the reviewed plan after an approval error so the same request can be retried',async()=>{
  const writes:Array<{path:string;body:unknown}>=[];
  mock(plan({applyEnabled:true,counts:{ready:1,applied:0,unchanged:0,held:0}}),writes,
    async()=>Response.json({error:'Applying bin changes is disabled on this instance.',code:'apply_disabled'},{status:403}));
  const user=userEvent.setup();render(<SiftApplyReview run={run()}/>,{wrapper:makeWrapper()});
  await user.click(screen.getByRole('button',{name:'Preview guarded changes'}));
  await user.click(await screen.findByRole('button',{name:'Approve 1 bin changes'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Applying bin changes is disabled on this instance.');
  expect(screen.getByRole('button',{name:'Approve 1 bin changes'})).toBeEnabled();
});

it('prevents input changes while saving and ignores an old run response after switching runs',async()=>{
  let finish:(response:Response)=>void=()=>{};
  vi.stubGlobal('fetch',async(input:string,init?:RequestInit)=>{
    if(input==='/api/hubs') return Response.json({items:[]});
    if(init?.method==='POST') return new Promise<Response>(resolve=>{finish=resolve;});
    return Response.json(plan());
  });
  const user=userEvent.setup();const root=render(<SiftApplyReview key="one" run={run()}/>,{wrapper:makeWrapper()});
  await user.click(screen.getByRole('button',{name:'Preview guarded changes'}));
  expect(screen.getByRole('button',{name:'Preparing guarded preview…'})).toBeDisabled();
  expect(screen.getByRole('combobox',{name:'Target bin'})).toBeDisabled();
  root.rerender(<SiftApplyReview key="two" run={{...run(),id:'run-2'}}/>);
  finish(Response.json(plan({applyEnabled:true,counts:{ready:1,applied:0,unchanged:0,held:0}})));
  expect(screen.queryByRole('button',{name:/Approve/})).not.toBeInTheDocument();
});

it('reopens the exact stored receipt after refresh and keeps the saved selection separate from new inputs',async()=>{
  const writes:Array<{path:string;body:unknown}>=[];mock(plan(),writes);
  const saved=run();saved.applicationPreviews=[{id:'plan-1',createdAt:'2026-01-01T00:00:00Z',selectedCount:427,applicationId:'receipt-1'}];
  const user=userEvent.setup();render(<SiftApplyReview run={saved}/>,{wrapper:makeWrapper()});
  await user.click(screen.getByText('Saved guarded previews and receipts'));
  await user.click(screen.getByRole('button',{name:/427 selected · Receipt/}));
  expect(await screen.findByText('receipt-1')).toBeInTheDocument();
  expect(screen.getByText('Reviewing a saved selection.')).toBeInTheDocument();
  expect(screen.queryByRole('combobox',{name:'Target bin'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Retry same approval'})).toBeDisabled();
  await user.click(screen.getByRole('button',{name:'Start a new guarded preview'}));
  expect(screen.getByRole('combobox',{name:'Target bin'})).toBeInTheDocument();
  expect(screen.queryByText('receipt-1')).not.toBeInTheDocument();expect(writes).toEqual([]);
});
