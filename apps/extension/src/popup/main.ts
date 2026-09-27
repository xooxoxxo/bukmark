import { listHubs, saveLink } from '../lib/api';
import { AuthRequiredError, authFor, type Auth } from '../lib/auth';
import { LAST_AUTH_ERROR, requestLogin } from '../lib/login';
import { loadSettings } from '../lib/settings';
import { outcomeMessage } from './outcome';

const SESSION_ENDED = 'Your session ended — log in again.';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const loginFormEl = $<HTMLDivElement>('loginForm');
const serverInputEl = $<HTMLInputElement>('serverInput');
const loginButtonEl = $<HTMLButtonElement>('loginButton');
const loginStatusEl = $<HTMLParagraphElement>('loginStatus');
const saveFormEl = $<HTMLDivElement>('saveForm');
const titleEl = $<HTMLInputElement>('title');
const noteEl = $<HTMLTextAreaElement>('note');
const hubEl = $<HTMLSelectElement>('hub');
const saveEl = $<HTMLButtonElement>('save');
const statusEl = $<HTMLParagraphElement>('status');
const serverHostEl = $<HTMLSpanElement>('serverHost');
const openSettingsEl = $<HTMLButtonElement>('openSettings');

/** What Save sends, and with which login. Null while the login form shows. */
let capture: { auth: Auth; url: string } | null = null;

function setStatus(el: HTMLElement, text: string, isError = false): void {
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function showLoginForm(baseUrl: string, message = ''): void {
  capture = null;
  saveFormEl.hidden = true;
  loginFormEl.hidden = false;
  serverInputEl.value = baseUrl;
  loginButtonEl.disabled = false;
  setStatus(loginStatusEl, message, message !== '');
}

async function showSaveForm(auth: Auth): Promise<void> {
  loginFormEl.hidden = true;
  saveFormEl.hidden = false;
  serverHostEl.textContent = new URL(auth.server).host;

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

async function onLoginClick(): Promise<void> {
  loginButtonEl.disabled = true;
  setStatus(loginStatusEl, 'Logging in…');
  try {
    const result = await requestLogin(serverInputEl.value);
    if (result.ok) {
      window.location.reload();
      return;
    }
    setStatus(loginStatusEl, result.error, true);
  } catch {
    setStatus(loginStatusEl, 'Login failed.', true);
  }
  loginButtonEl.disabled = false;
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
  const auth = await authFor(baseUrl);
  if (auth) {
    await showSaveForm(auth);
    return;
  }
  // Left by a login whose popup closed before it finished.
  const { [LAST_AUTH_ERROR]: lastError } = await chrome.storage.session.get(LAST_AUTH_ERROR);
  showLoginForm(baseUrl, typeof lastError === 'string' ? lastError : '');
  if (lastError !== undefined) await chrome.storage.session.remove(LAST_AUTH_ERROR);
}

// Registered up front, not per form: a 401 can switch to the login form later.
loginButtonEl.addEventListener('click', () => void onLoginClick());
saveEl.addEventListener('click', () => void onSaveClick());
openSettingsEl.addEventListener('click', () => void chrome.runtime.openOptionsPage());

void init();
