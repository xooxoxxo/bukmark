/**
 * Host access for a user-supplied server URL.
 *
 * manifest.json grants only localhost up front. Everything else is requested at
 * runtime from `optional_host_permissions`, so the extension works against any
 * self-hosted address without a manifest edit — and so installing it does not
 * hand over access to every site you visit.
 */

/** Chrome match pattern for a URL's origin, or null if it isn't usable. */
export function originPatternFor(baseUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(baseUrl.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // u.host includes the port when present, which is what match patterns want.
  return `${u.protocol}//${u.host}/*`;
}

/**
 * Resolves true when the extension may talk to this origin.
 *
 * MUST be called from a user gesture (a click handler) — Chrome rejects
 * permissions.request() outside one.
 */
export async function ensureHostPermission(baseUrl: string): Promise<boolean> {
  const pattern = originPatternFor(baseUrl);
  if (!pattern) return false;
  const origins = [pattern];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}
