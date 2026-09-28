import { listHubs, saveLink } from '../lib/api';
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
import { LAST_SAVE_ERROR, assignedShortcut } from '../lib/shortcut';
import { outcomeMessage } from './outcome';

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
const serverHostEl = $<HTMLSpanElement>('serverHost');
const openSettingsEl = $<HTMLButtonElement>('openSettings');
const shortcutHintEl = $<HTMLParagraphElement>('shortcutHint');
const shortcutKeyEl = $<HTMLElement>('shortcutKey');

/** What Save sends, and with which login. Null while the login form shows. */
let capture: { auth: Auth; url: string } | null = null;

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

/** The key the browser assigned, if any. Firefox for Android has no shortcuts at all. */
async function showShortcut(): Promise<void> {
  const key = await assignedShortcut();
  shortcutKeyEl.textContent = key ?? '';
  shortcutHintEl.hidden = !key;
}

async function showSaveForm(auth: Auth): Promise<void> {
  loginFormEl.hidden = true;
  saveFormEl.hidden = false;
  serverHostEl.textContent = new URL(auth.server).host;
  void showShortcut();

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
  titleEl.value = tab.title ?? '';
  capture = { auth, url: tab.url };

  // A failure here must not block saving — the hub dropdown is a convenience,
  // the capture is the point.
  try {
    for (const hub of await listHubs(auth)) {
      const opt = document.createElement('option');
      opt.value = hub.name;
      opt.textContent = `${hub.name} (${hub.linkCount})`;
      hubEl.append(opt);
    }
  } catch (err) {
    if (err instanceof AuthRequiredError) showLoginForm(auth.server, SESSION_ENDED);
    else setStatus(statusEl, 'Could not load hubs — saving still works');
  }
}

function showResult(result: LoginResult): void {
  if (result.ok && !result.pending) {
    window.location.reload();
    return;
  }
  setStatus(loginStatusEl, result.ok ? FINISH_IN_WINDOW : result.error, !result.ok);
  lockLogin(false);
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
    return;
  }
  // Left by a login whose popup closed before it finished, or by the keyboard shortcut.
  const { [LAST_AUTH_ERROR]: lastError } = await chrome.storage.session.get(LAST_AUTH_ERROR);
  showLoginForm(baseUrl, typeof lastError === 'string' ? lastError : '');
  if (lastError !== undefined) await chrome.storage.session.remove(LAST_AUTH_ERROR);
}

// Registered up front, not per form: a 401 can switch to the login form later.
loginButtonEl.addEventListener('click', () => void onLoginClick());
showTokenEl.addEventListener('click', () => {
  showTokenEl.hidden = true;
  tokenFormEl.hidden = false;
  tokenInputEl.focus();
});
useTokenEl.addEventListener('click', () => void onUseTokenClick());
saveEl.addEventListener('click', () => void onSaveClick());
openSettingsEl.addEventListener('click', () => void chrome.runtime.openOptionsPage());

void init();
