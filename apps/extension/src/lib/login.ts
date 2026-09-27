import { ensureHostPermission, originPatternFor } from './permissions';
import { normalizeBaseUrl, saveSettings } from './settings';

export interface LoginRequest {
  type: 'login';
  baseUrl: string;
}

export type LoginResult = { ok: true } | { ok: false; error: string };

/** chrome.storage.session key: a login error for the next popup to show. */
export const LAST_AUTH_ERROR = 'lastAuthError';

/**
 * Popup and options page both log in through here, straight from the Log in
 * click. Chrome shows the host permission prompt only during that click's user
 * gesture, so the prompt comes before anything else is awaited. The flow runs
 * in the background worker: the popup is destroyed as soon as the bukmark
 * window takes focus, and a flow started there would die with it.
 */
export async function requestLogin(rawUrl: string): Promise<LoginResult> {
  const baseUrl = normalizeBaseUrl(rawUrl);
  if (!originPatternFor(baseUrl)) {
    return { ok: false, error: 'Enter the server address, starting with http:// or https://' };
  }
  if (!(await ensureHostPermission(baseUrl))) {
    return { ok: false, error: 'Not logged in — access to that address was declined.' };
  }
  // A token only counts for the configured server, so the server has to be
  // saved before the token arrives or the login would not take.
  await saveSettings({ baseUrl });

  const message: LoginRequest = { type: 'login', baseUrl };
  const result: LoginResult =
    (await chrome.runtime.sendMessage<LoginRequest, LoginResult | undefined>(message)) ??
    { ok: false, error: 'Login failed.' };
  // The caller shows this error now; the next popup should not repeat it.
  if (!result.ok) await chrome.storage.session.remove(LAST_AUTH_ERROR);
  return result;
}
