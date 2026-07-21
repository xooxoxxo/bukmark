import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import type { LinkDto } from '../api/types';
import { LinkRow } from './LinkRow';
import styles from './LinksTable.module.css';

export function LinksTable({
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
  const count = rows.length + (hasNextPage ? 1 : 0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();

  useEffect(() => {
    const last = items[items.length - 1];
    if (last && last.index >= rows.length - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [items, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div ref={parentRef} className={styles.scroll}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {items.map((vi) => {
          const link = rows[vi.index];
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              className={styles.virtualRow}
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              {link ? <LinkRow link={link} /> : <div className={styles.loader}>Loading…</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
