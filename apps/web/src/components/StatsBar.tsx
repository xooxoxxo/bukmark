import { useStats } from '../api/queries';
import { ExportButton } from './ExportButton';
import styles from './StatsBar.module.css';

export function StatsBar() {
  const { data } = useStats();
  if (!data) {
    return (
      <header className={styles.bar}>
        <ExportButton />
      </header>
    );
  }
  const chips = [
    `${data.links} links`,
    `${data.active} active`,
    `${data.archived} archived`,
    `${data.hubs} hubs`,
    `${data.unassigned} unassigned`,
  ];
  return (
    <header className={styles.bar}>
      {chips.map((c, i) => (
        <span key={i} className={styles.chip}>
          {c}
        </span>
      ))}
      <ExportButton />
    </header>
  );
}
