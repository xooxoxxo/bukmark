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
