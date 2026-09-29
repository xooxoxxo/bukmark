import { useRef, useState, type ChangeEvent } from 'react';
import { errorMessage } from '../api/client';
import { useImportLinks } from '../api/queries';
import { UnsupportedFileError, parseImportFile } from '../import/parseBookmarks';

interface Status {
  kind: 'reading' | 'importing' | 'done' | 'error';
  message: string;
}

/** A button that reads a bookmarks file and imports it, with its progress. */
export function ImportBookmarks({ buttonClass, statusClass, errorClass }: {
  buttonClass?: string;
  statusClass?: string;
  errorClass?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const importLinks = useImportLinks();

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so choosing the same file twice fires change again.
    event.target.value = '';
    if (!file) return;

    setStatus({ kind: 'reading', message: `Reading ${file.name}…` });
    try {
      const text = await file.text();
      const parsed = parseImportFile(file.name, text);
      if (parsed.items.length === 0 && !parsed.orphanQuotes?.length) {
        setStatus({ kind: 'error', message: 'No web links in that file.' });
        return;
      }

      setStatus({ kind: 'importing', message: `Importing 0 of ${parsed.items.length}…` });
      const result = await importLinks.mutateAsync({
        items: parsed.items,
        orphanQuotes: parsed.orphanQuotes,
        onProgress: (done, total) =>
          setStatus({ kind: 'importing', message: `Importing ${done} of ${total}…` }),
      });

      const parts = [`${result.created} added`];
      if (result.updated > 0) parts.push(`${result.updated} already here`);
      if (result.quotes.added > 0) {
        parts.push(`${result.quotes.added} ${result.quotes.added === 1 ? 'quote' : 'quotes'} restored`);
      }
      const { alreadyHere } = result.quotes;
      if (alreadyHere > 0) {
        parts.push(`${alreadyHere} ${alreadyHere === 1 ? 'quote' : 'quotes'} already here`);
      }
      const notRestored = result.quotes.invalid + (parsed.quotesNotRestored ?? 0);
      if (notRestored > 0) {
        parts.push(`${notRestored} ${notRestored === 1 ? 'quote' : 'quotes'} not restored`);
      }
      if (result.skippedDeleted > 0) parts.push(`${result.skippedDeleted} stayed deleted`);
      if (parsed.duplicates > 0) parts.push(`${parsed.duplicates} duplicate`);
      if (parsed.nonWeb > 0) parts.push(`${parsed.nonWeb} not web links`);
      if (result.invalid.length > 0) parts.push(`${result.invalid.length} unreadable`);
      setStatus({ kind: 'done', message: `${parts.join(', ')}. New links land unsorted.` });
    } catch (error) {
      const message =
        error instanceof UnsupportedFileError ? error.message : errorMessage(error);
      setStatus({ kind: 'error', message });
    }
  }

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".html,.htm,.json,.csv,text/html,application/json,text/csv"
        hidden
        onChange={onFileChosen}
        data-testid="import-file"
        aria-label="Bookmarks file to import"
      />
      <button
        type="button"
        className={buttonClass}
        disabled={importLinks.isPending}
        onClick={() => fileInput.current?.click()}
      >
        Import bookmarks…
      </button>
      {status ? (
        <p
          className={status.kind === 'error' ? errorClass : statusClass}
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          {status.message}
        </p>
      ) : null}
    </>
  );
}
