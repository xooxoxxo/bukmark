import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import * as api from './client';
import type { BulkAction, HubPatch, LinkPatch } from './types';

export const PAGE_SIZE = 200;

export interface LinkFilters {
  q?: string;
  hub?: string;
  unassigned?: boolean;
  status?: 'active' | 'archived';
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

export function usePatchLink() {
  const invalidate = useInvalidate('links', 'stats');
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LinkPatch }) => api.patchLink(id, body),
    onSuccess: () => invalidate(),
  });
}

export function useBulkLinks() {
  const invalidate = useInvalidate('links', 'hubs', 'stats');
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
  const invalidate = useInvalidate('links', 'hubs', 'stats');
  return useMutation({
    mutationFn: async ({
      items,
      onProgress,
    }: {
      items: api.ImportItem[];
      onProgress?: (done: number, total: number) => void;
    }): Promise<api.ImportResult> => {
      const total: api.ImportResult = { created: 0, updated: 0, skippedDeleted: 0, invalid: [] };
      for (let i = 0; i < items.length; i += api.IMPORT_BATCH_SIZE) {
        const batch = items.slice(i, i + api.IMPORT_BATCH_SIZE);
        const res = await api.importLinks(batch);
        total.created += res.created;
        total.updated += res.updated;
        total.skippedDeleted += res.skippedDeleted;
        total.invalid.push(...res.invalid);
        onProgress?.(Math.min(i + batch.length, items.length), items.length);
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
