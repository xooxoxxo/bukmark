import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { SiftPreview } from '@bukmark/shared';
import { makeWrapper } from '../test/utils';
import { SiftReview } from './SiftReview';

afterEach(()=>vi.unstubAllGlobals());
const run={id:'run-1',createdAt:'2026-01-02T03:04:05Z',scopeCount:427,visibleCount:427,localOnlyCount:0,
  unavailableCount:0,digest:'stable-digest',rulesVersion:'local-url-v1',previousRunId:null};
function preview():SiftPreview {
  return {...run,items:[{link:{id:'source',url:'https://example.org/dwarf',title:'MOD Dwarf',status:'active'},resultId:'result',
    computed:{disposition:'needs_review',handoff:'none',reason:'More context needed.'},
    decision:{id:'decision',hubId:'hub',bin:'Buying research',revision:1,reference:'Owner approved this batch',approvedAt:'2026-01-02T03:04:05Z'},
    holds:['owner-approved-bin'],sourceChanged:false,review:null,exports:[]}],more:false,
    counts:{bins:{'Buying research':11,'Needs review':233},dispositions:{needs_review:370,reference:57},
      handoffs:{none:347,builder:57,azuk:23},ownerChoices:427,held:427,exportedSources:43,commitPins:37},
    comparison:null,usage:{pageReads:0,modelRequests:0,reportedInputTokens:0,newProviderCostUsd:0},proposedChanges:0};
}
const baselines={items:[{id:'baseline-1',reference:'Owner approved this batch',approvedAt:'2026-01-02T03:04:05Z',count:427}]};

it('saves and retries the reviewed batch, shows preserved provenance and offers preview actions only',async()=>{
  const writes:unknown[]=[];let saved=false;
  vi.stubGlobal('fetch',async(input:string,init?:RequestInit)=>{
    const url=new URL(input,'http://localhost');
    if(url.pathname.endsWith('/baselines')) return Response.json(baselines);
    if(init?.method==='POST') {
      writes.push(JSON.parse(String(init.body)));const reused=saved;saved=true;
      return Response.json({id:'run-1',reusedRun:reused,reusedResults:reused?427:0,createdResults:reused?0:427});
    }
    if(url.pathname.endsWith('/runs')) return Response.json({items:saved?[run]:[],more:false});
    return Response.json(preview());
  });
  const user=userEvent.setup();
  render(<SiftReview linkId={null}/>,{wrapper:makeWrapper()});
  await screen.findByRole('option',{name:/Reviewed batch · 427/});
  await user.selectOptions(screen.getByRole('combobox',{name:'Preview scope'}),'baseline:baseline-1');
  await user.click(screen.getByRole('button',{name:'Save local preview'}));
  await screen.findByText('Saved preview. 427 new results; 0 results reused.');
  expect(await screen.findByText('Your bin: Buying research')).toBeInTheDocument();
  expect(screen.getByText('Your bin choice is preserved.')).toBeInTheDocument();
  await user.click(screen.getByText('Decision and source evidence'));
  expect(screen.getByText(/Approval: Owner approved this batch/)).toBeVisible();
  await user.click(screen.getByRole('button',{name:'Save local preview'}));
  await screen.findByText('Reused the saved preview. 427 results reused.');
  expect(writes).toEqual([{scope:{kind:'baseline',id:'baseline-1'}},{scope:{kind:'baseline',id:'baseline-1'}}]);
  expect(screen.queryByRole('button',{name:/apply|approve|export/i})).not.toBeInTheDocument();
});

it('loads saved history and preview pages while showing protected counts without source details',async()=>{
  const reads:string[]=[];
  vi.stubGlobal('fetch',async(input:string)=>{
    const url=new URL(input,'http://localhost');reads.push(url.pathname+url.search);
    if(url.pathname.endsWith('/baselines')) return Response.json({items:[]});
    if(url.pathname.endsWith('/runs')) return Response.json({items:[run],more:url.searchParams.get('offset')!=='25'});
    const data=preview();data.localOnlyCount=1;
    data.more=url.searchParams.get('offset')!=='25';
    if(!data.more) data.items=[{...data.items[0]!,link:{id:'second',url:'https://example.org/two',title:'Next preview page',status:'active'}}];
    return Response.json(data);
  });
  const user=userEvent.setup();render(<SiftReview linkId={null}/>,{wrapper:makeWrapper()});
  await user.click(await screen.findByRole('button',{name:/427 bookmarks/}));
  await screen.findByText('Your bin: Buying research');
  expect(screen.getByText('1 protected bookmark was analyzed locally. Their details stay on the server.')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Next preview page'}));
  await screen.findByRole('link',{name:'Next preview page'});
  await user.click(screen.getByRole('button',{name:'Next runs'}));
  await waitFor(()=>expect(reads).toContain('/api/review/sift/runs?offset=25'));
  expect(reads).toContain('/api/review/sift/runs/run-1?offset=25');
  expect(screen.getByRole('button',{name:'Previous runs'})).toBeEnabled();
});

it('keeps the previous preview readable when a new save is denied',async()=>{
  vi.stubGlobal('fetch',async(input:string,init?:RequestInit)=>{
    const url=new URL(input,'http://localhost');
    if(init?.method==='POST') return Response.json({error:'Open Bookmarkt to make review decisions.'},{status:403});
    if(url.pathname.endsWith('/baselines')) return Response.json({items:[]});
    if(url.pathname.endsWith('/runs')) return Response.json({items:[run],more:false});
    return Response.json(preview());
  });
  const user=userEvent.setup();render(<SiftReview linkId={null}/>,{wrapper:makeWrapper()});
  expect(screen.getByText('Loading saved previews…')).toBeInTheDocument();
  await user.click(await screen.findByRole('button',{name:/427 bookmarks/}));
  await screen.findByRole('link',{name:'MOD Dwarf'});
  await user.click(screen.getByRole('button',{name:'Save local preview'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Open Bookmarkt to make review decisions.');
  expect(screen.getByRole('link',{name:'MOD Dwarf'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Save local preview'})).toBeEnabled();
});

it('shows a suggested bin separately from an existing owner choice',async()=>{
  vi.stubGlobal('fetch',async(input:string)=>{
    const url=new URL(input,'http://localhost');
    if(url.pathname.endsWith('/baselines'))return Response.json({items:[]});
    if(url.pathname.endsWith('/runs'))return Response.json({items:[run],more:false});
    const data=preview();
    data.counts.suggestedBins={'Technical reference':1};
    data.items[0]!.computed.bin={name:'Technical reference',ruleId:'technical-reference',ruleVersion:1,
      reason:'Documentation metadata.',fields:['url','title']};
    return Response.json(data);
  });
  const user=userEvent.setup();render(<SiftReview linkId={null}/>,{wrapper:makeWrapper()});
  await user.click(await screen.findByRole('button',{name:/427 bookmarks/}));
  expect(await screen.findByText('Suggested bin: Technical reference')).toBeInTheDocument();
  expect(screen.getByText('Your bin: Buying research')).toBeInTheDocument();
  expect(screen.getByText('Documentation metadata.')).toBeInTheDocument();
  expect(screen.getByRole('table',{name:'Suggested bins · awaiting review'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/apply|approve|export/i})).not.toBeInTheDocument();
});
