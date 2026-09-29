import * as Dialog from '@radix-ui/react-dialog';
import { useState, type FormEvent } from 'react';
import { ApiError, errorMessage } from '../api/client';
import { useUpdateQuote } from '../api/queries';
import type { QuoteDto, QuotePatch } from '../api/types';
// The link editor's dialog, fields and buttons: one look for both edit dialogs.
import styles from './LinkEditor.module.css';

/** The server's cap on a quote's text and on its note. */
export const QUOTE_MAX = 10000;

function saveError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return 'Another quote from this page already has that text.';
  }
  return errorMessage(error);
}

/** A small dialog for a quote's text and note. */
export function QuoteEditor({
  quote,
  open,
  onOpenChange,
}: {
  quote: QuoteDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.dialog} aria-describedby={undefined}>
          {open ? <QuoteForm quote={quote} onDone={() => onOpenChange(false)} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function QuoteForm({ quote, onDone }: { quote: QuoteDto; onDone: () => void }) {
  const [text, setText] = useState(quote.text);
  const [note, setNote] = useState(quote.note);
  const update = useUpdateQuote();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || update.isPending) return;
    const body: QuotePatch = {};
    if (text !== quote.text) body.text = text;
    if (note.trim() !== quote.note) body.note = note.trim();
    if (Object.keys(body).length === 0) {
      onDone();
      return;
    }
    update.mutate({ id: quote.id, body }, { onSuccess: onDone });
  }

  return (
    <form onSubmit={onSubmit} className={styles.form}>
      <Dialog.Title className={styles.title}>Edit quote</Dialog.Title>
      <a className={styles.url} href={quote.sourceUrl} target="_blank" rel="noreferrer">
        {quote.sourceUrl}
      </a>

      <label className={styles.label} htmlFor={`quote-text-${quote.id}`}>Text</label>
      <textarea
        id={`quote-text-${quote.id}`}
        className={styles.input}
        rows={6}
        maxLength={QUOTE_MAX}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />

      <label className={styles.label} htmlFor={`quote-note-${quote.id}`}>Note</label>
      <textarea
        id={`quote-note-${quote.id}`}
        className={styles.input}
        rows={3}
        maxLength={QUOTE_MAX}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      {update.isError ? (
        <p className={styles.error} role="alert">{saveError(update.error)}</p>
      ) : null}

      <div className={styles.actions}>
        <span className={styles.spacer} />
        <Dialog.Close className={styles.secondary} type="button">Cancel</Dialog.Close>
        <button type="submit" className={styles.primary} disabled={!text.trim() || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
