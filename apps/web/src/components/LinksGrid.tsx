import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import type { LinkDto } from '../api/types';
import { LinkCard } from './LinkCard';
import styles from './LinksGrid.module.css';

const COLS = 4;

export function LinksGrid({
  rows,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  rows: LinkDto[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const dataRows = Math.ceil(rows.length / COLS);
  const count = dataRows + (hasNextPage ? 1 : 0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 240,
    overscan: 4,
  });
  const items = virtualizer.getVirtualItems();

  useEffect(() => {
    const last = items[items.length - 1];
    if (last && last.index >= dataRows - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [items, dataRows, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div ref={parentRef} className={styles.scroll} aria-label="Links grid">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {items.map((vi) => {
          const slice = rows.slice(vi.index * COLS, vi.index * COLS + COLS);
          return (
            <div
              key={vi.key}
              className={styles.virtualRow}
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              {slice.length > 0 ? (
                <div className={styles.gridRow}>
                  {slice.map((l) => (
                    <LinkCard key={l.id} link={l} />
                  ))}
                </div>
              ) : (
                <div className={styles.loader}>Loading…</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
