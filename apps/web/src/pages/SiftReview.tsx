import { useState } from 'react';
import type { SiftScope } from '@bukmark/shared/review';
import { useSaveSiftPreview, useSiftBaselines, useSiftPreview, useSiftRuns } from '../api/queries';
import styles from './ReviewPage.module.css';
import { SiftApplyReview } from './SiftApplyReview';

const LABELS:Record<string,string>={reference:'Reference',needs_review:'Needs review',active_work:'Active work',
  shortcut:'Shortcut',archive_candidate:'Archive candidate',archived:'Archived',none:'No handoff',
  builder:'Builder candidate',azuk:'Azuk candidate',recipe:'Recipe candidate',knowledge:'Note candidate'};
const HOLDS:Record<string,string>={'owner-approved-bin':'Your bin choice is preserved.',
  'bin-membership-changed':'The bin membership changed after its recorded approval.',
  'owner-review-decision':'Your existing review decision is preserved.',
  'approved-export':'This source already has an approved export.',
  'existing-delivery':'This source already has a delivery record.',archived:'This bookmark is archived.',
  'source-or-evidence-changed':'Source or review evidence changed since this preview.'};

export function SiftReview({linkId}:{linkId:string|null}) {
  const [scopeChoice,setScopeChoice]=useState('next');
  const [historyOffset,setHistoryOffset]=useState(0);
  const [runId,setRunId]=useState<string|null>(null);
  const [offset,setOffset]=useState(0);
  const [message,setMessage]=useState('');
  const baselines=useSiftBaselines();
  const history=useSiftRuns(historyOffset);
  const preview=useSiftPreview(runId,offset);
  const save=useSaveSiftPreview();
  const error=save.error??preview.error??history.error??baselines.error;
  const data=preview.data;
  function scope():SiftScope {
    if(linkId) return {kind:'links',linkIds:[linkId]};
    if(scopeChoice.startsWith('baseline:')) return {kind:'baseline',id:scopeChoice.slice(9)};
    if(scopeChoice.startsWith('run:')) return {kind:'run',id:scopeChoice.slice(4)};
    return {kind:'next',limit:100};
  }
  return <section aria-labelledby="sift-title">
    <div className={styles.bar}>
      <div><h3 id="sift-title">Sifting previews</h3><p>Preview folders using the bookmarks already on your server.</p></div>
      <div className={styles.actions}>
        {!linkId?<label className={styles.field}>Preview scope
          <select value={scopeChoice} disabled={save.isPending} onChange={e=>setScopeChoice(e.target.value)}>
            <option value="next">Next 100 bookmarks without a recorded bin</option>
            {baselines.data?.items.map(b=><option key={b.id} value={`baseline:${b.id}`}>Reviewed batch · {b.count} bookmarks · {new Date(b.approvedAt).toLocaleDateString()}</option>)}
            {scopeChoice.startsWith('run:')?<option value={scopeChoice}>Same bookmarks as the selected preview</option>:null}
          </select>
        </label>:null}
        <button type="button" disabled={save.isPending || baselines.isPending} onClick={()=>{
          setMessage('');
          save.mutate(scope(),{onSuccess:receipt=>{
            setRunId(receipt.id);setOffset(0);setHistoryOffset(0);
            setMessage(receipt.reusedRun?`Reused the saved preview. ${receipt.reusedResults} results reused.`
              :`Saved preview. ${receipt.createdResults} new results; ${receipt.reusedResults} results reused.`);
          }});
        }}>{save.isPending?'Saving preview…':'Save local preview'}</button>
      </div>
    </div>
    {message?<p role="status" className={styles.message}>{message}</p>:null}
    {error?<p role="alert" className={styles.error}>{error.message}</p>:null}
    {history.isPending||baselines.isPending?<p role="status">Loading saved previews…</p>:null}
    {history.data?.items.length?<nav aria-label="Saved sifting runs" className={styles.siftHistory}>
      {history.data.items.map(run=><button type="button" key={run.id} aria-pressed={run.id===runId}
        onClick={()=>{setRunId(run.id);setOffset(0);setMessage('');save.reset();setScopeChoice(`run:${run.id}`);}}>
        {new Date(run.createdAt).toLocaleString()} · {run.scopeCount} bookmarks
      </button>)}
    </nav>:history.isSuccess?<p>No saved previews yet.</p>:null}
    {historyOffset>0||history.data?.more?<div className={styles.pages}>
      <button type="button" disabled={historyOffset===0} onClick={()=>setHistoryOffset(x=>x-25)}>Previous runs</button>
      <button type="button" disabled={!history.data?.more} onClick={()=>setHistoryOffset(x=>x+25)}>Next runs</button>
    </div>:null}
    {runId&&preview.isPending?<p role="status">Loading preview…</p>:null}
    {data?<>
      <div className={styles.bar}>
        <p>{data.scopeCount} bookmarks · {data.counts.ownerChoices} saved bin choices · {data.counts.held} held unchanged</p>
        <p>$0 new model cost · {data.usage.pageReads} page reads · {data.proposedChanges} bookmark changes</p>
      </div>
      {data.localOnlyCount?<p className={styles.message}>{data.localOnlyCount} protected {data.localOnlyCount===1?'bookmark was':'bookmarks were'} analyzed locally. Their details stay on the server.</p>:null}
      {data.unavailableCount?<p>{data.unavailableCount} saved sources are no longer available.</p>:null}
      <div className={styles.siftTables}>
        {data.counts.suggestedBins&&Object.keys(data.counts.suggestedBins).length?<table><caption>Suggested bins · awaiting review</caption><thead><tr><th>Bin</th><th>Bookmarks</th></tr></thead>
          <tbody>{Object.entries(data.counts.suggestedBins).map(([bin,n])=><tr key={bin}><td>{bin}</td><td>{n}</td></tr>)}</tbody></table>:null}
      </div>
      <details className={styles.siftEvidence}><summary>Recorded choices and potential handoffs</summary>
      <div className={styles.siftTables}>
        <table><caption>Recorded bin choices</caption><thead><tr><th>Bin</th><th>Bookmarks</th></tr></thead>
          <tbody>{Object.entries(data.counts.bins).map(([bin,n])=><tr key={bin}><td>{bin}</td><td>{n}</td></tr>)}</tbody></table>
        <table><caption>Local suggestions</caption><thead><tr><th>Disposition</th><th>Bookmarks</th></tr></thead>
          <tbody>{Object.entries(data.counts.dispositions).map(([name,n])=><tr key={name}><td>{LABELS[name]??name}</td><td>{n}</td></tr>)}</tbody></table>
        <table><caption>Potential handoffs</caption><thead><tr><th>Route</th><th>Bookmarks</th></tr></thead>
          <tbody>{Object.entries(data.counts.handoffs).map(([name,n])=><tr key={name}><td>{LABELS[name]??name}</td><td>{n}</td></tr>)}</tbody></table>
      </div>
      </details>
      {data.comparison?<p>Compared with the previous preview: {data.comparison.changedAnalysis} new analysis results,
        {' '}{data.comparison.unchangedAnalysis} results reused, {data.comparison.changedGuards} changed source or review records.</p>:null}
      <details className={styles.siftEvidence}><summary>Run receipt</summary><p>Preview ID: {data.id}</p><p>Result digest: {data.digest}</p>
        <p>Rules: {data.rulesVersion}</p>
        <p>{data.counts.exportedSources} sources already have approved exports; {data.counts.commitPins} commit pins retained.</p></details>
      <details key={`${data.id}:${data.digest}`} className={styles.siftEvidence}><summary>Review changes to bins</summary>
        <SiftApplyReview run={data}/>
      </details>
      {data.items.map(item=><article key={item.link.id} className={styles.row}>
        <div className={styles.source}>
          <h4>{/^https?:\/\//i.test(item.link.url)?<a href={item.link.url} target="_blank" rel="noreferrer">{item.link.title||item.link.url}</a>:item.link.title||item.link.url}</h4>
          {item.computed.bin?<p>Suggested bin: {item.computed.bin.name}</p>:null}
          <details className={styles.evidence}><summary>Why this suggestion?</summary>
            <p className={styles.url}>{item.link.url}</p><p>{item.computed.reason}</p>
            {item.computed.bin?<p>{item.computed.bin.reason}</p>:null}
          <p className={styles.meta}>Suggestion: {LABELS[item.computed.disposition]} · {LABELS[item.computed.handoff]}</p>
          </details>
        </div>
        <div className={styles.review}>
          {item.decision?<p>{item.holds.includes('bin-membership-changed')?'Recorded bin':'Your bin'}: {item.decision.bin}</p>:null}
          {item.holds.map(hold=><p key={hold} className={styles.meta}>
            {hold==='owner-approved-bin'&&item.holds.includes('bin-membership-changed')?'The earlier approval remains in history.':HOLDS[hold]??hold}
          </p>)}
          {item.decision||item.exports.length?<details className={styles.siftEvidence}><summary>Decision and source evidence</summary>
            {item.decision?<p>Approval: {item.decision.reference} · {new Date(item.decision.approvedAt).toLocaleString()} · revision {item.decision.revision}</p>:null}
            {item.exports.map((receipt,i)=><p key={`${receipt.id}:${i}`}>{receipt.route} export: {receipt.id}
              {receipt.commit?<> · commit <code>{receipt.commit}</code></>:null}</p>)}
          </details>:null}
        </div>
      </article>)}
      {offset>0||data.more?<div className={styles.pages}>
        <button type="button" disabled={offset===0} onClick={()=>setOffset(x=>x-25)}>Previous preview page</button>
        <button type="button" disabled={!data.more} onClick={()=>setOffset(x=>x+25)}>Next preview page</button>
      </div>:null}
    </>:null}
  </section>;
}
