import type {
  BulkAction,
  HubDto,
  HubPatch,
  LinkDto,
  LinkPatch,
  LinksQuery,
  Stats,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
      if (body.code) code = body.code;
    } catch {
      // non-JSON error body: keep the HTTP status message
    }
    throw new ApiError(message, res.status, code);
  }
  return res.json() as Promise<T>;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function fetchLinks(query: LinksQuery = {}): Promise<{ items: LinkDto[]; total: number }> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.hub) params.set('hub', query.hub);
  if (query.unassigned) params.set('unassigned', 'true');
  if (query.status) params.set('status', query.status);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const qs = params.toString();
  return http(qs ? `/links?${qs}` : '/links');
}

export function patchLink(id: string, body: LinkPatch): Promise<LinkDto> {
  return http(`/links/${id}`, jsonInit('PATCH', body));
}

export function bulkLinks(body: {
  ids: string[];
  action: BulkAction;
  hubId?: string;
}): Promise<{ affected: number }> {
  return http('/links/bulk', jsonInit('POST', body));
}

export interface ImportItem {
  url: string;
  title?: string;
  folderPath?: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  skippedDeleted: number;
  invalid: { url: string; reason: string }[];
}

/** The server caps one request at 200 items; callers chunk to this size. */
export const IMPORT_BATCH_SIZE = 200;

export function importLinks(items: ImportItem[]): Promise<ImportResult> {
  return http('/links/import', jsonInit('POST', { items }));
}

export function fetchHubs(): Promise<{ items: HubDto[] }> {
  return http('/hubs');
}

export function createHub(body: {
  name: string;
  description?: string;
}): Promise<{ id: string; name: string }> {
  return http('/hubs', jsonInit('POST', body));
}

export function patchHub(id: string, body: HubPatch): Promise<{ id: string }> {
  return http(`/hubs/${id}`, jsonInit('PATCH', body));
}

export function deleteHub(id: string): Promise<{ ok: boolean }> {
  return http(`/hubs/${id}`, { method: 'DELETE' });
}

export function fetchStats(): Promise<Stats> {
  return http('/stats');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error';
}

// Auth endpoints

export interface AuthStatus {
  setupComplete: boolean;
  authenticated: boolean;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  current?: boolean;
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return http('/auth/status');
}

export function setupOwner(password: string): Promise<{ ok: boolean }> {
  return http('/auth/setup', jsonInit('POST', { password }));
}

export function login(password: string): Promise<{ ok: boolean }> {
  return http('/auth/login', jsonInit('POST', { password }));
}

export function logout(): Promise<{ ok: boolean }> {
  return http('/auth/logout', { method: 'POST' });
}

export function listTokens(): Promise<{ items: ApiToken[] }> {
  return http('/auth/tokens');
}

export interface CreateTokenResponse {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  token: string;
}

export function createToken(name: string): Promise<CreateTokenResponse> {
  return http('/auth/tokens', jsonInit('POST', { name }));
}

export function deleteToken(id: string): Promise<{ ok: boolean }> {
  return http(`/auth/tokens/${id}`, { method: 'DELETE' });
}
