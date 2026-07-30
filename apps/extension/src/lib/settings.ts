export interface Settings {
  baseUrl: string;
}

// localhost, matching the default `docker compose up -d` server. Anyone running
// bookmarkt on another host sets their own URL in the options page, which also
// requests permission for that origin at runtime (see lib/permissions.ts).
export const DEFAULT_BASE_URL = 'http://localhost:3000';

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed === '' ? DEFAULT_BASE_URL : trimmed;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get({ baseUrl: DEFAULT_BASE_URL });
  return { baseUrl: normalizeBaseUrl(String(stored.baseUrl)) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.sync.set({ baseUrl: normalizeBaseUrl(s.baseUrl) });
}
