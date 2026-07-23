import { useLinksInfinite } from '../api/queries';
import { useFilters } from '../state/filters';
import { useSelection } from '../state/selection';
import { BulkBar } from './BulkBar';
import { FilterBar } from './FilterBar';
import { LinksGrid } from './LinksGrid';
import { LinksTable } from './LinksTable';

export function LinksView({ hubId }: { hubId?: string }) {
  const q = useFilters((s) => s.q);
  const unassigned = useFilters((s) => s.unassigned);
  const status = useFilters((s) => s.status);
  const view = useFilters((s) => s.view);
  const selected = useSelection((s) => s.selected);
  const setMany = useSelection((s) => s.setMany);

  const query = useLinksInfinite({
    q: q || undefined,
    hub: hubId,
    unassigned: unassigned || undefined,
    status,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  const allLoadedSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <>
      <FilterBar hubMode={hubId !== undefined} total={total} />
      {rows.length > 0 ? (
        <label>
          <input
            type="checkbox"
            checked={allLoadedSelected}
            onChange={(e) =>
              setMany(
                rows.map((r) => r.id),
                e.target.checked,
              )
            }
            aria-label="Select all loaded"
          />{' '}
          Select all loaded
        </label>
      ) : null}
      <BulkBar />
      {query.isError ? <p role="alert">{query.error.message}</p> : null}
      {view === 'grid' ? (
        <LinksGrid
          rows={rows}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          fetchNextPage={() => void query.fetchNextPage()}
        />
      ) : (
        <LinksTable
          rows={rows}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          fetchNextPage={() => void query.fetchNextPage()}
        />
      )}
    </>
  );
}
