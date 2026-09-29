import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import * as api from './client';
import { chunkBySize } from './importSize';
import type { BulkAction, HubPatch, LinkPatch, LinkSort, QuotePatch } from './types';

export const PAGE_SIZE = 200;

export interface LinkFilters {
  q?: string;
  hub?: string;
  unassigned?: boolean;
  status?: 'active' | 'archived';
  broken?: boolean;
  sort?: LinkSort;
}

export function useLinksInfinite(filters: LinkFilters) {
  return useInfiniteQuery({
    queryKey: ['links', filters],
    queryFn: ({ pageParam }) => api.fetchLinks({ ...filters, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.items.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });
}

export function useHubs() {
  return useQuery({ queryKey: ['hubs'], queryFn: api.fetchHubs });
}

export function useStats() {
  return useQuery({ queryKey: ['stats'], queryFn: api.fetchStats });
}

function useInvalidate(...keys: string[]) {
  const queryClient = useQueryClient();
  return () => Promise.all(keys.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
}

export function useSaveLink() {
  const invalidate = useInvalidate('links', 'hubs', 'stats');
  return useMutation({
    mutationFn: (input: api.SaveLinkInput) => api.saveLink(input),
    // Not awaited: the save page shows none of these lists, so its outcome
    // should not wait for them to refetch.
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useLink(id: string | null) {
  return useQuery({
    queryKey: ['link', id],
    queryFn: () => api.fetchLink(id!),
    enabled: id !== null,
  });
}

/**
 * Saves the edit dialog: the fields in one PATCH, then the hub changes, which
 * the server takes per hub. Everything that shows the link refetches after.
 */
export function useEditLink() {
  const invalidate = useInvalidate('links', 'link', 'hubs', 'stats');
  return useMutation({
    mutationFn: async ({ id, body, addHubs, removeHubs }: {
      id: string;
      body: LinkPatch;
      addHubs: string[];
      removeHubs: string[];
    }) => {
      if (Object.keys(body).length > 0) await api.patchLink(id, body);
      for (const hubId of addHubs) await api.bulkLinks({ ids: [id], action: 'assign', hubId });
      for (const hubId of removeHubs) await api.bulkLinks({ ids: [id], action: 'unassign', hubId });
    },
    onSuccess: () => invalidate(),
  });
}

export function useDeleteLink() {
  const invalidate = useInvalidate('links', 'hubs', 'stats', 'quotes');
  return useMutation({
    mutationFn: (id: string) => api.bulkLinks({ ids: [id], action: 'delete' }),
    onSuccess: () => invalidate(),
  });
}

export function usePatchLink() {
  const invalidate = useInvalidate('links', 'stats');
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LinkPatch }) => api.patchLink(id, body),
    onSuccess: () => invalidate(),
  });
}

export function useRefreshLink() {
  const invalidate = useInvalidate('link', 'links');
  return useMutation({
    mutationFn: (id: string) => api.refreshLink(id),
    onSuccess: () => invalidate(),
  });
}

export function useBulkLinks() {
  const invalidate = useInvalidate('links', 'hubs', 'stats', 'quotes');
  return useMutation({
    mutationFn: (body: { ids: string[]; action: BulkAction; hubId?: string }) =>
      api.bulkLinks(body),
    onSuccess: () => invalidate(),
  });
}

/**
 * Import in batches, because a bookmark tree is routinely thousands of links
 * and the route accepts 200 at a time. Batches are sent in sequence rather than
 * in parallel: every one of them writes the same tables, and a browser export
 * is not worth a thundering herd against a self-hosted Postgres.
 */
export function useImportLinks() {
  const invalidate = useInvalidate('links', 'hubs', 'stats', 'quotes');
  return useMutation({
    mutationFn: async ({
      items,
      orphanQuotes = [],
      onProgress,
    }: {
      items: api.ImportItem[];
      /** Quotes whose page is gone, from a bukmark backup. Sent once, riding the first request(s). */
      orphanQuotes?: api.ImportOrphanQuote[];
      onProgress?: (done: number, total: number) => void;
    }): Promise<api.ImportResult> => {
      const total: api.ImportResult = {
        created: 0, updated: 0, skippedDeleted: 0, invalid: [], quotes: { added: 0, alreadyHere: 0, invalid: 0 },
      };
      // A batch closes at the item cap or before its body would pass the byte
      // budget, whichever comes first; an item stays whole so its quotes travel
      // with it (the parser keeps a single item under the budget).
      const batches = chunkBySize(items, api.IMPORT_BATCH_SIZE);
      const orphanChunks = chunkBySize(orphanQuotes, api.IMPORT_ORPHAN_BATCH_SIZE);

      let done = 0;
      for (let n = 0; n < Math.max(batches.length, orphanChunks.length); n++) {
        // Past the last batch a request carries orphans alone, with no items.
        const batch = batches[n] ?? [];
        const res = await api.importLinks(batch, orphanChunks[n]);
        total.created += res.created;
        total.updated += res.updated;
        total.skippedDeleted += res.skippedDeleted;
        total.invalid.push(...res.invalid);
        total.quotes.added += res.quotes.added;
        total.quotes.alreadyHere += res.quotes.alreadyHere;
        total.quotes.invalid += res.quotes.invalid;
        done += batch.length;
        onProgress?.(done, items.length);
      }
      return total;
    },
    onSuccess: () => invalidate(),
  });
}

export function useCreateHub() {
  const invalidate = useInvalidate('hubs', 'stats');
  return useMutation({
    mutationFn: (body: { name: string; description?: string }) => api.createHub(body),
    onSuccess: () => invalidate(),
  });
}

export function usePatchHub() {
  const invalidate = useInvalidate('hubs');
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: HubPatch }) => api.patchHub(id, body),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteHub() {
  const invalidate = useInvalidate('hubs', 'links', 'stats');
  return useMutation({
    mutationFn: (id: string) => api.deleteHub(id),
    onSuccess: () => invalidate(),
  });
}

/** The server's default page of quotes (it allows up to 100). */
export const QUOTES_PAGE_SIZE = 50;

export interface QuoteFilters {
  q?: string;
  linkId?: string;
}

/** Quotes newest first, a page at a time: each page's nextCursor asks for the next, older one. */
export function useQuotes(filters: QuoteFilters = {}) {
  return useInfiniteQuery({
    queryKey: ['quotes', filters],
    queryFn: ({ pageParam }) =>
      api.fetchQuotes({
        ...filters,
        limit: QUOTES_PAGE_SIZE,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useCreateQuote() {
  // A quote from a page not saved yet saves the page too, unsorted.
  const invalidate = useInvalidate('quotes', 'links', 'hubs', 'stats');
  return useMutation({
    mutationFn: (input: api.CreateQuoteInput) => api.createQuote(input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdateQuote() {
  const invalidate = useInvalidate('quotes');
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: QuotePatch }) => api.patchQuote(id, body),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteQuote() {
  // Links carry how many quotes they have; stats carry the total.
  const invalidate = useInvalidate('quotes', 'links', 'stats');
  return useMutation({
    mutationFn: (id: string) => api.deleteQuote(id),
    onSuccess: () => invalidate(),
  });
}

// Auth hooks

export function useAuthStatus() {
  return useQuery({
    queryKey: ['auth-status'],
    queryFn: api.fetchAuthStatus,
    retry: false,
  });
}

function refetchAuthStatus(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ['auth-status'] });
}

export function useSetupOwner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.setupOwner(password),
    onSuccess: () => refetchAuthStatus(queryClient),
    // Setup finished elsewhere (another tab): the status now leads to the login screen.
    onError: (error) =>
      error instanceof api.ApiError && error.code === 'already_setup'
        ? refetchAuthStatus(queryClient)
        : undefined,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.login(password),
    onSuccess: () => refetchAuthStatus(queryClient),
    // The owner was reset while this screen was open: the status now leads to setup.
    onError: (error) =>
      error instanceof api.ApiError && error.code === 'setup_required'
        ? refetchAuthStatus(queryClient)
        : undefined,
  });
}

/**
 * Drops everything the session loaded, except ['auth-status']. AuthGate is still
 * observing that query when this runs; queryClient.clear() would remove it from
 * under the observer, nothing would refetch it, and the app would stay on screen.
 */
async function forgetSession(queryClient: QueryClient) {
  queryClient.setQueryData<api.AuthStatus>(
    ['auth-status'],
    (status) => status && { ...status, authenticated: false },
  );
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth-status' });
  queryClient.getMutationCache().clear();
  await refetchAuthStatus(queryClient);
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => forgetSession(queryClient),
    // A 401 means the session had already ended, which is what logging out asked for.
    onError: (error) =>
      error instanceof api.ApiError && error.status === 401
        ? forgetSession(queryClient)
        : undefined,
  });
}

export function useListTokens() {
  return useQuery({
    queryKey: ['auth-tokens'],
    queryFn: api.listTokens,
  });
}

export function useCreateToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createToken(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth-tokens'] }),
  });
}

export function useDeleteToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteToken(id),
    // Also after a failure: a 404 means the row on screen is already stale.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['auth-tokens'] }),
  });
}
