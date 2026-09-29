import { NavLink } from 'react-router-dom';
import styles from './SidebarMenu.module.css';

/** The way to Settings: theme and colour, import and export, tokens, log out. */
export function SidebarMenu() {
  return (
    <div className={styles.wrap}>
      <NavLink to="/settings" className={styles.trigger}>
        Settings
      </NavLink>
    </div>
  );
}
