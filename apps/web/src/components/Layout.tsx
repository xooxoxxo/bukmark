import { Outlet } from 'react-router-dom';
import styles from './Layout.module.css';
import { AppToolbar } from './AppToolbar';
import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <AppToolbar />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
