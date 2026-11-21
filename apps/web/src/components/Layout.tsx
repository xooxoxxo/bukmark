import { Outlet, useMatch } from 'react-router';
import styles from './Layout.module.css';
import { AppToolbar } from './AppToolbar';
import { Sidebar } from './Sidebar';

export function Layout() {
  const isReview = useMatch('/review') !== null;
  const isImport = useMatch('/imports/*') !== null;
  const isStart = useMatch('/start') !== null;
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        {isReview || isStart || isImport ? null : <AppToolbar />}
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
