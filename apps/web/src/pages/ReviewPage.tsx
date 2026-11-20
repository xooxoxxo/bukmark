import { useLayoutEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAzukLists, useDecideReview, useHubs, usePrepareReview, useReview } from '../api/queries';
import type { AzukLists, ReviewAction, ReviewDecision, ReviewDraft, ReviewFilter, ReviewProposal } from '../api/types';
import { approvedAzuk, azukForm, AzukActivity, AzukReviewFields, type AzukForm } from './AzukReview';
import { BuilderReview } from './BuilderReview';
import { KnowledgeReview } from './KnowledgeReview';
import { RecipeReview } from './RecipeReview';
import { SiftReview } from './SiftReview';
import styles from './ReviewPage.module.css';

const PAGE_SIZE = 25;
type InboxFilter = ReviewFilter | 'azuk' | 'builder' | 'recipes' | 'notes' | 'sift';
const STATUSES: Array<{ value: ReviewFilter; label: string }> = [
  { value: 'pending', label: 'To review' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'decided', label: 'Decided' },
];
const AREAS: Array<{ value: InboxFilter; label: string }> = [
  { value: 'pending', label: 'Bookmark decisions' },
  { value: 'azuk', label: 'Azuk deliveries' },
  { value: 'builder', label: 'Builder catalog' },
  { value: 'recipes', label: 'Recipes' },
  { value: 'notes', label: 'Knowledge notes' },
  { value: 'sift', label: 'Sifting previews' },
];
const ACTIONS: Record<ReviewAction, string> = {
  reference: 'Keep as reference',
  next_step: 'Record a next step',
  archive: 'Archive link',
  undecided: 'Needs context',
  product: 'Product candidate',
};
const REVIEW_OUTCOMES = {
  changed: 'A link or draft changed. Review the current details.',
  incomplete: 'A selected draft still needs information.',
  inactive: 'A selected link is no longer active.',
  destination: 'The Azuk connection or list changed. Reload the lists and review the selection.',
};

function rowKey(item: ReviewProposal) {
  return `${item.id}:${item.revision}:${item.sourceVersion}`;
}

function sameDraft(a: ReviewDraft, b: ReviewDraft) {
  return a.action === b.action && (a.hub ?? '') === (b.hub ?? '') && (a.nextStep ?? '') === (b.nextStep ?? '');
}

function ready(draft: ReviewDraft) {
  return draft.action === 'reference' || draft.action === 'archive'
    || (draft.action === 'next_step' && Boolean(draft.hub?.trim() && draft.nextStep?.trim()));
}

function ReviewRow({ item, draft, selected, busy, onDraft, onSelect, onDecision, azuk }: {
  item: ReviewProposal;
  draft: ReviewDraft;
  selected: boolean;
  busy: boolean;
  onDraft: (draft: ReviewDraft) => void;
  onSelect: (checked: boolean) => void;
  onDecision: (decision: ReviewDecision['decision']) => void;
  azuk: { options: AzukLists | undefined; loading: boolean; form: AzukForm; onChange: (form: AzukForm) => void; reload: () => void };
}) {
  const title = item.link.title || item.link.url;
  const pending = item.status === 'pending';
  const dirty = !sameDraft(item.draft, draft);
  const canApprove = ready(draft) || (draft.action === 'product' && !!approvedAzuk(item, azuk.options, azuk.form));
  const actionIds = Object.keys(ACTIONS) as ReviewAction[];
  return (
    <article className={styles.row} aria-labelledby={`title-${item.id}`}>
      <div className={styles.source}>
        <h3 id={`title-${item.id}`}>
          {/^https?:\/\//i.test(item.link.url)
            ? <a href={item.link.url} target="_blank" rel="noreferrer">{title}</a>
            : title}
        </h3>
        <p className={styles.reason}>{item.reason}</p>
        <details className={styles.evidence}><summary>Source details</summary>
          {item.link.title ? <p className={styles.url}>{item.link.url}</p> : null}
          <p className={styles.meta}>
            {item.origin === 'assistant' ? 'Suggested by assistant' : item.origin === 'owner' ? 'Edited by you' : 'Suggested from URL'}
            {item.oneTab ? ` · ${item.dupeCount} OneTab ${item.dupeCount === 1 ? 'appearance' : 'appearances'}` : ''}
            {item.folder ? ` · Imported from ${item.folder}` : ''}
          </p>
        </details>
        {item.link.note ? (
          <details open={draft.action === 'next_step' ? true : undefined}>
            <summary>Current link note</summary>
            <p className={styles.note}>{item.link.note}</p>
          </details>
        ) : null}
        {item.listingUrl && draft.action === 'product' ? (
          <p className={styles.url}><a href={item.listingUrl} target="_blank" rel="noreferrer">Exact listing</a> · {item.listingUrl}</p>
        ) : null}
        {item.sourceChanged && pending ? <p className={styles.meta}>The link changed after this suggestion. Check the current details.</p> : null}
      </div>
      <div className={styles.review}>
        {pending ? (
          <>
            <label className={styles.field}>
              <span>Action</span>
              <select value={draft.action} onChange={(event) => onDraft({ action: event.target.value as ReviewAction })} disabled={busy}>
                {actionIds.filter((action) => action !== 'product' || item.listingUrl).map((action) =>
                  <option key={action} value={action}>{ACTIONS[action]}</option>)}
              </select>
            </label>
            {draft.action === 'reference' || draft.action === 'next_step' ? (
              <label className={styles.field}>
                <span>{draft.action === 'next_step' ? 'Project hub' : 'Add to hub (optional)'}</span>
                <input value={draft.hub ?? ''} list="review-hubs" maxLength={120} disabled={busy}
                  onChange={(event) => onDraft({ ...draft, hub: event.target.value })} />
              </label>
            ) : null}
            {draft.action === 'next_step' ? (
              <label className={styles.field}>
                <span>Next step to append to the link note</span>
                <textarea value={draft.nextStep ?? ''} maxLength={1000} rows={2} disabled={busy}
                  onChange={(event) => onDraft({ ...draft, nextStep: event.target.value })} />
              </label>
            ) : null}
            {draft.action === 'next_step' && !ready(draft) ? <p className={styles.meta}>Add a project hub and a next step to approve.</p> : null}
            {draft.action === 'archive' ? (
              <p className={styles.meta}>You can restore this link from the archive. If browser sync is on, the bookmark leaves the managed folder.</p>
            ) : null}
            {draft.action === 'product' ? <AzukReviewFields {...azuk} busy={busy} /> : null}
            <div className={styles.actions}>
              <label className={styles.selection}>
                <input type="checkbox" checked={selected} disabled={busy || !canApprove} aria-label={`Select ${title} for approval`}
                  onChange={(event) => onSelect(event.target.checked)} /> Select
              </label>
              <button type="button" disabled={busy || !canApprove} onClick={() => onDecision('approve')}>
                {draft.action === 'product' ? 'Send to Azuk' : 'Approve'}
              </button>
              {dirty ? <button type="button" disabled={busy} onClick={() => onDecision('edit')}>Save edits</button> : null}
              <button type="button" disabled={busy} onClick={() => onDecision('defer')}>Defer</button>
              <button type="button" disabled={busy} onClick={() => onDecision('dismiss')}>Dismiss</button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.decision}>{ACTIONS[draft.action]} · {item.status}</p>
            {draft.hub ? <p className={styles.meta}>Hub · {draft.hub}</p> : null}
            {draft.nextStep ? <p className={styles.note}>{draft.nextStep}</p> : null}
            {item.status === 'deferred' ? (
              <button type="button" disabled={busy} onClick={() => onDecision('resume')}>Resume review</button>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}

export function ReviewPage() {
  const [params] = useSearchParams();
  const linkId = params.get('linkId');
  return <ReviewInbox key={linkId ?? 'all'} linkId={linkId} />;
}

function ReviewInbox({ linkId }: { linkId: string | null }) {
  const [params, setParams] = useSearchParams();
  const view = params.get('view');
  const filter = [...AREAS, ...STATUSES].find(option => option.value === view)?.value ?? 'pending';
  const [offset, setOffset] = useState(0);
  const [edits, setEdits] = useState<Record<string, ReviewDraft>>({});
  const [selected, setSelected] = useState(() => new Set<string>());
  const [azukForms, setAzukForms] = useState<Record<string, AzukForm>>({});
  const [message, setMessage] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const localFilter = filter === 'pending' || filter === 'deferred' || filter === 'decided' ? filter : null;
  const queue = useReview(localFilter ?? 'pending', linkId, offset, localFilter !== null);
  const { data: hubs } = useHubs();
  const prepare = usePrepareReview();
  const decide = useDecideReview();
  const busy = prepare.isPending || decide.isPending;
  const rows = localFilter ? queue.data?.items ?? [] : [];
  const lists = useAzukLists(filter === 'pending' && rows.some((item) => item.listingUrl));
  const formFor = (item: ReviewProposal) => azukForms[rowKey(item)] ?? azukForm(item);
  const approvalFor = (item: ReviewProposal) => approvedAzuk(item, lists.data, formFor(item));
  function selectionKey(item: ReviewProposal) {
    const approval = approvalFor(item);
    return approval ? `${rowKey(item)}:${approval.connection}:${approval.listName}` : rowKey(item);
  }
  const selectedRows = rows.filter((item) => {
    const draft = edits[rowKey(item)] ?? item.draft;
    return selected.has(selectionKey(item)) && (ready(draft) || (draft.action === 'product' && approvalFor(item)));
  });
  const error = localFilter ? queue.error ?? prepare.error ?? decide.error : null;

  useLayoutEffect(() => {
    setOffset(0);
    setSelected(new Set());
  }, [filter]);

  function selectFilter(value: InboxFilter) {
    if (value === filter) return;
    const next = new URLSearchParams(params);
    if (value === 'pending') next.delete('view');
    else next.set('view', value);
    setParams(next);
  }

  function changeSelection(key: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function submit(items: ReviewProposal[], decision: ReviewDecision['decision']) {
    setMessage('');
    setProblems([]);
    prepare.reset();
    decide.mutate(items.map((item) => {
      const edit = edits[rowKey(item)];
      const draft = edit && !sameDraft(edit, item.draft) && (decision === 'approve' || decision === 'edit' || decision === 'defer')
        ? edit : undefined;
      const azuk = decision === 'approve' && (draft ?? item.draft).action === 'product' ? approvalFor(item) : undefined;
      return { id: item.id, revision: item.revision, sourceVersion: item.sourceVersion, decision, draft, azuk };
    }), {
      onSuccess: (result) => {
        const count = result.items.filter((item) => item.outcome === 'saved').length;
        const sent = result.items.some(({ id, outcome }) => (outcome === 'saved' || outcome === 'existing')
          && decision === 'approve' && items.some((item) => item.id === id && (edits[rowKey(item)] ?? item.draft).action === 'product'));
        const reused = result.items.some(({ outcome }) => outcome === 'existing');
        setMessage(sent ? reused ? 'This listing already has an Azuk delivery for the selected list.' : 'Azuk delivery queued.'
          : count ? `Saved ${count} ${count === 1 ? 'decision' : 'decisions'}.` : '');
        setProblems(result.items.flatMap(({ id, outcome }) => {
          if (outcome === 'saved' || outcome === 'existing') return [];
          const link = items.find((item) => item.id === id)?.link;
          return [`${link?.title || link?.url || 'Selected link'}. ${REVIEW_OUTCOMES[outcome]}`];
        }));
        const handled = new Set(items.map(rowKey));
        const handledSelection = new Set(items.map(selectionKey));
        setSelected((previous) => new Set([...previous].filter((key) => !handledSelection.has(key))));
        setEdits((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !handled.has(key))));
        setAzukForms((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !handled.has(key))));
        if (sent) selectFilter('azuk');
      },
    });
  }

  return (
    <section className={styles.page} aria-labelledby="review-title">
      <header className={styles.header}>
        <div>
          <h1 id="review-title">{linkId ? 'Review this link' : 'Review bookmarks'}</h1>
          {linkId ? <Link to="/review">View all reviews</Link> : null}
        </div>
        <label className={styles.areaPicker}>Review area
          <select value={localFilter ? 'pending' : filter} disabled={busy} onChange={event => selectFilter(event.target.value as InboxFilter)}>
            {AREAS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </header>
      {localFilter && <div className={styles.bar}>
        <nav aria-label="Review status" className={styles.filters}>
          {STATUSES.map(({ value, label }) => (
            <button type="button" key={value} aria-pressed={filter === value} disabled={busy} onClick={() => selectFilter(value)}>{label}</button>
          ))}
        </nav>
        <button type="button" className={styles.primary} disabled={busy}
          onClick={() => {
            setMessage('');
            setProblems([]);
            decide.reset();
            prepare.mutate(linkId, { onSuccess: ({ items }) => {
              const count = items.filter((item) => item.outcome === 'prepared').length;
              if (count) selectFilter('pending');
              setMessage(count ? `Prepared ${count} ${count === 1 ? 'draft' : 'drafts'}.`
                : items.some((item) => item.outcome === 'inactive') ? 'This link is no longer active.'
                  : linkId ? 'This link already has a review. Check the review statuses.' : 'There are no more unreviewed links.');
            } });
          }}>
          {prepare.isPending ? 'Preparing…' : linkId ? 'Prepare this link' : 'Prepare next batch'}
        </button>
      </div>}
      {filter === 'pending' && selectedRows.length > 0 ? (
        <button type="button" className={styles.bulkAction} disabled={busy}
          onClick={() => submit(selectedRows, 'approve')}>
          Approve selected{selectedRows.length ? ` (${selectedRows.length})` : ''}
        </button>
      ) : null}
      {(localFilter || filter === 'azuk') && message ? <p role="status" className={styles.message}>{message}</p> : null}
      {(localFilter || filter === 'azuk') && (error || problems.length) ? <p role="alert" className={styles.error}>{error?.message ?? problems.join(' ')}</p> : null}
      {filter === 'azuk' ? <AzukActivity linkId={linkId} /> : null}
      {filter === 'builder' ? <BuilderReview linkId={linkId} /> : null}
      {filter === 'recipes' ? <RecipeReview linkId={linkId} /> : null}
      {filter === 'notes' ? <KnowledgeReview linkId={linkId} /> : null}
      {filter === 'sift' ? <SiftReview linkId={linkId} /> : null}
      {localFilter && queue.isPending ? <p role="status" className={styles.message}>Loading reviews…</p> : null}
      {localFilter && queue.isSuccess && !rows.length ? <p className={styles.message}>No {filter === 'pending' ? 'pending' : filter} reviews here.</p> : null}
      <datalist id="review-hubs">
        {hubs?.items.filter((hub) => hub.status !== 'archived').map((hub) => <option key={hub.id} value={hub.name} />)}
      </datalist>
      {rows.map((item) => {
        const key = rowKey(item);
        const selection = selectionKey(item);
        return <ReviewRow key={key} item={item} draft={edits[key] ?? item.draft} selected={selected.has(selection)} busy={busy}
          azuk={{ options: lists.data, loading: lists.isLoading, form: formFor(item), reload: () => { void lists.refetch(); },
            onChange: (form) => {
              changeSelection(selection, false);
              setAzukForms((previous) => ({ ...previous, [key]: form }));
            },
          }}
          onDraft={(draft) => {
            changeSelection(selection, false);
            setEdits((previous) => ({ ...previous, [key]: draft }));
          }}
          onSelect={(checked) => changeSelection(selection, checked)} onDecision={(decision) => submit([item], decision)} />;
      })}
      {localFilter && (offset > 0 || queue.data?.more) ? (
        <div className={styles.pages}>
          <button type="button" disabled={busy || offset === 0} onClick={() => setOffset(offset - PAGE_SIZE)}>Previous page</button>
          <button type="button" disabled={busy || !queue.data?.more} onClick={() => setOffset(offset + PAGE_SIZE)}>Next page</button>
        </div>
      ) : null}
    </section>
  );
}
