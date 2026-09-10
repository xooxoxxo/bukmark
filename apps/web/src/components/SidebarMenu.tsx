import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useRef, useState, type ChangeEvent } from 'react';
import { errorMessage } from '../api/client';
import { useImportLinks } from '../api/queries';
import { UnsupportedFileError, parseImportFile } from '../import/parseBookmarks';
import styles from './SidebarMenu.module.css';

const DOCS_URL = 'https://bukmark.it/docs/';
const AUTH_DOCS_URL = 'https://bukmark.it/docs/install/#authentication-warning';

interface Status {
  kind: 'reading' | 'importing' | 'done' | 'error';
  message: string;
}

export function SidebarMenu() {
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
      if (parsed.items.length === 0) {
        setStatus({ kind: 'error', message: 'No web links in that file.' });
        return;
      }

      setStatus({ kind: 'importing', message: `Importing 0 of ${parsed.items.length}…` });
      const result = await importLinks.mutateAsync({
        items: parsed.items,
        onProgress: (done, total) =>
          setStatus({ kind: 'importing', message: `Importing ${done} of ${total}…` }),
      });

      const parts = [`${result.created} added`];
      if (result.updated > 0) parts.push(`${result.updated} already here`);
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
    <div className={styles.wrap}>
      <input
        ref={fileInput}
        type="file"
        accept=".html,.htm,.json,text/html,application/json"
        className={styles.file}
        onChange={onFileChosen}
        data-testid="import-file"
        aria-label="Bookmarks file to import"
      />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className={styles.trigger}>
            Settings
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={styles.menu}
            side="top"
            align="start"
            sideOffset={6}
            collisionPadding={8}
          >
            <DropdownMenu.Item
              className={styles.menuItem}
              disabled={importLinks.isPending}
              onSelect={() => fileInput.current?.click()}
            >
              Import bookmarks…
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={styles.separator} />
            <DropdownMenu.Item asChild>
              <a className={styles.menuItem} href={DOCS_URL} target="_blank" rel="noreferrer">
                Documentation
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={styles.separator} />
            {/* Stated plainly rather than implied by a missing sign-out: this
                instance has no accounts and no auth on any route. */}
            <p className={styles.note}>
              No account. This instance is{' '}
              <a href={AUTH_DOCS_URL} target="_blank" rel="noreferrer">
                unauthenticated
              </a>
              .
            </p>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {status ? (
        <p
          className={status.kind === 'error' ? styles.statusError : styles.status}
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
