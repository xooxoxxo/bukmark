import { LoginError, adopt, verifyToken } from './auth';
import { originPatternFor, pageHostAccess, type HostAccess } from './permissions';
import { normalizeBaseUrl, saveSettings } from './settings';
import { PENDING_LOGIN } from './tabLogin';

export interface LoginRequest {
  type: 'login';
  baseUrl: string;
}

/** Asks the background to look in on a login waiting in its own tab. */
export interface ResumeRequest {
  type: 'resumeLogin';
}

/** `pending`: the login opened a window or tab of its own and finishes there. */
export type LoginResult = { ok: true; pending?: true } | { ok: false; error: string };

/** Shown while a login waits in its own window or tab. */
export const FINISH_IN_WINDOW = 'Finish signing in in the bukmark window.';

/** chrome.storage.session key: a login error for the next popup to show. */
export const LAST_AUTH_ERROR = 'lastAuthError';

/** chrome.storage.session key: a server the popup could not get access to, for the options page to ask for. */
export const SERVER_TO_GRANT = 'serverToGrant';

type Access = (baseUrl: string) => Promise<HostAccess>;

/**
 * What every Log in and Use token click starts with: a usable address, then
 * host access, which has to be the click's first await (see permissions.ts).
 */
async function reachServer(rawUrl: string, access: Access): Promise<{ baseUrl: string } | { error: string }> {
  const baseUrl = normalizeBaseUrl(rawUrl);
  if (!originPatternFor(baseUrl)) return { error: 'Enter the server address, starting with http:// or https://' };
  const granted = await access(baseUrl);
  if (granted === 'declined') return { error: 'Not logged in — access to that address was declined.' };
  if (granted === 'ask-in-options') {
    await chrome.storage.session.set({ [SERVER_TO_GRANT]: baseUrl });
    await chrome.runtime.openOptionsPage();
    return { error: 'Firefox asks for access to a new server on the settings page — continue there.' };
  }
  return { baseUrl };
}

/**
 * Popup and options page both log in through here, straight from the Log in
 * click. The flow runs in the background worker: the popup is destroyed as
 * soon as the bukmark window takes focus, and a flow started there would die
 * with it.
 */
export async function requestLogin(rawUrl: string, access: Access = pageHostAccess): Promise<LoginResult> {
  const reached = await reachServer(rawUrl, access);
  if ('error' in reached) return { ok: false, error: reached.error };
  // A token only counts for the configured server, so the server has to be
  // saved before the token arrives or the login would not take.
  await saveSettings({ baseUrl: reached.baseUrl });

  const message: LoginRequest = { type: 'login', baseUrl: reached.baseUrl };
  const result: LoginResult =
    (await chrome.runtime.sendMessage<LoginRequest, LoginResult | undefined>(message)) ??
    { ok: false, error: 'Login failed.' };
  // The caller shows this error now; the next popup should not repeat it.
  if (!result.ok) await chrome.storage.session.remove(LAST_AUTH_ERROR);
  return result;
}

/**
 * On opening a page: how a login waiting in its own tab stands, or null when
 * none is. Its reply may have arrived while no background was listening, so the
 * background checks the tab, and finishes the login if it can.
 */
export async function resumeLogin(): Promise<LoginResult | null> {
  const { [PENDING_LOGIN]: pending } = await chrome.storage.session.get(PENDING_LOGIN);
  if (pending === undefined) return null;
  const message: ResumeRequest = { type: 'resumeLogin' };
  const result = await chrome.runtime
    .sendMessage<ResumeRequest, LoginResult | null | undefined>(message)
    .catch(() => null);
  // The caller shows this error now; the next popup should not repeat it.
  if (result && !result.ok) await chrome.storage.session.remove(LAST_AUTH_ERROR);
  return result ?? null;
}

/**
 * "Use an access token instead": a token created in the web app, for when a
 * login window or tab won't do. Checked with its server before anything is
 * stored, then kept exactly like a login's.
 */
export async function useAccessToken(
  rawUrl: string,
  rawToken: string,
  access: Access = pageHostAccess,
): Promise<LoginResult> {
  const token = rawToken.trim();
  // Before the prompt: nothing to ask access for without a token to check.
  if (token === '') return { ok: false, error: 'Paste an access token first.' };
  // It goes in a header, which cannot carry spaces or anything beyond ASCII.
  if (/[^\x21-\x7e]/.test(token)) {
    return { ok: false, error: "That doesn't look like an access token — copy it again from the web app." };
  }
  const reached = await reachServer(rawUrl, access);
  if ('error' in reached) return { ok: false, error: reached.error };

  try {
    const auth = await verifyToken(reached.baseUrl, token);
    await saveSettings({ baseUrl: auth.server });
    await adopt(auth);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof LoginError ? err.message : 'Could not use that token.' };
  }
}
