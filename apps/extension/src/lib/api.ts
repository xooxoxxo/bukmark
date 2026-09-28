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

/** POST /api/links's whole answer: the link as the server stored it, its address normalized. */
export interface SaveReply extends SaveResult {
  link: { id: string; url: string; title: string; dupeCount: number };
}

export interface Hub {
  id: string;
  name: string;
  linkCount: number;
  status?: 'active' | 'dormant' | 'archived';
}

/** One link as GET /api/links/changes reports it: hubs by name. */
export interface LinkChange {
  id: string;
  url: string;
  title: string;
  note: string;
  status: 'active' | 'archived';
  hubs: string[];
  updatedAt: string;
}

/** A page of the changes feed. `cursor` is the next `since`; `more` says another page follows. */
export interface ChangesPage {
  items: LinkChange[];
  deleted: { id: string; deletedAt: string }[];
  cursor: string | null;
  more: boolean;
}

/** What PATCH /api/links/:id changes. `hubs` replaces the link's hub set, by name. */
export interface LinkPatch {
  title?: string;
  status?: 'active' | 'archived';
  hubs?: string[];
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

/** The server answered, with an error status. Anything else thrown by a request means it was not reached. */
export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

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
    throw new HttpError(msg ?? `HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

function sendJson<T>(auth: Credentials, method: 'POST' | 'PATCH', path: string, body: unknown, init: RequestInit = {}): Promise<T> {
  return request<T>(auth, path, {
    ...init,
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postJson<T>(auth: Credentials, path: string, body: unknown): Promise<T> {
  return sendJson<T>(auth, 'POST', path, body);
}

export function saveLink(auth: Credentials, input: SaveInput, init: RequestInit = {}): Promise<SaveReply> {
  // Send only what was filled in: an empty string would overwrite a title or
  // note that already exists on a link being re-saved.
  const body: Record<string, unknown> = { url: input.url };
  if (input.title) body.title = input.title;
  if (input.note) body.note = input.note;
  if (input.hub) body.hub = input.hub;
  return sendJson<SaveReply>(auth, 'POST', '/api/links', body, init);
}

export function lookupLink(auth: Credentials, url: string): Promise<LinkLookup> {
  return request<LinkLookup>(auth, `/api/links/lookup?url=${encodeURIComponent(url)}`);
}

export async function listHubs(auth: Credentials): Promise<Hub[]> {
  const body = await request<{ items: Hub[] }>(auth, '/api/hubs');
  return body.items;
}

/**
 * GET /api/links/changes: links changed at or after `since` (every link when
 * null), oldest first, and the links deleted since then.
 */
export function linkChanges(auth: Credentials, since: string | null, limit: number, init: RequestInit = {}): Promise<ChangesPage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (since !== null) query.set('since', since);
  return request<ChangesPage>(auth, `/api/links/changes?${query}`, init);
}

export function updateLink(auth: Credentials, id: string, patch: LinkPatch, init: RequestInit = {}): Promise<unknown> {
  return sendJson(auth, 'PATCH', `/api/links/${encodeURIComponent(id)}`, patch, init);
}

/** Every hub, archived ones included, for finding a hub's id by its name. */
export async function listAllHubs(auth: Credentials, init: RequestInit = {}): Promise<Hub[]> {
  const body = await request<{ items: Hub[] }>(auth, '/api/hubs?status=all', init);
  return body.items;
}

/** POST /api/hubs. False when a hub by that name already exists (409). */
export async function createHub(auth: Credentials, name: string, init: RequestInit = {}): Promise<boolean> {
  try {
    await sendJson(auth, 'POST', '/api/hubs', { name }, init);
    return true;
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return false;
    throw err;
  }
}

export function updateHub(
  auth: Credentials,
  id: string,
  patch: { name?: string; status?: 'active' | 'archived' },
  init: RequestInit = {},
): Promise<unknown> {
  return sendJson(auth, 'PATCH', `/api/hubs/${encodeURIComponent(id)}`, patch, init);
}

/** Takes a hub off these links, leaving the links themselves. */
export function unassignHub(auth: Credentials, hubId: string, linkIds: string[], init: RequestInit = {}): Promise<unknown> {
  return sendJson(auth, 'POST', '/api/links/bulk', { ids: linkIds, action: 'unassign', hubId }, init);
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
