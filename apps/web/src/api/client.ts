import type { KnowledgeDraft, KnowledgeEvidenceAction, KnowledgeFields, KnowledgeReading, RecipeApproval, RecipeDraft,
  SiftApplicationInput, SiftApplicationView, SiftBaselineSummary, SiftPreview, SiftRunReceipt, SiftRunSummary, SiftScope } from '@bukmark/shared/review';
import type {
  BulkAction,
  AzukDelivery,
  AzukLists,
  BuilderApproval,
  BuilderCandidate,
  BuilderDraft,
  BuilderExport,
  BuilderPreparation,
  HubDto,
  HubPatch,
  LinkDetail,
  LinkDto,
  LinkPatch,
  LinksQuery,
  QuoteDto,
  QuotePatch,
  QuotesQuery,
  ReviewDecision,
  ReviewFilter,
  ReviewProposal,
  Stats,
  UpdatesPatch,
  UpdatesStatus,
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
  // 204 No Content (a quote's DELETE) has no body to parse.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const fetchSiftBaselines = () => http<{items:SiftBaselineSummary[]}>('/review/sift/baselines');
export const fetchSiftRuns = (offset:number) => http<{items:SiftRunSummary[];more:boolean}>(`/review/sift/runs?offset=${offset}`);
export const fetchSiftPreview = (id:string,offset:number) => http<SiftPreview>(`/review/sift/runs/${encodeURIComponent(id)}?offset=${offset}`);
export const saveSiftPreview = (scope:SiftScope) => http<SiftRunReceipt>('/review/sift/runs',jsonInit('POST',{scope}));
export const prepareSiftApplication = (id:string,input:SiftApplicationInput) => http<SiftApplicationView>(`/review/sift/runs/${encodeURIComponent(id)}/application-previews`,jsonInit('POST',input));
export const fetchSiftApplicationPreview = (id:string,offset:number) => http<SiftApplicationView>(`/review/sift/application-previews/${encodeURIComponent(id)}?offset=${offset}`);
export const approveSiftApplication = (id:string,digest:string) => http<SiftApplicationView>(`/review/sift/application-previews/${encodeURIComponent(id)}/apply`,jsonInit('POST',{digest}));
export const fetchSiftApplication = (id:string,offset:number) => http<SiftApplicationView>(`/review/sift/applications/${encodeURIComponent(id)}?offset=${offset}`);

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function builderQuery(linkId: string | null, offset: number, q?: string) {
  const params = new URLSearchParams({ offset: String(offset) });
  if (linkId) params.set('linkId', linkId);
  if (q) params.set('q', q);
  return params;
}

export function fetchBuilderCandidates(linkId: string | null, offset: number, q: string) {
  return http<{ items: BuilderCandidate[]; more: boolean }>(`/review/builder/candidates?${builderQuery(linkId, offset, q)}`);
}

export function prepareBuilderDrafts(linkIds: string[]) {
  return http<{ items: BuilderPreparation[] }>('/review/builder/prepare', jsonInit('POST', { linkIds }));
}

export function fetchBuilderDrafts(linkId: string | null, offset: number) {
  return http<{ items: BuilderDraft[]; more: boolean }>(`/review/builder/drafts?${builderQuery(linkId, offset)}`);
}

export function approveBuilderExport(items: BuilderApproval[]) {
  return http<BuilderExport>('/review/builder/exports', jsonInit('POST', { items }));
}

export function builderExportUrl(id: string) {
  return `/api/review/builder/exports/${encodeURIComponent(id)}`;
}

export interface SavedPageCandidate {
  id: string;
  title: string;
  url: string;
  status: 'active' | 'archived';
}

export type RecipePreparation = { outcome: 'prepared'; draft: RecipeDraft }
  | { outcome: 'choose'; choices: { key: string; title: string }[] }
  | { outcome: 'unavailable'; error: string | null; status: number | null }
  | { outcome: 'missing' | 'changed' | 'malformed' | 'ambiguous' | 'no-recipe' };

function savedPageQuery(linkId: string | null, offset: number, q?: string) {
  const params = new URLSearchParams({ offset: String(offset) });
  if (linkId) params.set('linkId', linkId);
  if (q) params.set('q', q);
  return params;
}

export function fetchRecipeCandidates(linkId: string | null, offset: number, q: string) {
  return http<{ items: SavedPageCandidate[]; more: boolean }>(`/review/recipes/candidates?${savedPageQuery(linkId, offset, q)}`);
}

export function prepareRecipe(linkId: string, key?: string) {
  return http<RecipePreparation>('/review/recipes/prepare', jsonInit('POST', { linkId, key }));
}

export function fetchRecipeDrafts(linkId: string | null, offset: number) {
  return http<{ items: RecipeDraft[]; more: boolean }>(`/review/recipes/drafts?${savedPageQuery(linkId, offset)}`);
}

export function approveRecipeExport(approval: RecipeApproval) {
  return http<{ id: string }>('/review/recipes/exports', jsonInit('POST', approval));
}

export function recipeExportUrl(id: string) {
  return `/api/review/recipes/exports/${encodeURIComponent(id)}`;
}

export function fetchKnowledgeCandidates(linkId: string | null, offset: number, q: string) {
  return http<{ items: SavedPageCandidate[]; more: boolean }>(`/review/notes/candidates?${savedPageQuery(linkId, offset, q)}`);
}

export function fetchKnowledgeNotes(linkId: string | null, offset: number) {
  return http<{ items: KnowledgeDraft[]; more: boolean }>(`/review/notes/drafts?${savedPageQuery(linkId, offset)}`);
}

export function startKnowledgeNote(linkId: string, another: boolean) {
  return http<{ draft: KnowledgeDraft }>('/review/notes/drafts', jsonInit('POST', { linkId, another }));
}

export function saveKnowledgeNote(id: string, revision: number, fields: KnowledgeFields) {
  return http<{ draft: KnowledgeDraft }>(`/review/notes/drafts/${encodeURIComponent(id)}`, jsonInit('PATCH', { revision, fields }));
}

export function updateKnowledgeEvidence(id: string, revision: number, action: KnowledgeEvidenceAction) {
  return http<{ draft: KnowledgeDraft; reading?: KnowledgeReading }>('/review/notes/evidence', jsonInit('POST', { id, revision, ...action }));
}

export function approveKnowledgeNote(id: string, revision: number) {
  return http<{ id: string }>('/review/notes/exports', jsonInit('POST', { id, revision }));
}

export function knowledgeExportUrl(id: string) {
  return `/api/review/notes/exports/${encodeURIComponent(id)}`;
}

export function fetchLinks(query: LinksQuery = {}): Promise<{ items: LinkDto[]; total: number }> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.hub) params.set('hub', query.hub);
  if (query.unassigned) params.set('unassigned', 'true');
  if (query.status) params.set('status', query.status);
  if (query.broken) params.set('broken', 'true');
  if (query.sort && query.sort !== 'relevance') params.set('sort', query.sort);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const qs = params.toString();
  return http(qs ? `/links?${qs}` : '/links');
}

export interface SaveLinkInput {
  url: string;
  title?: string;
  note?: string;
  /** Hub name; the server creates the hub if it does not exist. */
  hub?: string;
}

export interface SaveLinkResult {
  outcome: 'created' | 'updated' | 'resurrected';
  link: LinkDto;
}

export function saveLink(input: SaveLinkInput): Promise<SaveLinkResult> {
  // Only what was filled in: an empty string would overwrite the title or note
  // a link being saved again already has.
  const body: SaveLinkInput = { url: input.url };
  if (input.title) body.title = input.title;
  if (input.note) body.note = input.note;
  if (input.hub) body.hub = input.hub;
  return http('/links', jsonInit('POST', body));
}

export function fetchLink(id: string): Promise<LinkDetail> {
  return http(`/links/${id}`);
}

export function patchLink(id: string, body: LinkPatch): Promise<LinkDto> {
  return http(`/links/${id}`, jsonInit('PATCH', body));
}

export function refreshLink(id: string): Promise<LinkDto> {
  return http(`/links/${id}/refresh`, jsonInit('POST', {}));
}

export function bulkLinks(body: {
  ids: string[];
  action: BulkAction;
  hubId?: string;
}): Promise<{ affected: number }> {
  return http('/links/bulk', jsonInit('POST', body));
}

export function fetchReview(state: ReviewFilter, linkId: string | null, offset: number) {
  const query = new URLSearchParams({ state, offset: String(offset) });
  if (linkId) query.set('linkId', linkId);
  return http<{ items: ReviewProposal[]; more: boolean }>(`/review?${query}`);
}

export function prepareReview(linkId: string | null) {
  return http<{ items: Array<{ linkId: string; outcome: 'prepared' | 'unchanged' | 'inactive' }> }>(
    '/review/prepare', jsonInit('POST', linkId ? { linkId } : {}),
  );
}

export function decideReview(items: ReviewDecision[]) {
  return http<{ items: Array<{ id: string; outcome: 'saved' | 'existing' | 'inactive' | 'changed' | 'incomplete' | 'destination' }> }>(
    '/review/decisions', jsonInit('POST', { items }),
  );
}

export function fetchAzukLists() {
  return http<AzukLists>('/review/azuk/lists');
}

export function fetchAzukDeliveries(linkId: string | null, offset: number) {
  const query = new URLSearchParams({ offset: String(offset) });
  if (linkId) query.set('linkId', linkId);
  return http<{ items: AzukDelivery[]; more: boolean }>(`/review/azuk/deliveries?${query}`);
}

export function updateAzukDelivery(id: string, action: 'retry' | 'refresh') {
  return http<{ outcome: 'queued' | 'refreshed' | 'unchanged' | 'unavailable' }>(
    `/review/azuk/deliveries/${encodeURIComponent(id)}/${action}`, { method: 'POST' },
  );
}

export interface ImportQuote {
  text: string;
  note?: string;
  createdAt?: string;
}

/** A quote whose page was deleted; it carries the address and title it was saved from. */
export interface ImportOrphanQuote extends ImportQuote {
  sourceUrl: string;
  sourceTitle?: string;
}

export interface ImportItem {
  url: string;
  title?: string;
  folderPath?: string;
  quotes?: ImportQuote[];
}

export interface ImportResult {
  reviewIds?: string[];
  created: number;
  updated: number;
  skippedDeleted: number;
  invalid: { url: string; reason: string }[];
  quotes: { added: number; alreadyHere: number; invalid: number };
}

/** The server caps one request at 200 items; callers chunk to this size. */
export const IMPORT_BATCH_SIZE = 200;

/** The server caps orphanQuotes at this many per request. */
export const IMPORT_ORPHAN_BATCH_SIZE = 1000;

export function importLinks(
  items: ImportItem[],
  orphanQuotes?: ImportOrphanQuote[],
  reviewSample = false,
): Promise<ImportResult> {
  const body = orphanQuotes && orphanQuotes.length > 0 ? { items, orphanQuotes } : { items };
  return http(reviewSample ? '/links/import?reviewSample=true' : '/links/import', jsonInit('POST', body));
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

export interface CreateQuoteInput {
  url: string;
  title?: string;
  text: string;
  note?: string;
}

export interface CreateQuoteResult {
  quote: QuoteDto;
  /** The page's link; `created` when the quote saved the page too. */
  link: { id: string; created: boolean };
}

export function createQuote(input: CreateQuoteInput): Promise<CreateQuoteResult> {
  return http('/quotes', jsonInit('POST', input));
}

export interface QuotesPage {
  items: QuoteDto[];
  /** Pass back as `cursor` for the next (older) page; null on the last one. */
  nextCursor: string | null;
}

export function fetchQuotes(query: QuotesQuery = {}): Promise<QuotesPage> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.linkId) params.set('linkId', query.linkId);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const qs = params.toString();
  return http(qs ? `/quotes?${qs}` : '/quotes');
}

export async function patchQuote(id: string, body: QuotePatch): Promise<QuoteDto> {
  const { quote } = await http<{ quote: QuoteDto }>(`/quotes/${id}`, jsonInit('PATCH', body));
  return quote;
}

export function deleteQuote(id: string): Promise<void> {
  return http(`/quotes/${id}`, { method: 'DELETE' });
}

export function fetchStats(): Promise<Stats> {
  return http('/stats');
}

// Updates

export function fetchUpdates(): Promise<UpdatesStatus> {
  return http('/updates');
}

export function checkUpdates(): Promise<UpdatesStatus> {
  return http('/updates/check', { method: 'POST' });
}

export function patchUpdates(body: UpdatesPatch): Promise<UpdatesStatus> {
  return http('/updates', jsonInit('PATCH', body));
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
