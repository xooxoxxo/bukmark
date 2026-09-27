import { runBackfill, runImport } from '../lib/api';
import { AuthRequiredError, authFor, loadAuth, logout } from '../lib/auth';
import { flattenBookmarks, type BookmarkNode } from '../lib/bookmarks';
import { requestLogin } from '../lib/login';
import { ensureHostPermission, originPatternFor } from '../lib/permissions';
import { loadSettings, normalizeBaseUrl, saveSettings } from '../lib/settings';

const UNREACHABLE =
  "Logged out here. The server could not be reached — revoke 'bukmark capture' under Access tokens in the web app.";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const baseUrlEl = $<HTMLInputElement>('baseUrl');
const saveUrlEl = $<HTMLButtonElement>('saveUrl');
const urlStatusEl = $<HTMLSpanElement>('urlStatus');
const accountEl = $<HTMLParagraphElement>('account');
const loginEl = $<HTMLButtonElement>('login');
const logoutEl = $<HTMLButtonElement>('logout');
const authStatusEl = $<HTMLParagraphElement>('authStatus');
const importEl = $<HTMLButtonElement>('import');
const importHintEl = $<HTMLParagraphElement>('importHint');
const progressEl = $<HTMLProgressElement>('progress');
const importStatusEl = $<HTMLParagraphElement>('importStatus');

let importing = false;

function setStatus(el: HTMLElement, text: string, isError = false): void {
  el.textContent = text;
  el.classList.toggle('error', isError);
}

/** Shows whether the saved server is logged in. Reads storage afresh every time. */
async function render(): Promise<void> {
  const { baseUrl } = await loadSettings();
  const auth = await authFor(baseUrl);
  accountEl.hidden = !auth;
  accountEl.textContent = auth ? `Signed in to ${new URL(auth.server).host} as ${auth.name}` : '';
  loginEl.hidden = !!auth;
  logoutEl.hidden = !auth;
  importEl.disabled = !auth || importing;
  importHintEl.hidden = !!auth;
}

async function showSavedUrl(): Promise<void> {
  baseUrlEl.value = (await loadSettings()).baseUrl;
}

saveUrlEl.addEventListener('click', async () => {
  const newUrl = normalizeBaseUrl(baseUrlEl.value);
  if (!originPatternFor(newUrl)) {
    setStatus(urlStatusEl, 'Not saved — enter an address starting with http:// or https://', true);
    return;
  }
  // Asked before anything else is awaited, while this click still counts as a
  // user gesture. A stored URL the extension may not reach is worse than no
  // change, and a declined prompt must leave the current login alone.
  if (!(await ensureHostPermission(newUrl))) {
    setStatus(urlStatusEl, 'Not saved — access to that address was declined', true);
    return;
  }
  saveUrlEl.disabled = true;
  setStatus(urlStatusEl, 'Saving…');
  try {
    const auth = await loadAuth();
    if (auth && auth.server !== newUrl) {
      const revoked = await logout(auth);
      setStatus(authStatusEl, revoked ? '' : UNREACHABLE, !revoked);
    }
    await saveSettings({ baseUrl: newUrl });
    baseUrlEl.value = newUrl;
    setStatus(urlStatusEl, 'Saved');
    setTimeout(() => { urlStatusEl.textContent = ''; }, 1500);
  } finally {
    saveUrlEl.disabled = false;
  }
  await render();
});

loginEl.addEventListener('click', async () => {
  loginEl.disabled = true;
  setStatus(authStatusEl, 'Logging in…');
  try {
    const result = await requestLogin(baseUrlEl.value);
    setStatus(authStatusEl, result.ok ? '' : result.error, !result.ok);
  } catch {
    setStatus(authStatusEl, 'Login failed.', true);
  } finally {
    loginEl.disabled = false;
  }
  await render();
});

logoutEl.addEventListener('click', async () => {
  logoutEl.disabled = true;
  const auth = await loadAuth();
  const revoked = !auth || (await logout(auth));
  setStatus(authStatusEl, revoked ? '' : UNREACHABLE, !revoked);
  logoutEl.disabled = false;
  await render();
});

importEl.addEventListener('click', async () => {
  importing = true;
  importEl.disabled = true;
  progressEl.hidden = false;
  try {
    const { baseUrl } = await loadSettings();
    const auth = await authFor(baseUrl);
    if (!auth) {
      setStatus(importStatusEl, 'Log in to import.', true);
      return;
    }

    const tree = (await chrome.bookmarks.getTree()) as unknown as BookmarkNode[];
    const flat = flattenBookmarks(tree);
    if (flat.length === 0) {
      setStatus(importStatusEl, 'No bookmarks found.');
      return;
    }

    progressEl.max = flat.length;
    setStatus(importStatusEl, `Importing ${flat.length} bookmarks…`);
    const totals = await runImport(auth, flat, (p) => { progressEl.value = p.done; });

    const summary =
      `${totals.created} added, ${totals.updated} already known` +
      (totals.skippedDeleted > 0 ? `, ${totals.skippedDeleted} skipped (deleted here before)` : '') +
      (totals.invalid > 0 ? `, ${totals.invalid} unusable` : '');

    // Preview images are fetched afterwards so the import itself stays fast.
    setStatus(importStatusEl, `${summary}. Fetching preview images…`);
    progressEl.removeAttribute('value');
    const done = await runBackfill(auth, (remaining) => {
      setStatus(importStatusEl, `${summary}. Preview images: ${remaining} to go…`);
    });
    setStatus(importStatusEl, `${summary}. Preview images fetched for ${done}.`);
  } catch (err) {
    setStatus(
      importStatusEl,
      err instanceof AuthRequiredError
        ? 'Your session ended — log in again.'
        : `Import failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      true,
    );
  } finally {
    importing = false;
    progressEl.hidden = true;
    await render();
  }
});

// Logins finish in the background worker, often started from the popup, and
// the popup's Log in saves the server too.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'baseUrl' in changes) void showSavedUrl();
  if ((area === 'local' && 'auth' in changes) || (area === 'sync' && 'baseUrl' in changes)) {
    void render();
  }
});

async function init(): Promise<void> {
  await showSavedUrl();
  await render();
}

void init();
