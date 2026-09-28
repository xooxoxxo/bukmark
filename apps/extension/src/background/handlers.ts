import { saveLink } from '../lib/api';
import {
  AuthRequiredError,
  IdentityUnsupportedError,
  LoginError,
  authFor,
  identityFlowAvailable,
  loginFlow,
} from '../lib/auth';
import { LAST_AUTH_ERROR, type LoginRequest, type LoginResult, type ResumeRequest } from '../lib/login';
import { loadSettings } from '../lib/settings';
import { LAST_SAVE_ERROR } from '../lib/shortcut';
import { resumeTabLogin, startTabLogin, tabLoginRemoved, tabLoginUpdated } from '../lib/tabLogin';

const BADGE_MS = 1500;
// Safari ignores the badge colour and iOS never shows the title, so each state
// has its own text, and the next popup says it in words.
const SAVED = { text: '✓', color: '#2d7d46' };
const FAILED = { text: '!', color: '#c0392b' };
const LOGGED_OUT = { text: '?', color: '#c0392b' };
// Matches action.default_title in manifest.ts.
const SAVE_TITLE = 'Save to bukmark';
const LOGGED_OUT_TITLE = 'Log in to bukmark first';
const LOGGED_OUT_MESSAGE = 'Log in first — the keyboard shortcut saves nothing while you are logged out.';
const SESSION_ENDED = 'Your session ended — log in again.';

async function flashBadge({ text, color }: { text: string; color: string }): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => { void chrome.action.setBadgeText({ text: '' }); }, BADGE_MS);
}

async function flagLoggedOut(why: string): Promise<void> {
  await chrome.action.setTitle({ title: LOGGED_OUT_TITLE });
  await chrome.storage.session.set({ [LAST_AUTH_ERROR]: why });
  await flashBadge(LOGGED_OUT);
}

/** Keyboard save. Logged out, it makes no network call at all. */
export async function saveActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  try {
    const { baseUrl } = await loadSettings();
    const auth = await authFor(baseUrl);
    if (!auth) {
      await flagLoggedOut(LOGGED_OUT_MESSAGE);
      return;
    }
    // No note on this path: a capture without a note beats no capture. Use
    // the popup when the reason is worth recording.
    await saveLink(auth, { url: tab.url, title: tab.title ?? '' });
    await chrome.action.setTitle({ title: SAVE_TITLE });
    await chrome.storage.session.remove(LAST_SAVE_ERROR);
    await flashBadge(SAVED);
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      await flagLoggedOut(SESSION_ENDED);
      return;
    }
    const reason = err instanceof Error ? err.message : 'unknown error';
    await chrome.storage.session.set({ [LAST_SAVE_ERROR]: `The keyboard shortcut couldn't save that page: ${reason}` });
    await flashBadge(FAILED);
  }
}

/**
 * What a login leaves behind when it ends: on success the badge, on failure
 * the reason, for the next popup — the page that asked is usually gone by then.
 */
async function report(result: LoginResult): Promise<LoginResult> {
  if (!result.ok) {
    await chrome.storage.session.set({ [LAST_AUTH_ERROR]: result.error });
  } else if (!result.pending) {
    await chrome.storage.session.remove(LAST_AUTH_ERROR);
    await chrome.action.setTitle({ title: SAVE_TITLE });
    await flashBadge(SAVED);
  }
  return result;
}

// The identity window holds this worker until it closes (the keepalive in
// loginFlow; Firefox waits on the flow itself), so memory can say whether one is
// open. A login in a tab keeps its own flag in storage.session (lib/tabLogin.ts).
let identityRunning = false;

/** True when the identity window logged in; false when this browser has to log in in a tab. */
async function identityLogin(baseUrl: string): Promise<boolean> {
  if (!identityFlowAvailable()) return false;
  identityRunning = true;
  try {
    await loginFlow(baseUrl);
    return true;
  } catch (err) {
    if (err instanceof IdentityUnsupportedError) return false;
    throw err;
  } finally {
    identityRunning = false;
  }
}

/**
 * Runs a login a page asked for: in the browser's identity window where it
 * has one that works, else in a window or tab of its own, which answers
 * `pending` at once and finishes on that tab's events (listenForTabLogins).
 * The reply reaches the page only if it is still open.
 */
export async function handleLogin(baseUrl: string): Promise<LoginResult> {
  // A second window would mint a second token, and only one could be kept.
  if (identityRunning) return { ok: false, error: 'A bukmark login window is already open.' };
  try {
    if (await identityLogin(baseUrl)) return await report({ ok: true });
    return await report(await startTabLogin(baseUrl));
  } catch (err) {
    return report({ ok: false, error: err instanceof LoginError ? err.message : 'Login failed.' });
  }
}

/** A page opened while a login waits in its tab. Null when none does. */
async function handleResume(): Promise<LoginResult | null> {
  const result = await resumeTabLogin();
  return result && report(result);
}

/** The reply to a page's message, or undefined for a message this worker does not answer. */
export function handleMessage(message: unknown): Promise<LoginResult | null> | undefined {
  const m = message as Partial<LoginRequest> | Partial<ResumeRequest> | undefined;
  if (m?.type === 'login' && typeof m.baseUrl === 'string') return handleLogin(m.baseUrl);
  if (m?.type === 'resumeLogin') return handleResume();
  return undefined;
}

async function handleTabUpdated(tabId: number, url: string | undefined): Promise<void> {
  const result = await tabLoginUpdated(tabId, url);
  if (result) await report(result);
}

async function handleTabRemoved(tabId: number): Promise<void> {
  const result = await tabLoginRemoved(tabId);
  if (result) await report(result);
}

/** A login in a tab finishes on that tab's events. For the background script to call as it starts. */
export function listenForTabLogins(): void {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    void handleTabUpdated(tabId, changeInfo.url ?? tab.url);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void handleTabRemoved(tabId);
  });
}
