export interface Settings {
  baseUrl: string;
}

// localhost, matching the default `docker compose up -d` server. Anyone running
// bukmark on another host sets their own URL in the options page, which also
// requests permission for that origin at runtime (see lib/permissions.ts).
export const DEFAULT_BASE_URL = 'http://localhost:3000';

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed === '' ? DEFAULT_BASE_URL : trimmed;
}

/**
 * Settings follow the person between browsers through storage.sync. Opera has
 * no sync area (Safari and Firefox for Android keep it on the device anyway),
 * so storage.local stands in whenever sync is missing or fails.
 */
async function inSettingsArea<T>(use: (area: chrome.storage.StorageArea) => Promise<T>): Promise<T> {
  const sync = chrome.storage.sync as chrome.storage.StorageArea | undefined;
  if (sync) {
    try {
      return await use(sync);
    } catch {
      // Falls through to local.
    }
  }
  return use(chrome.storage.local);
}

/** True when a storage.onChanged event changed the settings, in whichever area holds them. */
export function changesSettings(changes: Record<string, unknown>, area: string): boolean {
  return (area === 'sync' || area === 'local') && 'baseUrl' in changes;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await inSettingsArea((area) => area.get({ baseUrl: DEFAULT_BASE_URL }));
  return { baseUrl: normalizeBaseUrl(String(stored.baseUrl)) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await inSettingsArea((area) => area.set({ baseUrl: normalizeBaseUrl(s.baseUrl) }));
}

/** A page bukmark can save: an http(s) address. Nothing else ever leaves the browser. */
export function isWebPage(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
