import { useStats } from '../api/queries';
import styles from './StatsBar.module.css';

export function StatsBar() {
  const { data } = useStats();
  if (!data) return <header className={styles.bar} />;
  const chips = [
    `${data.links} links`,
    `${data.active} active`,
    `${data.archived} archived`,
    `${data.hubs} hubs`,
    `${data.unassigned} unassigned`,
  ];
  return (
    <header className={styles.bar}>
      {chips.map((c) => (
        <span key={c} className={styles.chip}>
          {c}
        </span>
      ))}
    </header>
  );
}
