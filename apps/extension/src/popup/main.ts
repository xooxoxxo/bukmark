import { listHubs, lookupLink, saveLink } from '../lib/api';
import { AuthRequiredError, authFor, type Auth } from '../lib/auth';
import {
  FINISH_IN_WINDOW,
  LAST_AUTH_ERROR,
  requestLogin,
  resumeLogin,
  useAccessToken,
  type LoginResult,
} from '../lib/login';
import { popupHostAccess } from '../lib/permissions';
import { loadSettings } from '../lib/settings';
import { LAST_SAVE_ERROR } from '../lib/shortcut';
import { isWebPage } from '../lib/settings';
import { knownMessage, outcomeMessage } from './outcome';

const SESSION_ENDED = 'Your session ended — log in again.';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const loginFormEl = $<HTMLDivElement>('loginForm');
const serverInputEl = $<HTMLInputElement>('serverInput');
const loginButtonEl = $<HTMLButtonElement>('loginButton');
const showTokenEl = $<HTMLButtonElement>('showToken');
const tokenFormEl = $<HTMLDivElement>('tokenForm');
const tokenInputEl = $<HTMLInputElement>('tokenInput');
const useTokenEl = $<HTMLButtonElement>('useToken');
const loginStatusEl = $<HTMLParagraphElement>('loginStatus');
const saveFormEl = $<HTMLDivElement>('saveForm');
const titleEl = $<HTMLInputElement>('title');
const noteEl = $<HTMLTextAreaElement>('note');
const hubEl = $<HTMLSelectElement>('hub');
const saveEl = $<HTMLButtonElement>('save');
const statusEl = $<HTMLParagraphElement>('status');
const knownEl = $<HTMLParagraphElement>('known');

/** What Save sends, and with which login. Null while the login form shows. */
let capture: { auth: Auth; url: string } | null = null;

/** A tab login this popup is waiting on: it ends in the background, not in a reply. */
let awaitingTab = false;

/** A window login announces itself twice, by its reply and by storage: reload once. */
let reloading = false;
function reload(): void {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

function setStatus(el: HTMLElement, text: string, isError = false): void {
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function lockLogin(locked: boolean): void {
  loginButtonEl.disabled = locked;
  useTokenEl.disabled = locked;
}

function showLoginForm(baseUrl: string, message = '', isError = message !== ''): void {
  capture = null;
  saveFormEl.hidden = true;
  loginFormEl.hidden = false;
  serverInputEl.value = baseUrl;
  lockLogin(false);
  setStatus(loginStatusEl, message, isError);
}

async function showSaveForm(auth: Auth): Promise<void> {
  loginFormEl.hidden = true;
  saveFormEl.hidden = false;

  // On Safari the shortcut's badge is all that told of this failure.
  const { [LAST_SAVE_ERROR]: saveError } = await chrome.storage.session.get(LAST_SAVE_ERROR);
  if (typeof saveError === 'string') {
    setStatus(statusEl, saveError, true);
    await chrome.storage.session.remove(LAST_SAVE_ERROR);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    setStatus(statusEl, 'No page to save', true);
    saveEl.disabled = true;
    return;
  }
  // Only web pages: a file:// address, a browser page or the like is never sent,
  // not even to ask whether it is saved.
  if (!isWebPage(tab.url)) {
    setStatus(statusEl, 'Only web pages (http or https) can be saved.', true);
    saveEl.disabled = true;
    return;
  }
  titleEl.value = tab.title ?? '';
  capture = { auth, url: tab.url };

  // Failures here must not block saving — the hub dropdown and what bukmark
  // already knows are conveniences, the capture is the point.
  const [hubs, known] = await Promise.allSettled([listHubs(auth), lookupLink(auth, tab.url)]);
  if ([hubs, known].some((r) => r.status === 'rejected' && r.reason instanceof AuthRequiredError)) {
    showLoginForm(auth.server, SESSION_ENDED);
    return;
  }
  if (hubs.status === 'fulfilled') {
    for (const hub of hubs.value) {
      const opt = document.createElement('option');
      opt.value = hub.name;
      opt.textContent = hub.name;
      hubEl.append(opt);
    }
  } else {
    setStatus(statusEl, 'Could not load hubs — saving still works');
  }
  if (known.status === 'fulfilled') {
    const message = knownMessage(known.value);
    knownEl.textContent = message ?? '';
    knownEl.hidden = message === null;
    // Saving again leaves a saved page where it is filed.
    const filedIn = known.value.saved?.hubs[0];
    if (filedIn && hubs.status === 'fulfilled' && hubs.value.some((h) => h.name === filedIn)) hubEl.value = filedIn;
  }
}

function showResult(result: LoginResult): void {
  if (result.ok && !result.pending) {
    reload();
    return;
  }
  awaitingTab = result.ok;
  setStatus(loginStatusEl, result.ok ? FINISH_IN_WINDOW : result.error, !result.ok);
  lockLogin(false);
}

async function showTabLoginError(error: string): Promise<void> {
  awaitingTab = false;
  setStatus(loginStatusEl, error, true);
  await chrome.storage.session.remove(LAST_AUTH_ERROR);
}

const failed = (error: string) => (): LoginResult => ({ ok: false, error });

// Both start the request before anything is awaited: it asks for host access,
// which the browser allows only during the click.
async function onLoginClick(): Promise<void> {
  lockLogin(true);
  setStatus(loginStatusEl, 'Logging in…');
  showResult(await requestLogin(serverInputEl.value, popupHostAccess).catch(failed('Login failed.')));
}

async function onUseTokenClick(): Promise<void> {
  lockLogin(true);
  setStatus(loginStatusEl, 'Checking the token…');
  showResult(
    await useAccessToken(serverInputEl.value, tokenInputEl.value, popupHostAccess)
      .catch(failed('Could not use that token.')),
  );
}

async function onSaveClick(): Promise<void> {
  if (!capture) return;
  const { auth, url } = capture;
  saveEl.disabled = true;
  setStatus(statusEl, 'Saving…');
  try {
    const res = await saveLink(auth, {
      url,
      title: titleEl.value,
      note: noteEl.value,
      hub: hubEl.value,
    });
    setStatus(statusEl, outcomeMessage(res));
    setTimeout(() => window.close(), 700);
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      showLoginForm(auth.server, SESSION_ENDED);
      return;
    }
    setStatus(statusEl, err instanceof Error ? err.message : 'Save failed', true);
    saveEl.disabled = false;
  }
}

async function init(): Promise<void> {
  const { baseUrl } = await loadSettings();
  // First, so that a login whose reply arrived unseen is finished before the form is chosen.
  const resumed = await resumeLogin();
  const auth = await authFor(baseUrl);
  if (auth) {
    await showSaveForm(auth);
    return;
  }
  if (resumed && !resumed.ok) {
    showLoginForm(baseUrl, resumed.error);
    return;
  }
  if (resumed?.pending) {
    showLoginForm(baseUrl, FINISH_IN_WINDOW, false);
    awaitingTab = true;
    return;
  }
  // Left by a login whose popup closed before it finished, or by the keyboard shortcut.
  const { [LAST_AUTH_ERROR]: lastError } = await chrome.storage.session.get(LAST_AUTH_ERROR);
  showLoginForm(baseUrl, typeof lastError === 'string' ? lastError : '');
  if (lastError !== undefined) await chrome.storage.session.remove(LAST_AUTH_ERROR);
}

// A tab login ends in the background after this popup got its "pending"
// reply, and a login from the options page ends there too: either way this
// popup learns of it only from storage.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.auth?.newValue && saveFormEl.hidden) {
    reload();
    return;
  }
  const error: unknown = area === 'session' ? changes[LAST_AUTH_ERROR]?.newValue : undefined;
  if (awaitingTab && typeof error === 'string') void showTabLoginError(error);
});

// Registered up front, not per form: a 401 can switch to the login form later.
loginButtonEl.addEventListener('click', () => void onLoginClick());
showTokenEl.addEventListener('click', () => {
  showTokenEl.hidden = true;
  tokenFormEl.hidden = false;
  tokenInputEl.focus();
});
useTokenEl.addEventListener('click', () => void onUseTokenClick());
saveEl.addEventListener('click', () => void onSaveClick());

void init();
