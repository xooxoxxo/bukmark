import { useNavigate } from 'react-router-dom';
import { useHubs } from '../api/queries';
import { useFilters } from '../state/filters';
import styles from './FilterBar.module.css';
import { SearchBox } from './SearchBox';
import { Checkbox } from './ui/Checkbox';
import { Select } from './ui/Select';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

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
    <section className={styles.bar} aria-label="Link filters">
      <div className={styles.search}>
        <SearchBox />
      </div>
      <div className={styles.controls}>
        <label className={styles.toggle}>
          <Checkbox
            checked={unassigned}
            onCheckedChange={setUnassigned}
            aria-label="Unassigned only"
          />
          Unassigned
        </label>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as 'active' | 'archived')}
          options={STATUS_OPTIONS}
          ariaLabel="Status"
          className={styles.filterSelect}
        />
        {!hubMode ? (
          <Select
            onValueChange={(value) => navigate(`/hubs/${value}`)}
            options={(hubs?.items ?? []).map((hub) => ({ value: hub.id, label: hub.name }))}
            placeholder="All hubs"
            ariaLabel="Go to hub"
            className={styles.filterSelect}
          />
        ) : null}
        <div className={styles.viewToggle} aria-label="View">
          <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
            List
          </button>
          <button aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
            Grid
          </button>
        </div>
      </div>
      <span className={styles.total}>{total} results</span>
    </section>
  );
}
