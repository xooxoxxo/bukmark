import { useState, type KeyboardEvent } from 'react';
import { errorMessage } from '../api/client';
import { usePatchLink } from '../api/queries';
import type { LinkDto } from '../api/types';
import styles from './InlineNoteEditor.module.css';

/**
 * A link's note, edited where it is shown: click it (or "Add a note"), type,
 * and Enter or leaving the field saves. Shift+Enter is a new line; Escape
 * puts the note back as it was.
 */
export function InlineNoteEditor({ link, compact = false }: { link: LinkDto; compact?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(link.note);
  const patch = usePatchLink();

  function open() {
    setValue(link.note);
    patch.reset();
    setEditing(true);
  }

  function save() {
    if (patch.isPending) return;
    const note = value.trim();
    if (note === link.note) {
      setEditing(false);
      return;
    }
    patch.mutate({ id: link.id, body: { note } }, { onSuccess: () => setEditing(false) });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className={compact ? `${styles.edit} ${styles.compact}` : styles.edit}>
        <textarea
          className={styles.textarea}
          value={value}
          rows={2}
          onChange={(event) => setValue(event.target.value)}
          onBlur={save}
          onKeyDown={onKeyDown}
          autoFocus
          aria-label={`Note for ${link.title || link.url}`}
        />
        {patch.isPending ? <p className={styles.status} role="status">Saving…</p> : null}
        {patch.isError ? (
          <p className={styles.error} role="alert">
            {errorMessage(patch.error)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${link.note ? styles.note : styles.add}${compact ? ` ${styles.compact}` : ''}`}
      onClick={open}
      aria-label={link.note ? `Edit note: ${link.note}` : `Add a note to ${link.title || link.url}`}
    >
      {link.note || 'Add a note'}
    </button>
  );
}
