import { Outlet } from 'react-router-dom';
import styles from './Layout.module.css';
import { Sidebar } from './Sidebar';
import { StatsBar } from './StatsBar';

export function Layout() {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <StatsBar />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
