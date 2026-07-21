import { useState } from 'react';
import { useBulkLinks, useHubs } from '../api/queries';
import { useSelection } from '../state/selection';
import styles from './BulkBar.module.css';

export function BulkBar() {
  const selected = useSelection((s) => s.selected);
  const clear = useSelection((s) => s.clear);
  const { data: hubs } = useHubs();
  const bulk = useBulkLinks();
  const [hubId, setHubId] = useState('');

  if (selected.size === 0) return null;
  const ids = [...selected];

  function run(action: 'archive' | 'assign') {
    bulk.mutate(
      action === 'assign' ? { ids, action, hubId } : { ids, action },
      { onSuccess: () => clear() },
    );
  }

  return (
    <div className={styles.bar}>
      <span>{selected.size} selected</span>
      <select value={hubId} onChange={(e) => setHubId(e.target.value)} aria-label="Assign to hub">
        <option value="">Choose hub…</option>
        {(hubs?.items ?? []).map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </select>
      <button onClick={() => run('assign')} disabled={!hubId || bulk.isPending}>
        Assign
      </button>
      <button onClick={() => run('archive')} disabled={bulk.isPending}>
        Archive
      </button>
      <button onClick={clear} className={styles.ghost}>
        Clear
      </button>
      {bulk.isError ? <span className={styles.error}>{bulk.error.message}</span> : null}
    </div>
  );
}
