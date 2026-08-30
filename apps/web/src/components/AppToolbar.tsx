import { ExportButton } from './ExportButton';
import styles from './AppToolbar.module.css';

export function AppToolbar() {
  return (
    <header className={styles.bar} aria-label="Application toolbar">
      <ExportButton />
    </header>
  );
}
