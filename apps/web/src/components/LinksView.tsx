import { useEffect } from 'react';
import { useLinksInfinite } from '../api/queries';
import { useFilters } from '../state/filters';
import { useSelection } from '../state/selection';
import { BulkBar } from './BulkBar';
import { FilterBar } from './FilterBar';
import { LinkEditor } from './LinkEditor';
import { LinksGrid } from './LinksGrid';
import { LinksTable } from './LinksTable';
import styles from './LinksView.module.css';
import { Checkbox } from './ui/Checkbox';

export function LinksView({ hubId }: { hubId?: string }) {
  const q = useFilters((s) => s.q);
  const unassigned = useFilters((s) => s.unassigned);
  const status = useFilters((s) => s.status);
  const broken = useFilters((s) => s.broken);
  const sort = useFilters((s) => s.sort);
  const view = useFilters((s) => s.view);
  const selected = useSelection((s) => s.selected);
  const setMany = useSelection((s) => s.setMany);
  const clear = useSelection((s) => s.clear);

  const scopeKey = `${hubId ?? 'all'}\u0000${q}\u0000${unassigned}\u0000${status}\u0000${broken}`;
  useEffect(() => clear(), [scopeKey, clear]);

  const query = useLinksInfinite({
    q: q || undefined,
    hub: hubId,
    unassigned: unassigned || undefined,
    status,
    broken: broken || undefined,
    sort,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  const selectedLinks = rows.filter((row) => selected.has(row.id));
  const allLoadedSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const filtered = Boolean(q || unassigned || broken || status === 'archived' || hubId);

  return (
    <>
      <LinkEditor />
      <FilterBar hubMode={hubId !== undefined} total={total} />
      {rows.length > 0 ? (
        <div className={styles.selectionToolbar} data-testid="selection-toolbar">
          <label className={styles.selectAll}>
            <Checkbox
              checked={allLoadedSelected}
              onCheckedChange={(checked) =>
                setMany(
                  rows.map((r) => r.id),
                  checked,
                )
              }
              aria-label="Select all loaded"
            />
            Select all loaded
          </label>
          <BulkBar selectedLinks={selectedLinks} />
        </div>
      ) : null}
      {query.isPending ? (
        <div className={styles.state} aria-live="polite">
          <h2>Loading links</h2>
          <p>Opening the workbench.</p>
        </div>
      ) : query.isError ? (
        <div className={`${styles.state} ${styles.error}`} role="alert">
          <h2>Links could not load</h2>
          <p>{query.error.message}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className={styles.state}>
          <h2>{filtered ? 'Nothing matches this view' : 'No links here yet'}</h2>
          <p>
            {filtered
              ? 'Try another search or filter.'
              : 'Capture a page with the extension; it will land here unsorted.'}
          </p>
        </div>
      ) : view === 'grid' ? (
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
