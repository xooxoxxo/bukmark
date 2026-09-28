import * as Dialog from '@radix-ui/react-dialog';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api/client';
import { useDeleteLink, useEditLink, useHubs, useLink } from '../api/queries';
import type { HubDto, LinkDetail, LinkPatch } from '../api/types';
import { useEditing } from '../state/editing';
import styles from './LinkEditor.module.css';
import { Checkbox } from './ui/Checkbox';
import { Select } from './ui/Select';

const RELEVANCE = [
  { value: 'none', label: 'Not rated' },
  ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} — ${['', 'skim', 'maybe', 'useful', 'important', 'essential'][n]}` })),
];

const ERRORS: Record<string, string> = {
  timeout: 'it took too long to answer',
  network: 'the connection failed',
  redirects: 'it redirected too many times',
};

/** What the last check found, in a sentence. */
export function checkLine(link: Pick<LinkDetail, 'checkedAt' | 'httpStatus' | 'checkError' | 'broken'>): string {
  if (link.checkError === 'blocked') return 'Not checked: the address is not public, so the server never fetches it.';
  if (!link.checkedAt) return 'Not checked yet — the server reads each saved page in the background.';
  const when = new Date(link.checkedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (link.broken) {
    return link.checkError === 'dns'
      ? `Broken — the domain no longer exists (checked ${when}).`
      : `Broken — the page answered ${link.httpStatus} (checked ${when}).`;
  }
  if (link.checkError) return `Couldn't check on ${when}: ${ERRORS[link.checkError] ?? link.checkError}. It is tried again later.`;
  if (link.httpStatus !== null && link.httpStatus < 400) return `The page was there on ${when}.`;
  return `The page answered ${link.httpStatus} on ${when}.`;
}

export function LinkEditor() {
  const id = useEditing((s) => s.id);
  const close = useEditing((s) => s.close);
  return (
    <Dialog.Root open={id !== null} onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.dialog} aria-describedby={undefined}>
          {id ? <EditorBody id={id} onDone={close} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EditorBody({ id, onDone }: { id: string; onDone: () => void }) {
  const link = useLink(id);
  const { data: hubs } = useHubs();
  if (link.isPending) {
    return (
      <>
        <Dialog.Title className={styles.title}>Edit link</Dialog.Title>
        <p className={styles.state}>Loading…</p>
      </>
    );
  }
  if (link.isError) {
    return (
      <>
        <Dialog.Title className={styles.title}>Edit link</Dialog.Title>
        <p className={styles.error} role="alert">{link.error.message}</p>
        <div className={styles.actions}>
          <Dialog.Close className={styles.secondary}>Close</Dialog.Close>
        </div>
      </>
    );
  }
  return <EditorForm key={link.data.id} link={link.data} hubs={hubs?.items ?? []} onDone={onDone} />;
}

function EditorForm({ link, hubs, onDone }: { link: LinkDetail; hubs: HubDto[]; onDone: () => void }) {
  const [title, setTitle] = useState(link.title);
  const [note, setNote] = useState(link.note);
  const [relevance, setRelevance] = useState(link.relevance === null ? 'none' : String(link.relevance));
  const [archived, setArchived] = useState(link.status === 'archived');
  const [hubIds, setHubIds] = useState(() => new Set(link.hubIds));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const edit = useEditLink();
  const remove = useDeleteLink();
  const busy = edit.isPending || remove.isPending;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body: LinkPatch = {};
    if (title !== link.title) body.title = title;
    if (note !== link.note) body.note = note;
    const rel = relevance === 'none' ? null : Number(relevance);
    if (rel !== link.relevance) body.relevance = rel;
    const status = archived ? 'archived' : 'active';
    if (status !== link.status) body.status = status;
    edit.mutate(
      {
        id: link.id,
        body,
        addHubs: [...hubIds].filter((h) => !link.hubIds.includes(h)),
        removeHubs: link.hubIds.filter((h) => !hubIds.has(h)),
      },
      { onSuccess: onDone },
    );
  }

  function toggleHub(id: string, on: boolean) {
    setHubIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const words = link.contentText ? link.contentText.split(/\s+/).length : 0;

  return (
    <form onSubmit={onSubmit} className={styles.form}>
      <Dialog.Title className={styles.title}>Edit link</Dialog.Title>
      <a className={styles.url} href={link.url} target="_blank" rel="noreferrer">{link.url}</a>
      <p className={link.broken ? `${styles.check} ${styles.broken}` : styles.check}>{checkLine(link)}</p>

      <label className={styles.label} htmlFor="edit-title">Title</label>
      <input id="edit-title" className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} />

      <label className={styles.label} htmlFor="edit-note">Why keep it?</label>
      <textarea id="edit-note" className={styles.input} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-relevance">Relevance</label>
          <Select id="edit-relevance" value={relevance} onValueChange={setRelevance} options={RELEVANCE} ariaLabel="Relevance" />
        </div>
        <label className={styles.archive}>
          <Checkbox checked={archived} onCheckedChange={setArchived} aria-label="Archived" />
          Archived
        </label>
      </div>

      <fieldset className={styles.hubs}>
        <legend className={styles.label}>Hubs</legend>
        {hubs.length === 0 ? <p className={styles.muted}>No hubs yet — add one from the sidebar.</p> : null}
        <div className={styles.hubList}>
          {hubs.map((hub) => (
            <label key={hub.id} className={styles.hub}>
              <Checkbox checked={hubIds.has(hub.id)} onCheckedChange={(on) => toggleHub(hub.id, on)} aria-label={hub.name} />
              {hub.name}
            </label>
          ))}
        </div>
      </fieldset>

      <details className={styles.copy}>
        <summary>Saved copy of the page{link.contentText ? ` · ${words.toLocaleString()} words` : ''}</summary>
        {link.contentText ? (
          <div className={styles.copyText} tabIndex={0}>{link.contentText}</div>
        ) : (
          <p className={styles.muted}>No copy yet: the page's text is saved the first time it is checked.</p>
        )}
      </details>

      {edit.isError || remove.isError ? (
        <p className={styles.error} role="alert">{errorMessage(edit.error ?? remove.error)}</p>
      ) : null}

      <div className={styles.actions}>
        {confirmDelete ? (
          <span className={styles.confirm}>
            Delete for good?
            <button type="button" className={styles.danger} disabled={busy} onClick={() => remove.mutate(link.id, { onSuccess: onDone })}>
              Delete
            </button>
            <button type="button" className={styles.secondary} onClick={() => setConfirmDelete(false)}>Keep</button>
          </span>
        ) : (
          <button type="button" className={styles.dangerLink} onClick={() => setConfirmDelete(true)}>Delete…</button>
        )}
        <span className={styles.spacer} />
        <Dialog.Close className={styles.secondary} type="button">Cancel</Dialog.Close>
        <button type="submit" className={styles.primary} disabled={busy}>{edit.isPending ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
