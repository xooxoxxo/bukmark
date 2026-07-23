import { useNavigate } from 'react-router-dom';
import { useHubs } from '../api/queries';
import { useFilters } from '../state/filters';
import styles from './FilterBar.module.css';
import { SearchBox } from './SearchBox';

export function FilterBar({ hubMode, total }: { hubMode: boolean; total: number }) {
  const unassigned = useFilters((s) => s.unassigned);
  const setUnassigned = useFilters((s) => s.setUnassigned);
  const status = useFilters((s) => s.status);
  const setStatus = useFilters((s) => s.setStatus);
  const view = useFilters((s) => s.view);
  const setView = useFilters((s) => s.setView);
  const { data: hubs } = useHubs();
  const navigate = useNavigate();

  return (
    <div className={styles.bar}>
      <SearchBox />
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={unassigned}
          onChange={(e) => setUnassigned(e.target.checked)}
          aria-label="Unassigned only"
        />
        Unassigned
      </label>
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value as 'active' | 'archived')}
        aria-label="Status"
      >
        <option value="active">Active</option>
        <option value="archived">Archived</option>
      </select>
      {!hubMode ? (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) navigate(`/hubs/${e.target.value}`);
          }}
          aria-label="Go to hub"
        >
          <option value="">All hubs</option>
          {(hubs?.items ?? []).map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      ) : null}
      <div className={styles.viewToggle}>
        <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
          List
        </button>
        <button aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
          Grid
        </button>
      </div>
      <span className={styles.total}>{total} results</span>
    </div>
  );
}
