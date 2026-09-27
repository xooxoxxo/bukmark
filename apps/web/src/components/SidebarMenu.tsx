import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useNavigate } from 'react-router-dom';
import { useRef, useState, type ChangeEvent } from 'react';
import { errorMessage } from '../api/client';
import { useImportLinks, useLogout } from '../api/queries';
import { UnsupportedFileError, parseImportFile } from '../import/parseBookmarks';
import { applyThemeChoice, readThemeChoice, type ThemeChoice } from '../theme';
import styles from './SidebarMenu.module.css';

const DOCS_URL = 'https://bukmark.it/docs/';

const THEMES: [ThemeChoice, string][] = [
  ['auto', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

interface Status {
  kind: 'reading' | 'importing' | 'done' | 'error';
  message: string;
}

export function SidebarMenu() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice);
  const importLinks = useImportLinks();
  const logout = useLogout();

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

  async function handleLogout() {
    try {
      await logout.mutateAsync();
    } catch (error) {
      const message = errorMessage(error);
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
            <DropdownMenu.Label className={styles.label}>Theme</DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              value={theme}
              onValueChange={(next) => {
                const choice = next as ThemeChoice;
                setTheme(choice);
                applyThemeChoice(choice);
              }}
            >
              {THEMES.map(([value, label]) => (
                <DropdownMenu.RadioItem
                  key={value}
                  className={styles.radioItem}
                  value={value}
                  // Radix closes the menu on select; keep it open so the
                  // choice can be compared against what is behind it.
                  onSelect={(event) => event.preventDefault()}
                >
                  <span className={styles.radioMark} aria-hidden="true">
                    <DropdownMenu.ItemIndicator>&#x2713;</DropdownMenu.ItemIndicator>
                  </span>
                  {label}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className={styles.separator} />
            <DropdownMenu.Item
              className={styles.menuItem}
              onSelect={() => navigate('/settings/tokens')}
            >
              Access tokens
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={styles.menuItem}
              disabled={logout.isPending}
              onSelect={() => handleLogout()}
            >
              {logout.isPending ? 'Logging out…' : 'Log out'}
            </DropdownMenu.Item>
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
