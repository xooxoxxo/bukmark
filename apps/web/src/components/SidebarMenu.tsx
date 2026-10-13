import { NavLink } from 'react-router';
import { useUpdates } from '../api/queries';
import styles from './SidebarMenu.module.css';

/** The way to Settings: updates, theme and colour, import and export, tokens, log out. */
export function SidebarMenu() {
  const { data } = useUpdates();
  return (
    <div className={styles.wrap}>
      <NavLink to="/settings" className={styles.trigger}>
        Settings{' '}
        {data?.updateAvailable ? (
          <span className={styles.dot} title="Update available">
            <span className={styles.srOnly}> update available</span>
          </span>
        ) : null}
      </NavLink>
    </div>
  );
}
