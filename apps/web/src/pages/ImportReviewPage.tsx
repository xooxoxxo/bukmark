import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportChoice, ImportDecision, ImportReviewItem, ImportView } from '@bukmark/shared/review';
import { errorMessage, fetchImportReview, fetchImports, saveImportDecisions } from '../api/client';
import common from './FirstRunPage.module.css';
import styles from './ImportReviewPage.module.css';

function ImportList() {
  const imports = useQuery({ queryKey: ['imports'], queryFn: fetchImports });
  return <div className={common.page}><h1>Imported bookmarks</h1>
    {imports.isPending && <p role="status">Loading imports…</p>}
    {imports.isError && <p role="alert">{errorMessage(imports.error)} <button onClick={() => void imports.refetch()}>Try again</button></p>}
    {imports.data?.length === 0 && <p>Your next import will appear here. <Link to="/start">Import bookmarks</Link></p>}
    <ul className={styles.list}>{imports.data?.map(group => <li key={group.id}>
      <Link to={'/imports/' + group.id}>{group.name}</Link>
      <small>{group.reviewed} of {group.count} reviewed{group.skipped > 0 && ' · ' + group.skipped + ' skipped'} · {new Date(group.lastImported).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</small>
    </li>)}</ul>
  </div>;
}

function Details({ item }: { item: ImportReviewItem }) {
  return <details className={styles.details}><summary>Why this suggestion?</summary>
    <p>{item.suggestion.reason}</p><p className={styles.address}>{item.address}</p></details>;
}

function decision(item: ImportReviewItem, choice: ImportChoice, answer?: string): ImportDecision {
  return { id: item.id, revision: item.revision, version: item.version, choice, answer };
}

function Question({ item, busy, save }: { item: ImportReviewItem; busy: boolean; save: (d: ImportDecision[]) => void }) {
  const [answer, setAnswer] = useState('');
  return <fieldset className={styles.question} disabled={busy}>
    <legend>{item.title}</legend><small>{item.host}{item.protected ? ' · Protected' : ''}</small>
    <Details item={item} />
    <form onSubmit={e => { e.preventDefault(); if (answer.trim()) save([decision(item, 'answer', answer.trim())]); }}>
      <label>{item.suggestion.question ?? 'What would you like to do with this bookmark?'}
        <textarea value={answer} maxLength={1000} onChange={e => setAnswer(e.target.value)} placeholder="Your answer goes in Follow up…" />
      </label>
      <div className={styles.controls}>
        <button className={common.primary} disabled={!answer.trim()}>Save answer</button>
        <button type="button" onClick={() => save([decision(item, 'keep')])}>Keep bookmark</button>
        <button type="button" onClick={() => save([decision(item, 'archive')])}>Archive</button>
        {item.state !== 'skipped' && <button type="button" onClick={() => save([decision(item, 'skip')])}>Skip for now</button>}
      </div>
    </form>
  </fieldset>;
}

function Review({ id, view }: { id: string; view: ImportView }) {
  const cache = useQueryClient();
  const [excluded, setExcluded] = useState(new Set<string>());
  const [revisit, setRevisit] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const clear = view.items.filter(i => i.state === 'clear');
  const questions = view.items.filter(i => i.state === 'question');
  const skipped = view.items.filter(i => i.state === 'skipped');
  const saved = view.items.filter(i => i.state === 'saved');
  const selected = clear.filter(i => !excluded.has(i.id));
  const current = skipped.find(i => i.id === revisit) ?? questions[0];
  const update = useMutation({
    mutationFn: (items: ImportDecision[]) => saveImportDecisions(id, items),
    onMutate: () => setMessage(''),
    onSuccess: async (_, items) => {
      await cache.invalidateQueries({ queryKey: ['import-review'] });
      for (const key of ['links', 'hubs', 'stats', 'review', 'imports']) void cache.invalidateQueries({ queryKey: [key] });
      setRevisit(null);
      setMessage(items[0]?.choice === 'skip' ? 'Skipped. You can come back to it below.'
        : items.length === 1 ? 'Decision saved.' : items.length + ' decisions saved.');
    },
    onError: () => { void cache.invalidateQueries({ queryKey: ['import-review', id] }); },
  });
  return <div className={common.page}>
    <Link to="/imports">All imports</Link><h1 className={styles.title}>{view.name}</h1>
    <p className={common.intro}>{saved.length} of {view.items.length} reviewed · {skipped.length} skipped.
      {view.items.some(i => i.protected) && ' Protected bookmarks stay local.'}</p>
    {clear.length > 0 && <section className={styles.section} aria-label="Clear suggestions">
      <h2>Clear suggestions</h2>
      <details><summary>Choose bookmarks ({selected.length} of {clear.length})</summary>
        <ul className={styles.list}>{clear.map(item => <li key={item.id}>
          <label><input type="checkbox" checked={!excluded.has(item.id)} disabled={update.isPending} onChange={e => {
            const next = new Set(excluded);
            if (e.target.checked) next.delete(item.id); else next.add(item.id);
            setExcluded(next);
          }} /> {item.title}</label><small>{item.suggestion.folder} · {item.host}</small><Details item={item}/></li>)}</ul>
      </details>
      <button className={common.primary} disabled={!selected.length || update.isPending} onClick={() => update.mutate(selected.map(i => decision(i, 'accept')))}>
        Accept {selected.length} {selected.length === 1 ? 'suggestion' : 'suggestions'}</button>
    </section>}
    {current && <section className={styles.section}><h2>{current.state === 'skipped' ? 'Revisit a skipped bookmark' : 'Your call (' + questions.length + ')'}</h2>
      <Question key={current.id} item={current} busy={update.isPending} save={update.mutate} />
    </section>}
    <p role="status" className={styles.feedback}>{update.isPending ? 'Saving…' : message}</p>
    {update.isError && <p role="alert">{errorMessage(update.error)}</p>}
    {skipped.length > 0 && <section className={styles.section}><h2>Skipped for later</h2>
      <ul className={styles.list}>{skipped.map(i => <li key={i.id}><button disabled={update.isPending} onClick={() => setRevisit(i.id)}>{i.title}</button></li>)}</ul>
    </section>}
    {saved.length > 0 && <details className={styles.section}><summary>Saved decisions ({saved.length})</summary>
      <ul className={styles.list}>{saved.map(i => <li key={i.id}>{i.title}<small>{i.outcome}</small></li>)}</ul></details>}
    <Link className={styles.leave} to="/imports">Back to imports</Link>
  </div>;
}

function Batch({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['import-review', id], queryFn: () => fetchImportReview(id) });
  if (query.isPending) return <p role="status">Loading import…</p>;
  if (query.isError) return <p role="alert">{errorMessage(query.error)} <button onClick={() => void query.refetch()}>Try again</button> <Link to="/imports">All imports</Link></p>;
  return <Review id={id} view={query.data} />;
}
export function ImportReviewPage() {
  const { id } = useParams();
  return id ? <Batch key={id} id={id} /> : <ImportList />;
}
