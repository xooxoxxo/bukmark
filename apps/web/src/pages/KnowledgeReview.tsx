import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KnowledgeDraft, KnowledgeEvidenceAction, KnowledgeFields, KnowledgeReading } from '@bukmark/shared/review';
import {
  approveKnowledgeNote, fetchKnowledgeCandidates, fetchKnowledgeNotes, fetchQuotes, knowledgeExportUrl,
  saveKnowledgeNote, startKnowledgeNote, updateKnowledgeEvidence,
} from '../api/client';
import styles from './ReviewPage.module.css';

const PAGE_SIZE = 25;
type EditableFields = Omit<KnowledgeFields, 'tags'> & { tags: string };

function Pages({ offset, more, busy, move }: { offset: number; more?: boolean; busy: boolean; move: (offset: number) => void }) {
  if (!offset && !more) return null;
  return (
    <div className={styles.pages}>
      <button type="button" disabled={!offset || busy} onClick={() => move(offset - PAGE_SIZE)}>Previous page</button>
      <button type="button" disabled={!more || busy} onClick={() => move(offset + PAGE_SIZE)}>Next page</button>
    </div>
  );
}

function NoteEditor({ draft, starting, onUpdate, onAnother, onRefresh }: {
  draft: KnowledgeDraft;
  starting: boolean;
  onUpdate: (draft: KnowledgeDraft) => void;
  onAnother: (linkId: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [edits, setEdits] = useState<EditableFields | null>(null);
  const fields = edits ?? { ...draft.fields, tags: draft.fields.tags.join('\n') };
  const [reading, setReading] = useState<KnowledgeReading | null>(null);
  const [excerpt, setExcerpt] = useState(draft.evidence?.excerpt ?? '');
  const [locator, setLocator] = useState(draft.evidence?.citation.locator ?? '');
  const [pin, setPin] = useState(draft.evidence?.citation.versionUrl ?? '');
  const [quoteId, setQuoteId] = useState('');
  const [passageEdited, setPassageEdited] = useState(false);
  const [validation, setValidation] = useState('');
  const quotes = useQuery({
    queryKey: ['knowledge-quotes', draft.linkId], enabled: Boolean(draft.linkId),
    queryFn: () => fetchQuotes({ linkId: draft.linkId ?? undefined, limit: 10 }),
  });
  const quote = quotes.data?.items.find(({ id }) => id === quoteId);
  const evidence = useMutation({
    mutationFn: (action: KnowledgeEvidenceAction) => updateKnowledgeEvidence(draft.id, draft.revision, action),
    onSuccess: ({ draft: updated, reading: nextReading }, action) => {
      onUpdate(updated);
      if (nextReading) {
        setReading(nextReading);
        setPin(nextReading.versionUrl ?? '');
        setQuoteId('');
      }
      if (action.mode !== 'read') resetPassage(updated);
    },
    onError: onRefresh,
  });
  const save = useMutation({
    mutationFn: (value: KnowledgeFields) => saveKnowledgeNote(draft.id, draft.revision, value),
    onSuccess: ({ draft: updated }) => { onUpdate(updated); setEdits(null); },
    onError: onRefresh,
  });
  const approve = useMutation({
    mutationFn: () => approveKnowledgeNote(draft.id, draft.revision),
    onSuccess: onRefresh,
    onError: onRefresh,
  });
  const busy = starting || evidence.isPending || save.isPending || approve.isPending;
  const error = evidence.error ?? save.error ?? approve.error;
  const { citation } = draft.evidence ?? {};
  const exportId = draft.latestExportId ?? approve.data?.id;
  const canApprove = !edits && !passageEdited && !draft.sourceChanged && draft.evidence && draft.fields.title && draft.fields.bodyMarkdown.trim();

  function resetPassage(note: KnowledgeDraft) {
    setExcerpt(note.evidence?.excerpt ?? '');
    setLocator(note.evidence?.citation.locator ?? '');
    setPin(note.evidence?.citation.versionUrl ?? '');
    setQuoteId('');
    setPassageEdited(false);
  }

  function edit<Key extends keyof EditableFields>(key: Key, value: EditableFields[Key]) {
    setEdits((previous) => ({ ...(previous ?? fields), [key]: value }));
    setValidation('');
    save.reset();
    approve.reset();
  }

  function submitFields() {
    const tags = fields.tags.split('\n').map((tag) => tag.trim()).filter(Boolean);
    if (tags.length > 12 || tags.some((tag) => tag.length > 50)) {
      setValidation('Use up to 12 tags of 50 characters each.');
      return;
    }
    evidence.reset();
    approve.reset();
    save.mutate({ ...fields, tags });
  }

  function capture() {
    save.reset();
    approve.reset();
    const selection = { excerpt, locator: locator.trim() || undefined };
    evidence.mutate(quote
      ? { mode: 'quote', quoteId: quote.id, ...selection }
      : { mode: 'page', ...selection, versionUrl: pin.trim() || undefined });
  }

  return (
    <div className={styles.knowledgeEditor}>
      <fieldset className={styles.recipeFields} disabled={busy}>
        <legend>Supporting passage</legend>
        <p><a href={draft.savedUrl} target="_blank" rel="noreferrer">Saved bookmark source</a></p>
        {draft.sourceChanged ? (
          <div className={styles.recipeEvidence}>
            <p role="alert">The saved passage differs from the current page. Attach a replacement or keep the earlier citation.</p>
            <button type="button" onClick={() => evidence.mutate({ mode: 'keep' })}>Keep earlier citation</button>
          </div>
        ) : null}
        {citation && draft.evidence ? (
          <div className={styles.recipeEvidence}>
            <p><a href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a>
              {citation.locator ? ` · ${citation.locator}` : ''}
              {draft.evidence.kind === 'quote' ? ` · Quote saved ${citation.observedOn}` : ` · Read ${citation.observedOn}`}
            </p>
            <blockquote>{draft.evidence.excerpt}</blockquote>
            {citation.versionUrl ? <a href={citation.versionUrl} target="_blank" rel="noreferrer">Verified Wikipedia revision</a> : null}
            {citation.publisher || citation.attribution ? <p>{citation.attribution ?? citation.publisher}</p> : null}
            {citation.licenseUrl ? <a href={citation.licenseUrl} target="_blank" rel="noreferrer">Source license</a> : null}
          </div>
        ) : <p>Attach a passage before approving.</p>}
        <button type="button" onClick={() => { save.reset(); approve.reset(); evidence.mutate({ mode: 'read' }); }}>
          {evidence.isPending && evidence.variables.mode === 'read' ? 'Reading…' : 'Read public page'}
        </button>
        {quotes.data?.items.length ? (
          <label className={styles.field}>Saved quote
            <select value={quoteId} onChange={(event) => {
              setQuoteId(event.target.value);
              setPassageEdited(true);
              const selected = quotes.data?.items.find(({ id }) => id === event.target.value);
              if (selected) setExcerpt(Array.from(selected.text).slice(0, 300).join(''));
            }}>
              <option value="">Use a page passage</option>
              {quotes.data.items.map((item) => <option key={item.id} value={item.id}>{item.text.slice(0, 100)}</option>)}
            </select>
          </label>
        ) : null}
        {reading && !quote ? (
          <label className={styles.field}>Page preview
            <textarea readOnly rows={6} value={reading.text} />
          </label>
        ) : null}
        <label className={styles.field}>Source excerpt
          <textarea rows={3} maxLength={300} value={excerpt} onChange={(event) => {
            setExcerpt(event.target.value); setPassageEdited(true);
          }} />
        </label>
        <label className={styles.field}>Passage location
          <input maxLength={200} value={locator} onChange={(event) => {
            setLocator(event.target.value); setPassageEdited(true);
          }} placeholder="Section or paragraph" />
        </label>
        {!quote && /\.wikipedia\.org\//i.test(reading?.url ?? draft.savedUrl) ? (
          <label className={styles.field}>Wikipedia permanent link
            <input maxLength={1800} value={pin} onChange={(event) => {
              setPin(event.target.value); setPassageEdited(true);
            }} />
          </label>
        ) : null}
        <button type="button" disabled={!excerpt.trim()} onClick={capture}>{quote ? 'Attach saved quote' : 'Attach verified passage'}</button>
        {passageEdited ? <button type="button" onClick={() => resetPassage(draft)}>Discard passage edits</button> : null}
      </fieldset>
      <form onSubmit={(event) => { event.preventDefault(); submitFields(); }}>
        <fieldset className={styles.recipeFields} disabled={busy}>
          <legend>Note draft</legend>
          <label className={styles.field}>Note title
            <input maxLength={200} value={fields.title} onChange={(event) => edit('title', event.target.value)} />
          </label>
          <label className={styles.field}>Note body (Markdown)
            <textarea maxLength={5000} rows={6} value={fields.bodyMarkdown} onChange={(event) => edit('bodyMarkdown', event.target.value)} />
          </label>
          <label className={styles.field}>Why it matters
            <textarea maxLength={1000} rows={3} value={fields.whyItMatters ?? ''} onChange={(event) => edit('whyItMatters', event.target.value)} />
          </label>
          <label className={styles.field}>Tags, one per line
            <textarea rows={3} value={fields.tags} onChange={(event) => edit('tags', event.target.value)} />
          </label>
          <label className={styles.selection}>
            <input type="checkbox" checked={fields.includeExcerpt} onChange={(event) => edit('includeExcerpt', event.target.checked)} />
            Include the source excerpt in JSON
          </label>
          <div className={styles.actions}>
            <button type="submit" disabled={!edits}>Save draft</button>
            {edits ? <button type="button" onClick={() => { setEdits(null); setValidation(''); }}>Discard unsaved edits</button> : null}
          </div>
        </fieldset>
      </form>
      <div className={styles.bar}>
        <p>{edits ? 'Save your edits before approving.' : passageEdited ? 'Attach the edited passage before approving.' : 'Destination is a JSON download.'}</p>
        <button type="button" className={styles.primary} disabled={busy || !canApprove}
          onClick={() => { evidence.reset(); save.reset(); approve.mutate(); }}>Approve note export</button>
      </div>
      {exportId ? <p role="status" className={styles.message}><a href={knowledgeExportUrl(exportId)}>Download approved note JSON</a></p> : null}
      {validation || error ? <p role="alert" className={styles.error}>{validation || error?.message}</p> : null}
      {draft.linkId ? <button type="button" disabled={busy || Boolean(edits)} onClick={() => onAnother(draft.linkId!)}>Start another note from this bookmark</button> : null}
    </div>
  );
}

export function KnowledgeReview({ linkId }: { linkId: string | null }) {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [noteOffset, setNoteOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<KnowledgeDraft | null>(null);
  const notesKey = ['knowledge-notes', linkId, noteOffset];
  const sources = useQuery({
    queryKey: ['knowledge-candidates', linkId, offset, q],
    queryFn: () => fetchKnowledgeCandidates(linkId, offset, q),
  });
  const notes = useQuery({ queryKey: notesKey, queryFn: () => fetchKnowledgeNotes(linkId, noteOffset) });
  const refresh = () => client.invalidateQueries({ queryKey: ['knowledge-notes'] });
  const start = useMutation({
    mutationFn: ({ sourceId, another }: { sourceId: string; another: boolean }) => startKnowledgeNote(sourceId, another),
    onSuccess: async ({ draft }) => {
      setOpened(draft);
      setSelected(draft.id);
      setNoteOffset(0);
      await refresh();
    },
  });
  const rows = notes.data?.items ?? [];
  const draft = rows.find(({ id }) => id === selected) ?? (opened?.id === selected ? opened : rows[0]);
  const choices = draft && !rows.some(({ id }) => id === draft.id) ? [draft, ...rows] : rows;
  const error = sources.error ?? notes.error ?? start.error;

  function updateDraft(updated: KnowledgeDraft) {
    setOpened(updated);
    client.setQueryData<{ items: KnowledgeDraft[]; more: boolean }>(notesKey, (previous) => previous && {
      ...previous, items: previous.items.map((item) => item.id === updated.id ? updated : item),
    });
  }

  return (
    <div className={styles.builder}>
      <section aria-labelledby="note-sources">
        <h3 id="note-sources">Start from a bookmark</h3>
        <p>Choose a public HTTPS page. Archived bookmarks are included.</p>
        {!linkId ? (
          <form className={styles.actions} onSubmit={(event) => { event.preventDefault(); setQ(search.trim()); setOffset(0); }}>
            <label className={styles.field}>Find note sources
              <input type="search" maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <button type="submit" disabled={start.isPending}>Search</button>
          </form>
        ) : null}
        {sources.isPending ? <p role="status">Finding bookmarks…</p> : null}
        {sources.isSuccess && !sources.data.items.length ? <p>No matching HTTPS bookmarks.</p> : null}
        {sources.data?.items.map((item) => (
          <div className={styles.recipeCandidate} key={item.id}>
            <span>{item.title || item.url} {item.status === 'archived' ? '· Archived' : ''}
              <small className={styles.url}>{item.url}</small>
            </span>
            <button type="button" disabled={start.isPending} aria-label={`Open note for ${item.title || item.url}`}
              onClick={() => start.mutate({ sourceId: item.id, another: false })}>Open note</button>
          </div>
        ))}
        <Pages offset={offset} more={sources.data?.more} busy={start.isPending} move={setOffset} />
      </section>
      <section aria-labelledby="knowledge-drafts">
        <h3 id="knowledge-drafts">Review and export notes</h3>
        {notes.isPending ? <p role="status">Loading notes…</p> : null}
        {notes.isSuccess && !draft ? <p>No notes on this page.</p> : null}
        {choices.length > 1 ? (
          <label className={styles.field}>Choose a note
            <select value={draft?.id ?? ''} onChange={(event) => setSelected(event.target.value)}>
              {choices.map((item) => <option key={item.id} value={item.id}>{item.fields.title || item.savedUrl}</option>)}
            </select>
          </label>
        ) : null}
        {draft ? <NoteEditor key={draft.id} draft={draft} starting={start.isPending} onUpdate={updateDraft} onRefresh={refresh}
          onAnother={(sourceId) => start.mutate({ sourceId, another: true })} /> : null}
        <Pages offset={noteOffset} more={notes.data?.more} busy={start.isPending} move={(value) => { setNoteOffset(value); setSelected(null); }} />
        {error ? <p role="alert" className={styles.error}>{error.message}</p> : null}
      </section>
    </div>
  );
}
