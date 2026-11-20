import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { BOOKMARK_REVIEW_LIMIT, canDownloadReviewedBookmark, type SiftBin, type SiftPreview } from '@bukmark/shared/review';
import { errorMessage, saveSiftPreview } from '../api/client';
import { useSiftPreview } from '../api/queries';
import { ImportBookmarks } from '../components/ImportBookmarks';
import styles from './FirstRunPage.module.css';

const folders: Record<SiftBin, string> = {
  'Technical reference': 'Guides and references',
  'Repo code and examples': 'Code examples',
  'Discussions and answers': 'Questions and answers',
  'Buying research': 'Buying research',
  'Price-watch review': 'Shopping list',
  'Needs review': 'Reading list',
  'Check source': 'Check source',
};

const explanations: Record<SiftBin, string> = {
  'Technical reference': 'This looks like documentation or a guide you might want to consult again.',
  'Repo code and examples': 'The address points to a file or folder inside a code project.',
  'Discussions and answers': 'The address leads to a question, reply, or discussion you can return to.',
  'Buying research': 'This looks like product information you might use to compare options.',
  'Price-watch review': 'This looks like a listing for a specific item. You can keep it here while deciding whether to buy.',
  'Needs review': 'The saved details give few clues. Choose a folder if you want to keep this one in your file.',
  'Check source': 'Check the saved title and address before exporting.',
};

function explainFolder(bin: SiftBin, address: string): string {
  const url = URL.parse(address);
  if (url && bin === 'Technical reference' && /^(docs?|developer)\./.test(url.hostname)) {
    return `The address is on ${url.hostname}, a documentation site.`;
  }
  if (url?.hostname === 'github.com' && bin === 'Discussions and answers') {
    const issue = url.pathname.match(/\/issues\/(\d+)\/?$/);
    if (issue) return `This link opens issue #${issue[1]} on GitHub. Keep it if you want to return to that conversation.`;
  }
  return explanations[bin];
}

const detailReviews = {
  builder: ['builder', 'Review as a development tool'],
  recipe: ['recipes', 'Review as a recipe'],
  knowledge: ['notes', 'Create a knowledge note'],
} as const;

type FolderChoice = { linkId: string; folder: string };

async function downloadBookmarks(runId: string, choices: FolderChoice[]) {
  const res = await fetch(`/api/review/sift/runs/${encodeURIComponent(runId)}/bookmark-file`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ choices }),
  });
  if (!res.ok) {
    const info = await res.json().catch(() => ({}));
    throw new Error(info.error ?? 'Could not download these bookmarks. Try again.');
  }
  const url = URL.createObjectURL(await res.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'bukmark-reading-list.html';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function FolderReview({ preview }: { preview: SiftPreview }) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const download = useMutation({ mutationFn: (items: FolderChoice[]) => downloadBookmarks(preview.id, items) });
  const items = preview.items.slice(0, BOOKMARK_REVIEW_LIMIT);
  const eligible = items.filter(canDownloadReviewedBookmark);
  const selected = eligible.filter(item => choices[item.link.id] !== undefined)
    .map(item => ({ linkId: item.link.id, folder: choices[item.link.id]!.trim() }));
  const hidden = preview.localOnlyCount + preview.unavailableCount;

  function change(id: string, value?: string) {
    download.reset();
    setChoices(current => {
      const next = { ...current };
      if (value === undefined) delete next[id];
      else next[id] = value;
      return next;
    });
  }

  return <>
    <p className={styles.intro}>Select bookmarks for your HTML file. You can rename their folders before downloading.</p>
    {hidden > 0 && <p>{hidden} private or unavailable {hidden === 1 ? 'link was' : 'links were'} left out.</p>}
    <fieldset className={styles.items} disabled={download.isPending}>
      <legend className={styles.srOnly}>Choose bookmarks for your file</legend>
      {items.length > 0 && <div aria-hidden="true" className={styles.columnLabels}><span>Bookmark</span><span>Folder in file</span></div>}
      {items.map(item => {
        const { id, title, url } = item.link;
        const bin = item.computed.bin;
        const name = title || url;
        const included = choices[id] !== undefined;
        const available = eligible.includes(item);
        const missingFolder = included && !choices[id]?.trim();
        const route = item.computed.handoff;
        const noteSource = url.startsWith('https://') && (item.computed.disposition === 'reference' || bin?.name === 'Technical reference');
        const detail = route === 'builder' || route === 'recipe' || route === 'knowledge' ? detailReviews[route]
          : noteSource && route === 'none' ? detailReviews.knowledge : null;
        const host = URL.parse(url)?.hostname;
        return <div className={styles.item} key={id}>
          <div className={styles.itemLine}>
            <label className={styles.pick}>
              <input type="checkbox" aria-label={name} aria-describedby={available && !included ? `folder-${id}` : undefined} disabled={!available} checked={available && included}
                onChange={e => change(id, e.target.checked && bin ? folders[bin.name] : undefined)} />
              <span>{name}{host && title && <small>{host}</small>}</span>
            </label>
            {available && bin && (included
              ? <label className={styles.folder}><span className={styles.srOnly}>Folder for {name}</span>
                  <input maxLength={120} required placeholder="Folder name" value={choices[id]} aria-invalid={missingFolder}
                    aria-describedby={missingFolder ? `folder-error-${id}` : undefined} onChange={e => change(id, e.target.value)} />
                  {missingFolder && <small id={`folder-error-${id}`}>Enter a folder name to download.</small>}
                </label>
              : <span id={`folder-${id}`} className={styles.destination}>{bin.name === 'Needs review' ? 'Choose a folder' : folders[bin.name]}</span>)}
          </div>
          {!available && <p className={styles.hold}>{item.decision ? `Your saved choice is ${item.decision.bin}.` :
            bin?.name === 'Check source' ? 'Check the saved title and address.' : 'This bookmark has a decision or has changed.'}
            {' '}<Link to={`/review?linkId=${id}`}>Review bookmark</Link></p>}
          <details className={styles.details}>
            <summary>{available ? 'Why this suggestion?' : 'Source details'}</summary>
            {available && bin && <p>{explainFolder(bin.name, url)}</p>}
            <p className={styles.address}>{url}</p>
            {available && detail && <Link to={`/review?linkId=${id}&view=${detail[0]}`} target="_blank" rel="noreferrer">
              {detail[1]} <span aria-hidden="true">↗</span><span className={styles.srOnly}> (opens in a new tab)</span>
            </Link>}
          </details>
        </div>;
      })}
    </fieldset>
    <div className={styles.actions}>
      <button className={styles.primary} disabled={download.isPending || !selected.length || selected.some(row => !row.folder)}
        onClick={() => download.mutate(selected)}>Download {selected.length ? `${selected.length} ` : ''}{selected.length === 1 ? 'bookmark' : 'bookmarks'}</button>
    </div>
    {download.isError && <p role="alert">{errorMessage(download.error)}</p>}
    {download.isSuccess && <p role="status">Downloaded. Import the HTML file in your browser to keep these folders.</p>}
  </>;
}

export function FirstRunPage() {
  const [params, setParams] = useSearchParams();
  const runId = params.get('review');
  const [ids, setIds] = useState<string[] | null>(null);
  const start = useMutation({
    mutationFn: (linkIds: string[]) => saveSiftPreview({ kind: 'links', linkIds }),
    onSuccess: ({ id }) => setParams({ review: id }),
  });
  const preview = useSiftPreview(runId, 0);
  return <div className={styles.page}>
    <h1>{runId ? 'Review your bookmarks' : 'Import bookmarks'}</h1>
    {runId ? <>
      {preview.isPending && <p role="status">Loading suggestions…</p>}
      {preview.isError && <p role="alert">{errorMessage(preview.error)} <button onClick={() => void preview.refetch()}>Try again</button></p>}
      {preview.data && <FolderReview key={runId} preview={preview.data} />}
      <nav className={styles.footer} aria-label="After review"><Link to="/">Open library</Link><Link to="/start" onClick={() => { setIds(null); start.reset(); }}>Import another file</Link></nav>
    </> : <>
      <p className={styles.intro}>Import your browser bookmarks, then try folder suggestions on up to {BOOKMARK_REVIEW_LIMIT} links. No AI account needed.</p>
      <section aria-label="Choose a file">
        <ImportBookmarks disabled={start.isPending} onFileStarted={() => { setIds(null); start.reset(); }}
          buttonLabel={ids === null ? 'Choose bookmarks file…' : 'Choose another file…'}
          buttonClass={ids === null ? styles.primary : styles.secondary} reviewLimit={BOOKMARK_REVIEW_LIMIT}
          onImported={items => { setIds(items); start.reset(); }} />
        <details className={styles.fileHelp}><summary>Where do I get a bookmarks file?</summary>
          <p>Open your browser’s bookmark manager, choose Export Bookmarks, and save the HTML file.</p>
        </details>
      </section>
      {ids !== null && <section>
        {ids.length ? <>
          <h2>Review {ids.length} {ids.length === 1 ? 'bookmark' : 'bookmarks'}</h2>
          <button className={styles.primary} disabled={start.isPending} onClick={() => start.mutate(ids)}>
            {start.isPending ? 'Preparing suggestions…' : 'Show suggestions'}
          </button>
        </> : <p>This file has no active bookmarks available for review. Choose another file or open your library.</p>}
        {start.isError && <p role="alert">{errorMessage(start.error)}</p>}
      </section>}
      <nav className={styles.footer} aria-label="Return to library"><Link to="/">Open library</Link></nav>
    </>}
  </div>;
}
