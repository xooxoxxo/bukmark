/**
 * Host access for a user-supplied server URL.
 *
 * The manifest grants only localhost up front. Everything else is requested at
 * runtime from `optional_host_permissions`, so the extension works against any
 * self-hosted address without a manifest edit — and so installing it does not
 * hand over access to every site you visit.
 */
import type { Manifest } from '../manifest';

/**
 * Match pattern for a URL's host, or null if it isn't usable. It carries no
 * port, so it covers every port on that host, in every browser. Only Chrome
 * matches a pattern with a port: Firefox never does (its test_MatchPattern.js
 * fails http://mozilla.org:8080 against `http://mozilla.org:8080/`), and
 * Safari rejects one outright ("No port is allowed in patterns",
 * WebCore/page/UserContentURLPattern.cpp).
 */
export function originPatternFor(baseUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(baseUrl.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // hostname drops the port, and keeps an IPv6 address in its brackets.
  return `${u.protocol}//${u.hostname}/*`;
}

/**
 * Resolves true when the extension may talk to this origin, asking if needed.
 *
 * MUST be the first thing a click handler awaits: Chrome shows the prompt only
 * during the click's user gesture, and Firefox refuses the request after any
 * earlier await — even for access granted long ago. When access is already
 * granted it resolves true without a prompt, so there is no need to check first.
 */
export function ensureHostPermission(baseUrl: string): Promise<boolean> {
  const pattern = originPatternFor(baseUrl);
  if (!pattern) return Promise.resolve(false);
  return chrome.permissions.request({ origins: [pattern] }).catch(() => false);
}

export type HostAccess = 'granted' | 'declined' | 'ask-in-options';

/** From a page that can show the prompt: the options page, or any browser's popup but Firefox's. */
export async function pageHostAccess(baseUrl: string): Promise<HostAccess> {
  return (await ensureHostPermission(baseUrl)) ? 'granted' : 'declined';
}

/** Only Firefox has runtime.getBrowserInfo. */
function isFirefox(): boolean {
  return typeof (chrome.runtime as { getBrowserInfo?: unknown }).getBrowserInfo === 'function';
}

/**
 * From the action popup. Firefox's popup cannot show the prompt properly (bug
 * 1798454 draws it behind the popup on Windows), so there the popup only
 * checks, and a new server is granted from the options page.
 */
export async function popupHostAccess(baseUrl: string): Promise<HostAccess> {
  if (!isFirefox()) return pageHostAccess(baseUrl);
  const pattern = originPatternFor(baseUrl);
  const granted = pattern ? await chrome.permissions.contains({ origins: [pattern] }).catch(() => false) : false;
  return granted ? 'granted' : 'ask-in-options';
}

/**
 * Firefox lists bookmarks as an optional data-collection permission
 * (manifest.ts), asked for when importing. Elsewhere there is nothing to ask.
 * Like the host prompt, it must be the click's first await.
 */
export function allowBookmarkSharing(): Promise<boolean> {
  const { browser_specific_settings: settings } = chrome.runtime.getManifest() as unknown as Manifest;
  if (!settings?.gecko?.data_collection_permissions.optional?.includes('bookmarksInfo')) {
    return Promise.resolve(true);
  }
  const request = { data_collection: ['bookmarksInfo'] } as chrome.permissions.Permissions;
  return chrome.permissions.request(request).catch(() => false);
}
