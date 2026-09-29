import { useState } from 'react';
import { errorMessage } from '../api/client';
import { useDeleteQuote, useUpdateQuote } from '../api/queries';
import type { QuoteDto } from '../api/types';
import { sourceAddress } from '../quotes/copyText';
import { useCopyQuote } from '../quotes/useCopyQuote';
import { NoteEditor } from './InlineNoteEditor';
import styles from './QuoteCard.module.css';
import { QUOTE_MAX, QuoteEditor } from './QuoteEditor';

function shortText(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

export function QuoteCard({ quote }: { quote: QuoteDto }) {
  const update = useUpdateQuote();
  const remove = useDeleteQuote();
  const { copied, failed: copyFailed, copy } = useCopyQuote(quote);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const address = sourceAddress(quote.sourceUrl);
  const title = quote.sourceTitle.trim();
  const date = new Date(quote.createdAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <article className={styles.card}>
      <blockquote className={styles.text} cite={quote.sourceUrl}>
        {quote.text}
      </blockquote>
      <NoteEditor
        note={quote.note}
        label={`the quote “${shortText(quote.text)}”`}
        maxLength={QUOTE_MAX}
        onSave={(note) => update.mutateAsync({ id: quote.id, body: { note } })}
      />
      <footer className={styles.meta}>
        <a className={styles.source} href={quote.sourceUrl} target="_blank" rel="noreferrer">
          {title ? (
            <>
              <span className={styles.sourceTitle}>{title}</span>{' '}
              <span className={styles.host}>{address.split('/')[0]}</span>
            </>
          ) : (
            address
          )}
        </a>
        <time className={styles.date} dateTime={quote.createdAt}>
          {date}
        </time>
      </footer>
      <div className={styles.actions}>
        {confirmDelete ? (
          <span className={styles.confirm}>
            Delete this quote?
            <button
              type="button"
              className={styles.danger}
              disabled={remove.isPending}
              onClick={() => remove.mutate(quote.id)}
            >
              Delete for good
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setConfirmDelete(false);
                remove.reset();
              }}
            >
              Keep
            </button>
          </span>
        ) : (
          <>
            <button type="button" className={styles.button} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className={styles.button} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className={styles.button} onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          </>
        )}
      </div>
      {copyFailed ? (
        <p className={styles.error} role="alert">
          Could not copy: the browser did not allow the clipboard.
        </p>
      ) : null}
      {remove.isError ? (
        <p className={styles.error} role="alert">
          {errorMessage(remove.error)}
        </p>
      ) : null}
      <QuoteEditor quote={quote} open={editing} onOpenChange={setEditing} />
    </article>
  );
}
