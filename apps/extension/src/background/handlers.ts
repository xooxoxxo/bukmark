import { saveLink } from '../lib/api';
import { AuthRequiredError, LoginError, authFor, loginFlow } from '../lib/auth';
import { LAST_AUTH_ERROR, type LoginResult } from '../lib/login';
import { loadSettings } from '../lib/settings';

const BADGE_MS = 1500;
const OK_COLOR = '#2d7d46';
const ERROR_COLOR = '#c0392b';
// Matches action.default_title in manifest.json.
const SAVE_TITLE = 'Save to bukmark';
const LOGGED_OUT_TITLE = 'Log in to bukmark first';

async function flashBadge(text: string, color: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => { void chrome.action.setBadgeText({ text: '' }); }, BADGE_MS);
}

async function flagLoggedOut(): Promise<void> {
  await chrome.action.setTitle({ title: LOGGED_OUT_TITLE });
  await flashBadge('!', ERROR_COLOR);
}

/** Keyboard save. Logged out, it makes no network call at all. */
export async function saveActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  try {
    const { baseUrl } = await loadSettings();
    const auth = await authFor(baseUrl);
    if (!auth) {
      await flagLoggedOut();
      return;
    }
    // No note on this path: a capture without a note beats no capture. Use
    // the popup when the reason is worth recording.
    await saveLink(auth, { url: tab.url, title: tab.title ?? '' });
    await chrome.action.setTitle({ title: SAVE_TITLE });
    await flashBadge('✓', OK_COLOR);
  } catch (err) {
    if (err instanceof AuthRequiredError) await flagLoggedOut();
    else await flashBadge('!', ERROR_COLOR);
  }
}

let loginRunning = false;

/** Runs a login a page asked for. The reply reaches that page only if it is still open. */
export async function handleLogin(baseUrl: string): Promise<LoginResult> {
  // A second window would mint a second token, and only one could be kept.
  if (loginRunning) return { ok: false, error: 'A bukmark login window is already open.' };
  loginRunning = true;
  try {
    await loginFlow(baseUrl);
  } catch (err) {
    const error = err instanceof LoginError ? err.message : 'Login failed.';
    // The popup that asked is usually gone by now; the next one shows this.
    await chrome.storage.session.set({ [LAST_AUTH_ERROR]: error });
    return { ok: false, error };
  } finally {
    loginRunning = false;
  }
  await chrome.storage.session.remove(LAST_AUTH_ERROR);
  await chrome.action.setTitle({ title: SAVE_TITLE });
  await flashBadge('✓', OK_COLOR);
  return { ok: true };
}
