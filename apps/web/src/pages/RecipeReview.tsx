import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecipeApproval, RecipeDraft, RecipeFields } from '@bukmark/shared';
import {
  approveRecipeExport, fetchRecipeCandidates, fetchRecipeDrafts, prepareRecipe, recipeExportUrl,
  type RecipePreparation,
} from '../api/client';
import styles from './ReviewPage.module.css';

const PAGE_SIZE = 25;

function Pages({ offset, more, busy, move }: { offset: number; more?: boolean; busy: boolean; move: (offset: number) => void }) {
  if (!offset && !more) return null;
  return (
    <div className={styles.pages}>
      <button type="button" disabled={!offset || busy} onClick={() => move(offset - PAGE_SIZE)}>Previous page</button>
      <button type="button" disabled={!more || busy} onClick={() => move(offset + PAGE_SIZE)}>Next page</button>
    </div>
  );
}

function preparationMessage(result: RecipePreparation) {
  switch (result.outcome) {
    case 'prepared': return '';
    case 'choose': return '';
    case 'missing':
    case 'changed': return 'The bookmark changed or is no longer saved.';
    case 'malformed': return 'The page has unreadable recipe data.';
    case 'ambiguous': return 'The page has several recipe cards without distinct identities.';
    case 'no-recipe': return 'No supported recipe card was found on this page.';
    case 'unavailable':
      if (result.error === 'blocked') return 'Recipe preparation requires a public HTTPS page.';
      return result.status ? `The recipe page could not be read (HTTP ${result.status}).` : 'The recipe page is unavailable. Try again later.';
  }
}

function List({ items, ordered = false }: { items: string[]; ordered?: boolean }) {
  const Element = ordered ? 'ol' : 'ul';
  return <Element>{items.map((item, index) => <li key={index}>{item}</li>)}</Element>;
}

function splitLines(input: string) {
  return input.split('\n').map((line) => line.trim()).filter(Boolean);
}

function RecipeForm({ draft, busy, onApprove }: { draft: RecipeDraft; busy: boolean; onApprove: (input: RecipeApproval) => void }) {
  const [form, setForm] = useState(() => ({
    ...draft.fields,
    authors: draft.fields.authors?.join('\n') ?? '',
    ingredients: draft.fields.ingredients.join('\n'),
    steps: draft.fields.steps.join('\n'),
    notes: draft.fields.notes?.join('\n') ?? '',
  }));
  const [selected, setSelected] = useState(draft.selectedVariations);
  const [reviewed, setReviewed] = useState(draft.reviewedUnassigned);
  const [validation, setValidation] = useState('');
  const { timingConflict, unassigned } = draft;
  const timing = form.timing ?? {};
  const waits = timing.passive ?? [];
  const timingInvalid = timingConflict && (
    (timing.cookMinutes !== undefined && timing.cookMinutes < timingConflict.minimumMinutes)
    || (timing.totalMinutes !== undefined && timing.totalMinutes < (timing.prepMinutes ?? 0) + (timing.cookMinutes ?? timingConflict.minimumMinutes))
  );

  function change<Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setValidation('');
  }

  function submit() {
    const ingredients = splitLines(form.ingredients);
    const steps = splitLines(form.steps);
    const notes = splitLines(form.notes);
    const authors = splitLines(form.authors);
    if (!form.title.trim() || !ingredients.length || !steps.length) {
      setValidation('Add a title, at least one ingredient, and at least one instruction.');
      return;
    }
    if (ingredients.length > 100 || steps.length > 100 || notes.length > 20 || authors.length > 12
      || [...ingredients, ...steps, ...notes].some((line) => line.length > 2000) || authors.some((line) => line.length > 200)) {
      setValidation('Shorten the lists or split long lines before approving.');
      return;
    }
    const passive = waits.filter(({ activity, durationText }) => activity.trim() && durationText.trim());
    const approvedTiming = { ...timing, passive: passive.length ? passive : undefined };
    const fields: RecipeFields = {
      title: form.title.trim(), ingredients, steps,
      publisher: form.publisher?.trim() || undefined,
      authors: authors.length ? authors : undefined,
      credit: form.credit?.trim() || undefined,
      yield: form.yield?.servings || form.yield?.text ? form.yield : undefined,
      timing: Object.values(approvedTiming).some((value) => value !== undefined) ? approvedTiming : undefined,
      notes: notes.length ? notes : undefined,
    };
    onApprove({ id: draft.id, revision: draft.revision, fields, selectedVariations: selected, reviewedUnassigned: reviewed });
  }

  return (
    <form className={styles.recipeForm} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <p><a href={draft.url} target="_blank" rel="noreferrer">Public recipe source</a></p>
      <div className={styles.row}>
        <div className={styles.review}>
          <label className={styles.field}>Recipe title
            <input required maxLength={200} value={form.title} disabled={busy} onChange={(event) => change('title', event.target.value)} />
          </label>
          <label className={styles.field}>Base ingredients, one per line
            <textarea required rows={5} value={form.ingredients} disabled={busy} onChange={(event) => change('ingredients', event.target.value)} />
          </label>
          <label className={styles.field}>Base steps, one per line
            <textarea required rows={7} value={form.steps} disabled={busy} onChange={(event) => change('steps', event.target.value)} />
          </label>
          <label className={styles.field}>Cooking notes, one per line
            <textarea rows={3} value={form.notes} disabled={busy} onChange={(event) => change('notes', event.target.value)} />
          </label>
        </div>
        <div className={styles.review}>
          <label className={styles.field}>Servings
            <input type="number" min={1} max={10000} value={form.yield?.servings ?? ''} disabled={busy}
              onChange={(event) => change('yield', { ...form.yield, servings: event.target.value ? Number(event.target.value) : undefined })} />
          </label>
          <label className={styles.field}>Yield description
            <input maxLength={160} value={form.yield?.text ?? ''} disabled={busy}
              onChange={(event) => change('yield', { ...form.yield, text: event.target.value || undefined })} />
          </label>
          <fieldset className={styles.recipeFields} disabled={busy}>
            <legend>Timing</legend>
            {([
              ['prepMinutes', 'Prep minutes'], ['cookMinutes', 'Cook minutes'], ['totalMinutes', 'Total minutes'],
            ] as const).map(([key, label]) => (
              <label key={key} className={styles.field}>{label}
                <input type="number" min={0} max={10080} value={timing[key] ?? ''}
                  onChange={(event) => change('timing', { ...timing, [key]: event.target.value ? Number(event.target.value) : undefined })} />
              </label>
            ))}
            {timingConflict ? (
              <div className={styles.recipeEvidence}>
                <p>The card lists {timingConflict.listedMinutes} minutes of cooking. A base step calls for {timingConflict.minimumMinutes} minutes.</p>
                <details><summary>See the source step</summary><p>{timingConflict.step}</p></details>
                <button type="button" onClick={() => change('timing', { ...timing, cookMinutes: undefined, totalMinutes: undefined })}>Omit disputed times</button>
              </div>
            ) : null}
            {waits.map((wait, index) => (
              <div key={index} className={styles.recipeWait}>
                <label className={styles.field}>Wait activity
                  <input required={Boolean(wait.durationText)} maxLength={200} value={wait.activity}
                    onChange={(event) => change('timing', { ...timing, passive: waits.map((item, position) =>
                      position === index ? { ...item, activity: event.target.value } : item) })} />
                </label>
                <label className={styles.field}>Wait duration
                  <input required={Boolean(wait.activity)} maxLength={160} value={wait.durationText}
                    onChange={(event) => change('timing', { ...timing, passive: waits.map((item, position) =>
                      position === index ? { ...item, durationText: event.target.value } : item) })} />
                </label>
                <button type="button" onClick={() => change('timing', { ...timing, passive: waits.filter((_item, position) => position !== index) })}>Remove wait</button>
              </div>
            ))}
            {waits.length < 12 ? <button type="button" onClick={() => change('timing', { ...timing, passive: [...waits, { activity: '', durationText: '' }] })}>Add wait</button> : null}
          </fieldset>
          <fieldset className={styles.recipeFields} disabled={busy}>
            <legend>Source credit</legend>
            <label className={styles.field}>Publisher
              <input maxLength={200} value={form.publisher ?? ''} onChange={(event) => change('publisher', event.target.value)} />
            </label>
            <label className={styles.field}>Authors, one per line
              <textarea rows={2} value={form.authors} onChange={(event) => change('authors', event.target.value)} />
            </label>
            <label className={styles.field}>Credit
              <input maxLength={500} value={form.credit ?? ''} onChange={(event) => change('credit', event.target.value)} />
            </label>
          </fieldset>
        </div>
      </div>
      {unassigned ? (
        <fieldset className={styles.recipeFields} disabled={busy}>
          <legend>Unassigned recipe lines</legend>
          <p>Copy the lines you want into the base recipe before approving.</p>
          <List items={unassigned.ingredients} /><List items={unassigned.steps} ordered />
          <label className={styles.selection}>
            <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
            I placed or excluded the unassigned lines
          </label>
        </fieldset>
      ) : null}
      {draft.variations.length ? (
        <fieldset className={styles.recipeFields} disabled={busy}>
          <legend>Variations</legend>
          {draft.variations.map((variant) => (
            <div key={variant.key}>
              <label className={styles.selection}>
                <input type="checkbox" checked={selected.includes(variant.key)} onChange={(event) => setSelected((previous) =>
                  event.target.checked ? [...previous, variant.key] : previous.filter((key) => key !== variant.key))} />
                Include {variant.title}
              </label>
              <details><summary>See ingredients and step changes</summary><List items={variant.ingredients} /><List items={variant.steps} ordered /></details>
            </div>
          ))}
        </fieldset>
      ) : null}
      <div className={styles.bar}>
        <p>Destination is a JSON download.</p>
        <button type="submit" className={styles.primary} disabled={busy || Boolean(timingInvalid) || Boolean(unassigned && !reviewed)}>
          Approve recipe export
        </button>
      </div>
      {validation ? <p role="alert" className={styles.error}>{validation}</p> : null}
    </form>
  );
}

export function RecipeReview({ linkId }: { linkId: string | null }) {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [candidateOffset, setCandidateOffset] = useState(0);
  const [draftOffset, setDraftOffset] = useState(0);
  const [draftId, setDraftId] = useState('');
  const candidates = useQuery({
    queryKey: ['recipe-candidates', linkId, candidateOffset, q],
    queryFn: () => fetchRecipeCandidates(linkId, candidateOffset, q),
  });
  const drafts = useQuery({
    queryKey: ['recipe-drafts', linkId, draftOffset],
    queryFn: () => fetchRecipeDrafts(linkId, draftOffset),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['recipe-drafts'] });
  const prepare = useMutation({
    mutationFn: ({ id, key }: { id: string; key?: string }) => prepareRecipe(id, key),
    onSuccess: async (result) => {
      if (result.outcome === 'prepared') {
        setDraftOffset(0);
        setDraftId(result.draft.id);
        await refresh();
      }
    },
  });
  const approve = useMutation({ mutationFn: approveRecipeExport, onSuccess: refresh, onError: refresh });
  const busy = prepare.isPending || approve.isPending;
  const rows = drafts.data?.items ?? [];
  const draft = rows.find(({ id }) => id === draftId)
    ?? (prepare.data?.outcome === 'prepared' && prepare.data.draft.id === draftId ? prepare.data.draft : rows[0]);
  const problem = prepare.data ? preparationMessage(prepare.data) : '';
  const choices = prepare.data?.outcome === 'choose' && prepare.variables ? { ...prepare.data, sourceId: prepare.variables.id } : null;
  const error = candidates.error ?? drafts.error ?? prepare.error ?? approve.error;

  return (
    <div className={styles.builder}>
      <section aria-labelledby="recipe-sources">
        <h3 id="recipe-sources">Prepare a recipe from a bookmark</h3>
        <p>Choose a saved recipe page. Archived bookmarks are included.</p>
        {!linkId ? (
          <form className={styles.actions} onSubmit={(event) => { event.preventDefault(); setQ(search.trim()); setCandidateOffset(0); }}>
            <label className={styles.field}>Find recipe bookmarks
              <input type="search" maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <button type="submit" disabled={busy}>Search</button>
          </form>
        ) : null}
        {candidates.isPending ? <p role="status">Finding bookmarks…</p> : null}
        {candidates.isSuccess && !candidates.data.items.length ? <p>No matching HTTPS bookmarks.</p> : null}
        {candidates.data?.items.map((source) => (
          <div className={styles.recipeCandidate} key={source.id}>
            <span>{source.title || source.url} {source.status === 'archived' ? '· Archived' : ''}
              <small className={styles.url}>{source.url}</small>
            </span>
            <button type="button" disabled={busy} aria-label={`Prepare ${source.title || source.url}`}
              onClick={() => prepare.mutate({ id: source.id })}>Prepare recipe</button>
          </div>
        ))}
        <Pages offset={candidateOffset} more={candidates.data?.more} busy={busy} move={setCandidateOffset} />
        {prepare.isPending ? <p role="status">Reading recipe card…</p> : null}
        {problem ? <p role="alert" className={styles.error}>{problem}</p> : null}
        {choices ? (
          <div className={styles.actions}>
            <p>Choose a recipe card.</p>
            {choices.choices.map(({ key, title }) => (
              <button key={key} type="button" disabled={busy} onClick={() => prepare.mutate({ id: choices.sourceId, key })}>
                {title || key}
              </button>
            ))}
          </div>
        ) : null}
      </section>
      <section aria-labelledby="recipe-drafts">
        <h3 id="recipe-drafts">Review recipe drafts</h3>
        {drafts.isPending ? <p role="status">Loading recipes…</p> : null}
        {drafts.isSuccess && !draft ? <p>No prepared recipes on this page.</p> : null}
        {rows.length > 1 ? (
          <label className={styles.field}>Recipe draft
            <select value={draft?.id ?? ''} disabled={busy} onChange={(event) => setDraftId(event.target.value)}>
              {rows.map((item) => <option key={item.id} value={item.id}>{item.fields.title || item.url}</option>)}
            </select>
          </label>
        ) : null}
        {draft ? <RecipeForm key={`${draft.id}:${draft.revision}`} draft={draft} busy={busy} onApprove={(input) => approve.mutate(input)} /> : null}
        <Pages offset={draftOffset} more={drafts.data?.more} busy={busy} move={(offset) => { setDraftId(''); setDraftOffset(offset); }} />
        {approve.data && approve.variables?.id === draft?.id ? (
          <p role="status" className={styles.message}><a href={recipeExportUrl(approve.data.id)}>Download recipe JSON</a></p>
        ) : null}
        {error ? <p role="alert" className={styles.error}>{error.message}</p> : null}
      </section>
    </div>
  );
}
