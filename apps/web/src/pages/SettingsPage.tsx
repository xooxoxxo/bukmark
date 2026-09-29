import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { buildExportUrl, type ExportFormat } from '../api/exportUrl';
import { useLogout } from '../api/queries';
import { ImportBookmarks } from '../components/ImportBookmarks';
import { DuplicatesFinder } from '../components/DuplicatesFinder';
import { DOCS_URL } from '../docs';
import {
  ACCENTS,
  BRAND_ACCENT,
  MIN_ACCENT_CONTRAST,
  PAPERS,
  applyAccent,
  applyThemeChoice,
  contrast,
  readAccent,
  readThemeChoice,
  type ThemeChoice,
} from '../theme';
import styles from './SettingsPage.module.css';

const THEMES: [ThemeChoice, string][] = [
  ['auto', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

const EXPORTS: [ExportFormat, string, string][] = [
  ['html', 'HTML', 'Imports into any browser.'],
  ['json', 'JSON', 'Everything bukmark knows about each link.'],
  ['csv', 'CSV', 'For a spreadsheet.'],
];

export function SettingsPage() {
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice);
  const [accent, setAccent] = useState(readAccent);
  const [logoutError, setLogoutError] = useState('');
  const [showDuplicates, setShowDuplicates] = useState(false);
  const logout = useLogout();

  const presets = new Set(ACCENTS.map(([hex]) => hex));
  const hardToRead =
    contrast(accent, PAPERS.light) < MIN_ACCENT_CONTRAST
      ? 'light'
      : contrast(accent, PAPERS.dark) < MIN_ACCENT_CONTRAST
        ? 'dark'
        : null;

  function chooseTheme(choice: ThemeChoice) {
    setTheme(choice);
    applyThemeChoice(choice);
  }

  function chooseAccent(hex: string) {
    applyAccent(hex);
    setAccent(readAccent());
  }

  async function handleLogout() {
    setLogoutError('');
    try {
      await logout.mutateAsync();
    } catch (error) {
      setLogoutError(errorMessage(error));
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.section} aria-labelledby="appearance">
        <h2 id="appearance" className={styles.heading}>Appearance</h2>
        <p className={styles.hint}>Saved in this browser only.</p>

        <fieldset className={styles.field}>
          <legend className={styles.label}>Theme</legend>
          <div className={styles.segmented}>
            {THEMES.map(([value, label]) => (
              <label key={value} className={styles.segment}>
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={theme === value}
                  onChange={() => chooseTheme(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.field}>
          <legend className={styles.label}>Accent colour</legend>
          <div className={styles.swatches}>
            {ACCENTS.map(([hex, name]) => (
              <label key={hex} className={styles.swatch} title={name}>
                <input
                  type="radio"
                  name="accent"
                  value={hex}
                  checked={accent === hex}
                  onChange={() => chooseAccent(hex)}
                  aria-label={name}
                />
                <span className={styles.chip} style={{ background: hex }} aria-hidden="true" />
              </label>
            ))}
            <label className={`${styles.swatch} ${styles.custom}`}>
              <input
                type="color"
                value={accent}
                onChange={(event) => chooseAccent(event.target.value)}
                aria-label="Custom colour"
                className={presets.has(accent) ? undefined : styles.customOn}
              />
              <span className={styles.customLabel}>Custom</span>
            </label>
          </div>
          {accent !== BRAND_ACCENT ? (
            <button type="button" className={styles.linkButton} onClick={() => chooseAccent(BRAND_ACCENT)}>
              Back to bukmark orange
            </button>
          ) : null}
          {hardToRead ? (
            <p className={styles.warning} role="status">
              This colour is hard to read on the {hardToRead} theme.
            </p>
          ) : null}
        </fieldset>
      </section>

      <section className={styles.section} aria-labelledby="import-export">
        <h2 id="import-export" className={styles.heading}>Import and export</h2>
        <div className={styles.field}>
          <p className={styles.label}>Import</p>
          <p className={styles.hint}>
            A bookmarks file from Chrome, Edge, Firefox or Safari (HTML), a CSV export from
            Raindrop, Pocket or Instapaper, or a bukmark JSON export. New links land unsorted.
          </p>
          <div>
            <ImportBookmarks
              buttonClass={styles.button}
              statusClass={styles.status}
              errorClass={styles.error}
            />
          </div>
        </div>
        <div className={styles.field}>
          <p className={styles.label}>Export</p>
          <p className={styles.hint}>
            Every active link, with its hubs. To export one hub or a search, use the menu on its
            title.
          </p>
          <ul className={styles.exports}>
            {EXPORTS.map(([format, label, what]) => (
              <li key={format}>
                <a className={styles.button} href={buildExportUrl({ format })} download>
                  Export {label}
                </a>
                <span className={styles.hint}>{what}</span>
              </li>
            ))}
            <li>
              <a className={styles.button} href={buildExportUrl({ format: 'json', status: 'all' })} download>
                Full backup
              </a>
              <span className={styles.hint}>JSON, archived links included.</span>
            </li>
          </ul>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="duplicates">
        <h2 id="duplicates" className={styles.heading}>Duplicates</h2>
        <div className={styles.field}>
          <p className={styles.hint}>
            The same page saved under two addresses: http and https, with and without a trailing
            slash, a mobile site or an AMP version. Merging keeps one link and moves the others'
            hubs onto it.
          </p>
          {showDuplicates ? (
            <DuplicatesFinder />
          ) : (
            <div>
              <button type="button" className={styles.button} onClick={() => setShowDuplicates(true)}>
                Find duplicates
              </button>
            </div>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="access">
        <h2 id="access" className={styles.heading}>Access</h2>
        <div className={styles.field}>
          <p className={styles.hint}>
            Tokens let the MCP server, scripts and an iOS Shortcut use this server.
          </p>
          <div>
            <Link className={styles.button} to="/settings/tokens">
              Access tokens
            </Link>
          </div>
        </div>
        <div className={styles.field}>
          <div className={styles.row}>
            <button
              type="button"
              className={styles.button}
              disabled={logout.isPending}
              onClick={() => void handleLogout()}
            >
              {logout.isPending ? 'Logging out…' : 'Log out'}
            </button>
            <a className={styles.linkButton} href={DOCS_URL} target="_blank" rel="noreferrer">
              Documentation
            </a>
          </div>
          {logoutError ? (
            <p className={styles.error} role="alert">
              {logoutError}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
