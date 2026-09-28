import { AuthRequiredError, clearAuth, type Auth } from './auth';
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

/** GET /api/links/lookup: the page itself if saved, and how its site is filed. */
export interface LinkLookup {
  saved: { hubs: string[] } | null;
  domain: { host: string; links: number; hubs: { name: string; links: number }[] };
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

/**
 * What a request needs. The URL is built from the token's own server, so a
 * token cannot be sent anywhere else.
 */
export type Credentials = Pick<Auth, 'server' | 'token'>;

async function request<T>(auth: Credentials, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${auth.token}`);
  const res = await fetch(`${auth.server}${path}`, { ...init, headers });

  if (res.status === 401) {
    await clearAuth();
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    const msg = await res
      .json()
      .then((b) => (b as { error?: string }).error)
      .catch(() => null);
    throw new Error(msg ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function postJson<T>(auth: Credentials, path: string, body: unknown): Promise<T> {
  return request<T>(auth, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function saveLink(auth: Credentials, input: SaveInput): Promise<SaveResult> {
  // Send only what was filled in: an empty string would overwrite a title or
  // note that already exists on a link being re-saved.
  const body: Record<string, unknown> = { url: input.url };
  if (input.title) body.title = input.title;
  if (input.note) body.note = input.note;
  if (input.hub) body.hub = input.hub;
  return postJson<SaveResult>(auth, '/api/links', body);
}

export function lookupLink(auth: Credentials, url: string): Promise<LinkLookup> {
  return request<LinkLookup>(auth, `/api/links/lookup?url=${encodeURIComponent(url)}`);
}

export async function listHubs(auth: Credentials): Promise<Hub[]> {
  const body = await request<{ items: Hub[] }>(auth, '/api/hubs');
  return body.items;
}

export async function runImport(
  auth: Credentials,
  items: FlatBookmark[],
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportTotals> {
  const totals: ImportTotals = { created: 0, updated: 0, skippedDeleted: 0, invalid: 0 };
  let done = 0;
  for (const batch of chunk(items, IMPORT_BATCH)) {
    const res = await postJson<{
      created: number; updated: number; skippedDeleted: number; invalid: unknown[];
    }>(auth, '/api/links/import', { items: batch });
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
  auth: Credentials,
  onProgress?: (remaining: number) => void,
): Promise<number> {
  let processed = 0;
  for (;;) {
    const res = await postJson<{ processed: number; remaining: number }>(
      auth,
      '/api/links/og-backfill',
      { limit: BACKFILL_BATCH },
    );
    if (res.processed === 0) return processed;
    processed += res.processed;
    onProgress?.(res.remaining);
    if (res.remaining === 0) return processed;
  }
}
