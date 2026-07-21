import { useLinksInfinite } from '../api/queries';
import { useFilters } from '../state/filters';
import { FilterBar } from './FilterBar';
import { LinksTable } from './LinksTable';

export function LinksView({ hubId }: { hubId?: string }) {
  const q = useFilters((s) => s.q);
  const unassigned = useFilters((s) => s.unassigned);
  const status = useFilters((s) => s.status);

  const query = useLinksInfinite({
    q: q || undefined,
    hub: hubId,
    unassigned: unassigned || undefined,
    status,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;

  return (
    <>
      <FilterBar hubMode={hubId !== undefined} total={total} />
      {query.isError ? <p role="alert">{query.error.message}</p> : null}
      <LinksTable
        rows={rows}
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        fetchNextPage={() => void query.fetchNextPage()}
      />
    </>
  );
}
