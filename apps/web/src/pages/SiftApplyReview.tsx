import { useState } from 'react';
import type { SiftPreview } from '@bukmark/shared';
import { useApproveSiftApplication, useHubs, usePrepareSiftApplication, useSiftApplication, useSiftApplicationPreview } from '../api/queries';
import styles from './ReviewPage.module.css';

const REASONS:Record<string,string>={
  'owner-approved-bin':'Your approved bin is preserved.', 'owner-review-decision':'Your review decision is preserved.',
  'approved-export':'An approved export is preserved.', 'existing-delivery':'A delivery is already recorded.',
  'source-or-evidence-changed':'Source, membership or decision evidence changed. Save a new run before reviewing again.',
  'target-changed':'The target bin changed. Create a new preview.', 'choose-bin':'Choose a target bin and create a new preview.',
  'already-in-bin':'Already in this bin.', 'bin-membership-changed':'The approved membership changed.', archived:'Archived bookmark.',
};

export function SiftApplyReview({run}:{run:SiftPreview}) {
  const [selection,setSelection]=useState<'run'|'links'>('run');
  const [checked,setChecked]=useState<string[]>([]);
  const [hubId,setHubId]=useState('');
  const [planId,setPlanId]=useState<string|null>(null);
  const [receiptId,setReceiptId]=useState<string|null>(null);
  const [offset,setOffset]=useState(0);
  const [viewingSaved,setViewingSaved]=useState(false);
  const hubs=useHubs();
  const prepare=usePrepareSiftApplication();
  const approve=useApproveSiftApplication();
  const plan=useSiftApplicationPreview(planId,receiptId?0:offset);
  const receipt=useSiftApplication(receiptId,offset);
  const displayed=receipt.data??(receiptId?approve.data:plan.data??prepare.data);
  const approvalPlan=plan.data??prepare.data;
  const busy=prepare.isPending||approve.isPending;
  const error=prepare.error??approve.error??plan.error??receipt.error??hubs.error;
  function clearPlan() {
    setPlanId(null);setReceiptId(null);setOffset(0);setViewingSaved(false);prepare.reset();approve.reset();
  }
  return <section aria-labelledby="sift-apply-title" className={styles.siftApply}>
    <h4 id="sift-apply-title">Guarded bin changes</h4>
    <p>Review the exact selection before approving. Existing owner choices stay intact. Routes keep their own review.</p>
    {run.applicationPreviews?.length?<details className={styles.siftEvidence}><summary>Saved guarded previews and receipts</summary>
      <nav aria-label="Saved guarded previews" className={styles.siftHistory}>
        {run.applicationPreviews.map(saved=><button type="button" key={saved.id} disabled={busy} aria-pressed={planId===saved.id}
          onClick={()=>{prepare.reset();approve.reset();setViewingSaved(true);setPlanId(saved.id);setReceiptId(saved.applicationId);setOffset(0);}}>
          {new Date(saved.createdAt).toLocaleString()} · {saved.selectedCount} selected · {saved.applicationId?'Receipt':'Preview'}
        </button>)}
      </nav>
    </details>:null}
    {viewingSaved?<div><p>Reviewing a saved selection.</p><button type="button" disabled={busy} onClick={clearPlan}>Start a new guarded preview</button></div>:<div className={styles.actions}>
      <label className={styles.field}>Change selection
        <select value={selection} disabled={busy} onChange={e=>{clearPlan();setSelection(e.target.value as 'run'|'links');}}>
          <option value="run">All {run.scopeCount} bookmarks in this saved run</option>
          <option value="links">Checked bookmarks ({checked.length})</option>
        </select>
      </label>
      <label className={styles.field}>Target bin
        <select value={hubId} disabled={busy} onChange={e=>{clearPlan();setHubId(e.target.value);}}>
          <option value="">Choose an existing bin</option>
          {hubs.data?.items.filter(h=>h.status==='active').map(h=><option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </label>
      <button type="button" disabled={busy||(selection==='links'&&!checked.length)} onClick={()=>{
        setReceiptId(null);setOffset(0);approve.reset();
        prepare.mutate({id:run.id,input:{digest:run.digest,hubId:hubId||null,
          selection:selection==='run'?{kind:'run'}:{kind:'links',linkIds:checked}}},
          {onSuccess:view=>setPlanId(view.id)});
      }}>{prepare.isPending?'Preparing guarded preview…':'Preview guarded changes'}</button>
    </div>}
    {!viewingSaved&&selection==='links'?<fieldset className={styles.context}><legend>Bookmarks on this preview page</legend>
      {run.items.map(item=><label key={item.link.id} className={styles.builderCandidate}>
        <input type="checkbox" disabled={busy||Boolean(item.holds.length)||item.sourceChanged} checked={checked.includes(item.link.id)}
          onChange={e=>{clearPlan();setChecked(ids=>e.target.checked?[...ids,item.link.id]:ids.filter(id=>id!==item.link.id));}}/>
        <span>{item.link.title||item.link.url}{item.holds.length?<small>Held: existing choice or source evidence.</small>:null}</span>
      </label>)}
    </fieldset>:null}
    {error?<p role="alert" className={styles.error}>{error.message}</p>:null}
    {displayed?<>
      <p role="status">{displayed.selectedCount} selected · {displayed.counts.ready} ready · {displayed.counts.applied} applied · {displayed.counts.unchanged} unchanged · {displayed.counts.held} held</p>
      {displayed.target?<p>Selected bin: <strong>{displayed.target.name}</strong>. Other memberships are preserved.</p>:null}
      {displayed.localOnlyCount?<p>{displayed.localOnlyCount} protected bookmarks held locally. Their details stay on the server.</p>:null}
      {displayed.unavailableCount?<p>{displayed.unavailableCount} selected sources are no longer available.</p>:null}
      {!displayed.applyEnabled?<p>Applying bin changes is disabled on this instance.</p>:null}
      {displayed.kind==='receipt'?<p>Application receipt: <code>{displayed.id}</code></p>:null}
      <button type="button" disabled={busy||!approvalPlan?.applyEnabled||(!receiptId&&!approvalPlan.counts.ready)} onClick={()=>{
        if(!approvalPlan) return;
        approve.mutate({id:approvalPlan.previewId,digest:approvalPlan.digest},{onSuccess:view=>{setReceiptId(view.id);setOffset(0);}});
      }}>{approve.isPending?'Checking and applying…':receiptId?'Retry same approval':`Approve ${approvalPlan?.counts.ready??0} bin changes`}</button>
      <details className={styles.siftEvidence}><summary>Guarded change evidence</summary>
        <p>Preview ID: {displayed.previewId}</p><p>Approval digest: <code>{displayed.digest}</code></p>
        {displayed.items.map(item=><div key={item.link.id}><p><strong>{item.link.title||item.link.url}</strong> · {item.state}</p>
          {item.reasons.map(reason=><p key={reason}>{REASONS[reason]??reason}</p>)}
          <p>Expected decision revision: {item.expectedDecisionRevision??'No prior bin decision'}</p>
        </div>)}
        {offset>0||displayed.more?<div className={styles.pages}>
          <button type="button" disabled={busy||offset===0} onClick={()=>setOffset(x=>x-25)}>Previous guarded page</button>
          <button type="button" disabled={busy||!displayed.more} onClick={()=>setOffset(x=>x+25)}>Next guarded page</button>
        </div>:null}
      </details>
    </>:<p>Saving this preview does not file bookmarks or approve a handoff.</p>}
  </section>;
}
