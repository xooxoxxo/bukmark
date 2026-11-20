import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BUILDER_EXPORT_MAX_ITEMS } from '@bukmark/shared/review';
import {
  approveBuilderExport, builderExportUrl, fetchBuilderCandidates, fetchBuilderDrafts, prepareBuilderDrafts,
} from '../api/client';
import type { BuilderApproval, BuilderCandidate, BuilderContext, BuilderDraft } from '../api/types';
import styles from './ReviewPage.module.css';

const PAGE_SIZE = 25;
const PREPARE_LIMIT = 12;

function contextLabel(context: BuilderContext) {
  switch (context.kind) {
    case 'issue': return `issue #${context.number}`;
    case 'discussion': return `discussion #${context.number}`;
    case 'code': return `${context.entryType === 'file' ? 'file' : 'folder'} ${context.path}`;
    case 'package-version': return `version ${context.version}`;
  }
}

function Pages({ offset, more, busy, onChange }: {
  offset: number; more: boolean; busy: boolean; onChange: (offset: number) => void;
}) {
  if (!offset && !more) return null;
  return (
    <div className={styles.pages}>
      <button type="button" disabled={!offset || busy} onClick={() => onChange(offset - PAGE_SIZE)}>Previous page</button>
      <button type="button" disabled={!more || busy} onClick={() => onChange(offset + PAGE_SIZE)}>Next page</button>
    </div>
  );
}

function DraftCard({ item, edit, selected, busy, selectionDisabled, onEdit, onSelect }: {
  item: BuilderDraft;
  edit: DraftEdit;
  selected: boolean;
  busy: boolean;
  selectionDisabled: boolean;
  onEdit: (edit: DraftEdit) => void;
  onSelect: (selected: boolean) => void;
}) {
  const { record } = item;
  return (
    <article className={styles.row} aria-label={record.name}>
      <div className={styles.source}>
        <h3>{record.name}</h3>
        <p className={styles.meta}>
          {record.kind === 'repository' ? 'GitHub repository' : 'npm package'}
          {record.language ? ` · ${record.language}` : ''}
        </p>
        <p className={styles.url}>{record.key}</p>
        <a className={styles.url} href={record.canonicalUrl} target="_blank" rel="noreferrer">Public source</a>
        {record.kind === 'package' && record.repositoryUrl ? (
          <a className={styles.url} href={record.repositoryUrl} target="_blank" rel="noreferrer">Source repository</a>
        ) : null}
        {record.context.length ? (
          <fieldset className={styles.context} disabled={busy}>
            <legend>Attached context</legend>
            {record.context.map((context) => (
              <div key={context.key}>
                <label className={styles.selection}>
                  <input type="checkbox" checked={edit.contextKeys.includes(context.key)}
                    onChange={(event) => onEdit({ ...edit, contextKeys: event.target.checked
                      ? [...edit.contextKeys, context.key] : edit.contextKeys.filter((key) => key !== context.key) })}
                  />
                  Include {contextLabel(context)}
                </label>
                <p>
                  <a href={context.url} target="_blank" rel="noreferrer">
                    {context.kind === 'issue' || context.kind === 'discussion' ? context.title
                      : context.kind === 'code' ? `Pinned commit ${context.commit.slice(0, 12)}` : context.version}
                  </a>
                  {context.kind === 'issue' ? ` · ${context.state}` : ''}
                </p>
                {context.kind === 'issue' && context.note ? <p className={styles.meta}>{context.note}</p> : null}
                {(context.kind === 'discussion' || context.kind === 'code') && context.sourceUrl !== context.url ? (
                  <a className={styles.meta} href={context.sourceUrl} target="_blank" rel="noreferrer">Saved bookmark</a>
                ) : null}
              </div>
            ))}
          </fieldset>
        ) : null}
      </div>
      <div className={styles.review}>
        <label className={styles.field}>
          Synopsis
          <textarea rows={3} maxLength={500} value={edit.synopsis} disabled={busy}
            onChange={(event) => onEdit({ ...edit, synopsis: event.target.value })} />
        </label>
        <label className={styles.field}>
          Tags, one per line
          <textarea rows={3} value={edit.tags} disabled={busy}
            onChange={(event) => onEdit({ ...edit, tags: event.target.value })} />
        </label>
        <label className={styles.selection}>
          <input type="checkbox" aria-label={`Select ${record.name} for JSON export`} checked={selected} disabled={selectionDisabled}
            onChange={(event) => onSelect(event.target.checked)} />
          Select for export
        </label>
      </div>
    </article>
  );
}

interface DraftEdit {
  synopsis: string;
  tags: string;
  contextKeys: string[];
}

function draftKey({ id, revision }: Pick<BuilderDraft, 'id' | 'revision'>) {
  return `${id}:${revision}`;
}

function initialEdit({ record, excluded }: BuilderDraft): DraftEdit {
  return {
    synopsis: record.synopsis, tags: record.tags.join('\n'),
    contextKeys: record.context.filter(({ key }) => !excluded.includes(key)).map(({ key }) => key),
  };
}

export function BuilderReview({ linkId }: { linkId: string | null }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [candidateOffset, setCandidateOffset] = useState(0);
  const [draftOffset, setDraftOffset] = useState(0);
  const [sources, setSources] = useState(new Map<string, BuilderCandidate>());
  const [selected, setSelected] = useState(new Map<string, BuilderDraft>());
  const [edits, setEdits] = useState<Record<string, DraftEdit>>({});
  const [tagError, setTagError] = useState(false);
  const refreshDrafts = () => queryClient.invalidateQueries({ queryKey: ['builder-drafts'] });

  const candidates = useQuery({
    queryKey: ['builder-candidates', linkId, candidateOffset, query],
    queryFn: () => fetchBuilderCandidates(linkId, candidateOffset, query),
  });
  const drafts = useQuery({
    queryKey: ['builder-drafts', linkId, draftOffset],
    queryFn: () => fetchBuilderDrafts(linkId, draftOffset),
  });
  const prepare = useMutation({
    mutationFn: (items: BuilderCandidate[]) => prepareBuilderDrafts(items.map(({ id }) => id)),
    onSuccess: async () => {
      setSources(new Map());
      setDraftOffset(0);
      await refreshDrafts();
    },
  });
  const approve = useMutation({
    mutationFn: approveBuilderExport,
    onSuccess: async (_result, items) => {
      const approved = new Set(items.map(draftKey));
      setSelected((previous) => new Map([...previous].filter(([, item]) => !approved.has(draftKey(item)))));
      setEdits((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !approved.has(key))));
      await refreshDrafts();
    },
    onError: refreshDrafts,
  });
  const busy = prepare.isPending || approve.isPending;
  const rows = drafts.data?.items ?? [];
  const selectedRows = [...selected.values()];
  const staleSelection = rows.some((item) => selected.has(item.id) && selected.get(item.id)!.revision !== item.revision);
  const editFor = (item: BuilderDraft) => edits[draftKey(item)] ?? initialEdit(item);
  const error = candidates.error ?? drafts.error ?? prepare.error ?? approve.error;

  function exportSelected() {
    const items: BuilderApproval[] = selectedRows.map((item) => {
      const edit = editFor(item);
      return {
        id: item.id, revision: item.revision, synopsis: edit.synopsis, contextKeys: edit.contextKeys,
        tags: [...new Set(edit.tags.split('\n').map((tag) => tag.trim()).filter(Boolean))],
      };
    });
    const invalid = items.some(({ tags }) => tags.length > 12 || tags.some((tag) => tag.length > 50));
    setTagError(invalid);
    if (!invalid) approve.mutate(items);
  }

  return (
    <div className={styles.builder}>
      <section aria-labelledby="builder-candidates">
        <h3 id="builder-candidates">Prepare from bookmarks</h3>
        <p>Select up to {PREPARE_LIMIT} saved GitHub repositories, issues, discussions, files, folders, or npm packages.</p>
        {!linkId ? (
          <form className={styles.actions} onSubmit={(event) => {
            event.preventDefault();
            setQuery(search.trim());
            setCandidateOffset(0);
          }}>
            <label className={styles.field}>
              Find bookmarks
              <input type="search" maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <button type="submit" disabled={busy}>Search</button>
          </form>
        ) : null}
        {candidates.isPending ? <p role="status">Finding bookmarks…</p> : null}
        {candidates.isSuccess && !candidates.data.items.length ? <p>No supported bookmarks on this page.</p> : null}
        {candidates.data?.items.map((item) => (
          <label key={item.id} className={`${styles.selection} ${styles.builderCandidate}`}>
            <input type="checkbox" checked={sources.has(item.id)}
              disabled={busy || (sources.size >= PREPARE_LIMIT && !sources.has(item.id))}
              onChange={(event) => {
                const checked = event.target.checked;
                setSources((previous) => {
                  const next = new Map(previous);
                  if (checked) next.set(item.id, item);
                  else next.delete(item.id);
                  return next;
                });
              }} />
            <span>{item.title || item.url}{item.title ? <small className={styles.url}>{item.url}</small> : null}</span>
          </label>
        ))}
        <Pages offset={candidateOffset} more={Boolean(candidates.data?.more)} busy={busy} onChange={setCandidateOffset} />
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={busy || sources.size === 0}
            onClick={() => prepare.mutate([...sources.values()])}>
            {prepare.isPending ? 'Checking sources…' : `Prepare selected links${sources.size ? ` (${sources.size})` : ''}`}
          </button>
          {sources.size ? <button type="button" disabled={busy} onClick={() => setSources(new Map())}>Clear selection</button> : null}
        </div>
        {prepare.data ? (
          <ul className={styles.builderResults} aria-label="Preparation results">
            {prepare.data.items.map((item) => {
              const source = prepare.variables.find(({ id }) => item.linkId === id);
              return (
                <li key={item.linkId}>
                  {source?.title || source?.url || 'Saved link'}. {item.reason ?? (
                    item.outcome === 'inactive' ? 'This link is no longer active or has changed.'
                      : item.outcome === 'unchanged' ? 'Already prepared.' : 'Ready for builder review.'
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
      <section aria-labelledby="builder-drafts">
        <div className={styles.bar}>
          <div>
            <h3 id="builder-drafts">Review builder drafts</h3>
            <p>Select up to {BUILDER_EXPORT_MAX_ITEMS} drafts for one JSON download. Selections and edits are kept across pages.</p>
          </div>
          <button type="button" className={styles.primary} disabled={busy || !selectedRows.length || staleSelection} onClick={exportSelected}>
            {approve.isPending ? 'Approving…' : `Approve JSON export${selectedRows.length ? ` (${selectedRows.length})` : ''}`}
          </button>
        </div>
        {selected.size ? (
          <button type="button" disabled={busy} onClick={() => setSelected(new Map())}>Clear selected drafts</button>
        ) : null}
        {approve.data ? (
          <p role="status" className={styles.message}>
            <a href={builderExportUrl(approve.data.id)}>
              Download JSON ({approve.data.recordCount} {approve.data.recordCount === 1 ? 'record' : 'records'})
            </a>
          </p>
        ) : null}
        {error || tagError || staleSelection ? (
          <p role="alert" className={styles.error}>{error?.message ?? (staleSelection
            ? 'A selected draft changed. Review it and select it again.' : 'Use up to 12 tags of 50 characters each.')}</p>
        ) : null}
        {drafts.isPending ? <p role="status">Loading builder drafts…</p> : null}
        {drafts.isSuccess && !rows.length ? <p>No builder drafts on this page.</p> : null}
        {rows.map((item) => {
          const key = draftKey(item);
          return <DraftCard key={key} item={item} edit={editFor(item)} selected={selected.get(item.id)?.revision === item.revision} busy={busy}
            selectionDisabled={busy || (selected.size >= BUILDER_EXPORT_MAX_ITEMS && !selected.has(item.id))}
            onEdit={(edit) => {
              setTagError(false);
              setEdits((previous) => ({ ...previous, [key]: edit }));
            }}
            onSelect={(checked) => setSelected((previous) => {
              const next = new Map(previous);
              if (checked) next.set(item.id, item);
              else next.delete(item.id);
              return next;
            })} />;
        })}
        <Pages offset={draftOffset} more={Boolean(drafts.data?.more)} busy={busy} onChange={setDraftOffset} />
      </section>
    </div>
  );
}
