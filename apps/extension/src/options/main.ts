import { runBackfill, runImport } from '../lib/api';
import { AuthRequiredError, authFor, loadAuth, logout, type Auth } from '../lib/auth';
import { flattenBookmarks, type BookmarkNode } from '../lib/bookmarks';
import {
  FINISH_IN_WINDOW,
  LAST_AUTH_ERROR,
  SERVER_TO_GRANT,
  requestLogin,
  resumeLogin,
  useAccessToken,
  type LoginResult,
} from '../lib/login';
import { allowBookmarkImport, canImportBookmarks, ensureHostPermission, isSafari, originPatternFor } from '../lib/permissions';
import { changesSettings, loadSettings, normalizeBaseUrl, saveSettings } from '../lib/settings';
import { assignedShortcut, canOpenShortcutSettings, openShortcutSettings } from '../lib/shortcut';
import {
  SYNC_KEY,
  loadSyncState,
  syncedLinkCount,
  type SyncReply,
  type SyncRequest,
  type SyncState,
} from '../lib/sync';

const UNREACHABLE =
  "Logged out here. The server could not be reached — revoke 'bukmark capture' under Access tokens in the web app.";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const baseUrlEl = $<HTMLInputElement>('baseUrl');
const saveUrlEl = $<HTMLButtonElement>('saveUrl');
const urlStatusEl = $<HTMLSpanElement>('urlStatus');
const accountEl = $<HTMLParagraphElement>('account');
const loginEl = $<HTMLButtonElement>('login');
const logoutEl = $<HTMLButtonElement>('logout');
const showTokenEl = $<HTMLButtonElement>('showToken');
const tokenFormEl = $<HTMLDivElement>('tokenForm');
const tokenInputEl = $<HTMLInputElement>('tokenInput');
const useTokenEl = $<HTMLButtonElement>('useToken');
const authStatusEl = $<HTMLParagraphElement>('authStatus');
const importSectionEl = $<HTMLElement>('importSection');
const importEl = $<HTMLButtonElement>('import');
const importHintEl = $<HTMLParagraphElement>('importHint');
const progressEl = $<HTMLProgressElement>('progress');
const importStatusEl = $<HTMLParagraphElement>('importStatus');
const importElsewhereEl = $<HTMLElement>('importElsewhere');
const webAppEl = $<HTMLAnchorElement>('webApp');
const syncSectionEl = $<HTMLElement>('syncSection');
const syncToggleEl = $<HTMLInputElement>('syncToggle');
const syncHintEl = $<HTMLParagraphElement>('syncHint');
const syncInfoEl = $<HTMLParagraphElement>('syncInfo');
const syncNowEl = $<HTMLButtonElement>('syncNow');
const syncStatusEl = $<HTMLParagraphElement>('syncStatus');
const shortcutSectionEl = $<HTMLElement>('shortcutSection');
const shortcutSetEl = $<HTMLParagraphElement>('shortcutSet');
const shortcutKeyEl = $<HTMLElement>('shortcutKey');
const shortcutUnsetEl = $<HTMLParagraphElement>('shortcutUnset');
const changeShortcutEl = $<HTMLButtonElement>('changeShortcut');
const shortcutStatusEl = $<HTMLParagraphElement>('shortcutStatus');
const shortcutWhereEl = $<HTMLParagraphElement>('shortcutWhere');
const welcomeEl = $<HTMLElement>('welcome');
const stepLoginEl = $<HTMLLIElement>('stepLogin');
const welcomeDoneEl = $<HTMLParagraphElement>('welcomeDone');
const welcomeShortcutEl = $<HTMLSpanElement>('welcomeShortcut');
const welcomeKeyEl = $<HTMLElement>('welcomeKey');

/** Opened by the background on first install (WELCOME_PAGE): the setup steps sit on top. */
const welcome = new URLSearchParams(globalThis.location?.search ?? '').has('welcome');

let importing = false;
/** A sync action this page asked for is running in the background. */
let syncing = false;
/** The stored sync error last shown, so that a later pull that works can take it away. */
let shownSyncError: string | null = null;
/** A login this page started or found runs in its own tab; its end arrives through storage. */
let awaitingTab = false;

function setStatus(el: HTMLElement, text: string, isError = false): void {
  el.textContent = text;
  el.classList.toggle('error', isError);
}

const failed = (error: string) => (): LoginResult => ({ ok: false, error });

function showLoginResult(result: LoginResult): void {
  awaitingTab = result.ok && result.pending === true;
  setStatus(authStatusEl, result.ok ? (awaitingTab ? FINISH_IN_WINDOW : '') : result.error, !result.ok);
}

/** The background failed a login this page waits on: said here, and not again in the next popup. */
async function showTabLoginError(error: string): Promise<void> {
  awaitingTab = false;
  setStatus(authStatusEl, error, true);
  await chrome.storage.session.remove(LAST_AUTH_ERROR);
}

/** Shows whether the saved server is logged in. Reads storage afresh every time. */
async function render(): Promise<void> {
  const { baseUrl } = await loadSettings();
  const auth = await authFor(baseUrl);
  accountEl.hidden = !auth;
  accountEl.textContent = auth ? `Signed in to ${new URL(auth.server).host} as ${auth.name}` : '';
  loginEl.hidden = !!auth;
  logoutEl.hidden = !auth;
  if (auth) tokenFormEl.hidden = true;
  showTokenEl.hidden = !!auth || !tokenFormEl.hidden;
  importEl.disabled = !auth || importing;
  importHintEl.hidden = !!auth;
  // Safari and Firefox for Android have no bookmarks API; the web app imports
  // an exported file instead.
  const importable = await canImportBookmarks();
  importSectionEl.hidden = !importable;
  importElsewhereEl.hidden = importable;
  webAppEl.href = `${auth?.server ?? baseUrl}/`;
  welcomeEl.hidden = !welcome;
  stepLoginEl.classList.toggle('done', !!auth);
  welcomeDoneEl.hidden = !auth;
  welcomeDoneEl.textContent = auth
    ? `Signed in to ${new URL(auth.server).host} — you're set. Save any page with the bukmark button.`
    : '';
  await renderSync(importable, auth);
}

function syncSummary(state: SyncState): string {
  const n = syncedLinkCount(state);
  const when = state.lastSync === null
    ? 'Not synced yet'
    : `Last synced ${new Date(state.lastSync).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
  const waiting = state.queue.length === 0
    ? ''
    : `, ${state.queue.length} ${state.queue.length === 1 ? 'change' : 'changes'} waiting to be sent`;
  return `${when} · ${n} ${n === 1 ? 'link' : 'links'} in the bukmark folder${waiting}.`;
}

/** The sync section, from the stored state. Hidden where the browser has no bookmarks to sync. */
async function renderSync(importable: boolean, auth: Auth | null): Promise<void> {
  syncSectionEl.hidden = !importable;
  const state = await loadSyncState();
  const on = !!state?.enabled && state.server === auth?.server;
  syncToggleEl.checked = on;
  syncToggleEl.disabled = !auth || syncing;
  syncHintEl.hidden = !!auth;
  syncInfoEl.hidden = !on;
  syncInfoEl.textContent = on && state ? syncSummary(state) : '';
  syncNowEl.hidden = !on;
  syncNowEl.disabled = syncing;
  if (syncing) return;
  const error = state?.error ?? null;
  if (error) setStatus(syncStatusEl, error, true);
  else if (shownSyncError !== null && syncStatusEl.textContent === shownSyncError) setStatus(syncStatusEl, '');
  shownSyncError = error;
}

/** Sync runs in the background, where the bookmark events arrive. */
async function askSync(action: SyncRequest['action'], working: string): Promise<void> {
  syncing = true;
  syncToggleEl.disabled = true;
  syncNowEl.disabled = true;
  setStatus(syncStatusEl, working);
  const message: SyncRequest = { type: 'sync', action };
  const reply = (await chrome.runtime.sendMessage<SyncRequest, SyncReply | undefined>(message).catch(() => undefined))
    ?? { ok: false, error: 'Sync did not answer — try again.' };
  syncing = false;
  setStatus(syncStatusEl, reply.ok ? '' : reply.error, !reply.ok);
  await render();
}

async function showSavedUrl(): Promise<void> {
  baseUrlEl.value = (await loadSettings()).baseUrl;
}

/** A server Firefox's popup could not get access to: the prompt shows here. */
async function takeServerToGrant(): Promise<void> {
  const { [SERVER_TO_GRANT]: server } = await chrome.storage.session.get(SERVER_TO_GRANT);
  if (typeof server !== 'string') return;
  await chrome.storage.session.remove(SERVER_TO_GRANT);
  baseUrlEl.value = server;
  setStatus(authStatusEl, `Log in here to let Firefox reach ${new URL(server).host}, or use an access token.`);
}

/** The key the browser assigned; the section is hidden where there are no shortcuts. */
async function showShortcut(): Promise<void> {
  const key = await assignedShortcut();
  shortcutSectionEl.hidden = key === null;
  shortcutKeyEl.textContent = key ?? '';
  shortcutSetEl.hidden = !key;
  shortcutUnsetEl.hidden = key !== '';
  changeShortcutEl.hidden = !canOpenShortcutSettings();
  // Named only in Safari: stores reject a listing that points at another browser.
  if (isSafari()) shortcutWhereEl.textContent = 'Change it in Safari under Settings › Extensions.';
  welcomeShortcutEl.hidden = !key;
  welcomeKeyEl.textContent = key ?? '';
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
  showLoginResult(await requestLogin(baseUrlEl.value).catch(failed('Login failed.')));
  loginEl.disabled = false;
  await render();
});

showTokenEl.addEventListener('click', () => {
  showTokenEl.hidden = true;
  tokenFormEl.hidden = false;
  tokenInputEl.focus();
});

useTokenEl.addEventListener('click', async () => {
  useTokenEl.disabled = true;
  setStatus(authStatusEl, 'Checking the token…');
  const result = await useAccessToken(baseUrlEl.value, tokenInputEl.value).catch(failed('Could not use that token.'));
  if (result.ok) tokenInputEl.value = '';
  setStatus(authStatusEl, result.ok ? '' : result.error, !result.ok);
  useTokenEl.disabled = false;
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
  // Browsers ask for this during the click only, before anything else is awaited.
  if (!(await allowBookmarkImport())) {
    setStatus(importStatusEl, 'Not imported — access to your bookmarks was declined.', true);
    return;
  }
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

syncToggleEl.addEventListener('click', async () => {
  if (!syncToggleEl.checked) {
    await askSync('disable', '');
    return;
  }
  // Like Import: asked for during the click, before anything else is awaited.
  if (!(await allowBookmarkImport())) {
    syncToggleEl.checked = false;
    setStatus(syncStatusEl, 'Not turned on — access to your bookmarks was declined.', true);
    return;
  }
  await askSync('enable', 'Filling the bukmark folder…');
});

syncNowEl.addEventListener('click', () => void askSync('pull', 'Syncing…'));

changeShortcutEl.addEventListener('click', () => {
  setStatus(shortcutStatusEl, '');
  openShortcutSettings().catch(() => {
    setStatus(shortcutStatusEl, "Couldn't open the shortcut settings — open your browser's extensions page instead.", true);
  });
});

// Logins finish in the background worker, often started from the popup, and
// the popup's Log in saves the server too.
chrome.storage.onChanged.addListener((changes, area) => {
  const settingsChanged = changesSettings(changes, area);
  if (settingsChanged) void showSavedUrl();
  const authChanged = area === 'local' && 'auth' in changes;
  const syncChanged = area === 'local' && SYNC_KEY in changes;
  if (settingsChanged || authChanged || syncChanged) void render();
  if (area === 'session' && SERVER_TO_GRANT in changes) void takeServerToGrant();
  if (!awaitingTab) return;
  const error: unknown = area === 'session' ? changes[LAST_AUTH_ERROR]?.newValue : undefined;
  if (typeof error === 'string') void showTabLoginError(error);
  else if (authChanged) showLoginResult({ ok: true });
});

async function init(): Promise<void> {
  await showSavedUrl();
  await takeServerToGrant();
  const resumed = await resumeLogin();
  if (resumed) showLoginResult(resumed);
  await render();
  await showShortcut();
}

void init();
