export interface Settings {
  baseUrl: string;
}

// The tailnet address, not bookmarkt.home: the .home name only resolves on the
// LAN via Pi-hole, so it would fail silently the moment you leave the house.
export const DEFAULT_BASE_URL = 'http://localhost:8085';

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
