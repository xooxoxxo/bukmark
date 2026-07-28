import { chunk, type FlatBookmark } from './bookmarks';

const IMPORT_BATCH = 200; // matches the server's maxItems cap
const BACKFILL_BATCH = 20;

export interface SaveInput {
  url: string;
  title?: string;
  note?: string;
  hub?: string;
}

export interface SaveResult {
  outcome: 'created' | 'updated' | 'resurrected';
  link: { dupeCount: number };
}

export interface Hub {
  id: string;
  name: string;
  linkCount: number;
}

export interface ImportProgress {
  done: number;
  total: number;
}

export interface ImportTotals {
  created: number;
  updated: number;
  skippedDeleted: number;
  invalid: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const msg = await res
      .json()
      .then((b) => (b as { error?: string }).error)
      .catch(() => null);
    throw new Error(msg ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function saveLink(baseUrl: string, input: SaveInput): Promise<SaveResult> {
  // Send only what was filled in: an empty string would overwrite a title or
  // note that already exists on a link being re-saved.
  const body: Record<string, unknown> = { url: input.url };
  if (input.title) body.title = input.title;
  if (input.note) body.note = input.note;
  if (input.hub) body.hub = input.hub;
  return postJson<SaveResult>(`${baseUrl}/api/links`, body);
}

export async function listHubs(baseUrl: string): Promise<Hub[]> {
  const body = await request<{ items: Hub[] }>(`${baseUrl}/api/hubs`);
  return body.items;
}

export async function runImport(
  baseUrl: string,
  items: FlatBookmark[],
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportTotals> {
  const totals: ImportTotals = { created: 0, updated: 0, skippedDeleted: 0, invalid: 0 };
  let done = 0;
  for (const batch of chunk(items, IMPORT_BATCH)) {
    const res = await postJson<{
      created: number; updated: number; skippedDeleted: number; invalid: unknown[];
    }>(`${baseUrl}/api/links/import`, { items: batch });
    totals.created += res.created;
    totals.updated += res.updated;
    totals.skippedDeleted += res.skippedDeleted;
    totals.invalid += res.invalid.length;
    done += batch.length;
    onProgress?.({ done, total: items.length });
  }
  return totals;
}

/**
 * Drain the og backfill queue, returning how many links were processed.
 *
 * Bounded on `processed === 0`, not only on `remaining === 0`: if the server
 * reports work left but claims none of it, looping on `remaining` alone would
 * hammer it forever. Stopping early is recoverable — the caller can just run
 * the import again — whereas a spin loop is not.
 */
export async function runBackfill(
  baseUrl: string,
  onProgress?: (remaining: number) => void,
): Promise<number> {
  let processed = 0;
  for (;;) {
    const res = await postJson<{ processed: number; remaining: number }>(
      `${baseUrl}/api/links/og-backfill`,
      { limit: BACKFILL_BATCH },
    );
    if (res.processed === 0) return processed;
    processed += res.processed;
    onProgress?.(res.remaining);
    if (res.remaining === 0) return processed;
  }
}
