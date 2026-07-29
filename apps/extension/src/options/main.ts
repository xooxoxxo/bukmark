import { runBackfill, runImport } from '../lib/api';
import { flattenBookmarks, type BookmarkNode } from '../lib/bookmarks';
import { loadSettings, saveSettings } from '../lib/settings';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const baseUrlEl = $<HTMLInputElement>('baseUrl');
const saveUrlEl = $<HTMLButtonElement>('saveUrl');
const urlStatusEl = $<HTMLSpanElement>('urlStatus');
const importEl = $<HTMLButtonElement>('import');
const progressEl = $<HTMLProgressElement>('progress');
const importStatusEl = $<HTMLDivElement>('importStatus');

async function init(): Promise<void> {
  const settings = await loadSettings();
  baseUrlEl.value = settings.baseUrl;

  saveUrlEl.addEventListener('click', async () => {
    await saveSettings({ baseUrl: baseUrlEl.value });
    const reloaded = await loadSettings();
    baseUrlEl.value = reloaded.baseUrl;
    urlStatusEl.textContent = 'Saved';
    setTimeout(() => { urlStatusEl.textContent = ''; }, 1500);
  });

  importEl.addEventListener('click', async () => {
    importEl.disabled = true;
    progressEl.hidden = false;
    try {
      const { baseUrl } = await loadSettings();
      const tree = (await chrome.bookmarks.getTree()) as unknown as BookmarkNode[];
      const flat = flattenBookmarks(tree);
      if (flat.length === 0) {
        importStatusEl.textContent = 'No bookmarks found.';
        return;
      }

      progressEl.max = flat.length;
      importStatusEl.textContent = `Importing ${flat.length} bookmarks…`;
      const totals = await runImport(baseUrl, flat, (p) => { progressEl.value = p.done; });

      const summary =
        `${totals.created} added, ${totals.updated} already known` +
        (totals.skippedDeleted > 0 ? `, ${totals.skippedDeleted} skipped (deleted here before)` : '') +
        (totals.invalid > 0 ? `, ${totals.invalid} unusable` : '');

      // Preview images are fetched afterwards so the import itself stays fast.
      importStatusEl.textContent = `${summary}. Fetching preview images…`;
      progressEl.removeAttribute('value');
      const done = await runBackfill(baseUrl, (remaining) => {
        importStatusEl.textContent = `${summary}. Preview images: ${remaining} to go…`;
      });
      importStatusEl.textContent = `${summary}. Preview images fetched for ${done}.`;
    } catch (err) {
      importStatusEl.textContent = `Import failed: ${err instanceof Error ? err.message : 'unknown error'}`;
    } finally {
      progressEl.hidden = true;
      importEl.disabled = false;
    }
  });
}

void init();
