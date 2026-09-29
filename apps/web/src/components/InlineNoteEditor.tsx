import { useState, type KeyboardEvent } from 'react';
import { errorMessage } from '../api/client';
import { usePatchLink } from '../api/queries';
import type { LinkDto } from '../api/types';
import styles from './InlineNoteEditor.module.css';

/** A link's note, edited in place; see NoteEditor. */
export function InlineNoteEditor({ link, compact = false }: { link: LinkDto; compact?: boolean }) {
  const patch = usePatchLink();
  return (
    <NoteEditor
      note={link.note}
      label={link.title || link.url}
      compact={compact}
      onSave={(note) => patch.mutateAsync({ id: link.id, body: { note } })}
    />
  );
}

/**
 * A note, edited where it is shown: click it (or "Add a note"), type, and
 * Enter or leaving the field saves. Shift+Enter is a new line; Escape puts the
 * note back as it was. `label` names what the note belongs to, for the
 * accessible names; `onSave` gets the trimmed note and rejects to keep the
 * field open with the reason.
 */
export function NoteEditor({
  note,
  label,
  onSave,
  compact = false,
  maxLength,
}: {
  note: string;
  label: string;
  onSave: (note: string) => Promise<unknown>;
  compact?: boolean;
  maxLength?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function open() {
    setValue(note);
    setError(null);
    setEditing(true);
  }

  function save() {
    if (pending) return;
    const next = value.trim();
    if (next === note) {
      setEditing(false);
      return;
    }
    setPending(true);
    setError(null);
    onSave(next).then(
      () => {
        setPending(false);
        setEditing(false);
      },
      (err: unknown) => {
        setPending(false);
        setError(err);
      },
    );
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
          maxLength={maxLength}
          onChange={(event) => setValue(event.target.value)}
          onBlur={save}
          onKeyDown={onKeyDown}
          autoFocus
          aria-label={`Note for ${label}`}
        />
        {pending ? <p className={styles.status} role="status">Saving…</p> : null}
        {error !== null ? (
          <p className={styles.error} role="alert">
            {errorMessage(error)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${note ? styles.note : styles.add}${compact ? ` ${styles.compact}` : ''}`}
      onClick={open}
      aria-label={note ? `Edit note: ${note}` : `Add a note to ${label}`}
    >
      {note || 'Add a note'}
    </button>
  );
}
