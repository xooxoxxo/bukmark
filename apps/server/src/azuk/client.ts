import { sha256Hex } from '@bukmark/shared';

export interface AzukList { id: string; name: string; kind: string }
export interface AzukItem { id: string; list_id: string; text: string; note: string | null; status: string }
export interface AzukTarget {
  url: string;
  last_price: string | number | null;
  last_currency: string | null;
  last_observed_at: string | null;
  status: string;
}
export interface AzukWatch {
  id: string;
  source: string;
  status: string;
  tier: string;
  notify_scope: string;
  triggers: Array<{ type: string; price?: string | number; currency?: string; pct?: string | number; variant?: string }>;
  targets: AzukTarget[];
  last_checked_at: string | null;
}
export type WatchTrigger = { type: 'drop_pct'; pct: 10 } | { type: 'price_below'; price: string; currency: string };

export class AzukResponseError extends Error {
  constructor(readonly status: number) {
    super(`Azuk returned HTTP ${status}.`);
  }
}

export function createAzukClient(baseUrl: string | undefined, token: string | undefined, fetcher = globalThis.fetch) {
  if (!baseUrl?.trim() || !token?.trim()) return undefined;
  const url = URL.parse(baseUrl.trim());
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BUKMARK_AZUK_URL must be an HTTP or HTTPS origin.');
  }
  const credential = token.trim();
  const origin = url.origin;
  async function request<T>(path: string, body?: object): Promise<T> {
    const response = await fetcher(new URL(path, origin), {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${credential}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new AzukResponseError(response.status);
    return await response.json() as T;
  }

  const listPath = (name: string) => `/api/lists/${encodeURIComponent(name)}/items`;
  return {
    connection: sha256Hex(JSON.stringify([origin, credential])),
    lists: () => request<AzukList[]>('/api/lists'),
    items: (list: AzukList) => request<AzukItem[]>(`${listPath(list.name)}?status=open&status=suggested&status=bought&status=dropped`),
    addItem: (list: AzukList, text: string, note: string) =>
      request<AzukItem>(listPath(list.name), { text, note, status: 'open' }),
    watches: () => request<AzukWatch[]>('/api/watches?include_deleted=true'),
    addWatch: (listingUrl: string, label: string, trigger: WatchTrigger) =>
      request<AzukWatch>('/api/watches', { url: listingUrl, label, tier: 'passive', notify: 'creator', triggers: [trigger] }),
    watch: (id: string) => request<AzukWatch>(`/api/watches/${encodeURIComponent(id)}`),
  };
}

export type AzukClient = NonNullable<ReturnType<typeof createAzukClient>>;
