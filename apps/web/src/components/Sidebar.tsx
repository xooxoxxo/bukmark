import { useState, type FormEvent } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useCreateHub, useHubs, useStats } from '../api/queries';
import { useFilters } from '../state/filters';
import { SidebarMenu } from './SidebarMenu';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const { data } = useHubs();
  const { data: stats } = useStats();
  const createHub = useCreateHub();
  const [name, setName] = useState('');
  const unassigned = useFilters((state) => state.unassigned);
  const setUnassigned = useFilters((state) => state.setUnassigned);
  const broken = useFilters((state) => state.broken);
  const setBroken = useFilters((state) => state.setBroken);
  const location = useLocation();
  const navigate = useNavigate();
  const atRoot = location.pathname === '/';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || createHub.isPending) return;
    createHub.mutate({ name: trimmed }, { onSuccess: () => setName('') });
  }

  return (
    <nav className={styles.sidebar}>
      <h1 className={styles.title}>
        <img src="/logo-mark.svg" alt="" className={styles.logo} />
        bukmark
      </h1>
      <NavLink
        to="/"
        end
        onClick={() => {
          setUnassigned(false);
          setBroken(false);
        }}
        className={({ isActive }) => (isActive && !unassigned && !broken ? styles.active : styles.item)}
      >
        All links
      </NavLink>
      <button
        type="button"
        className={`${atRoot && unassigned && !broken ? styles.active : styles.item} ${styles.filterItem}`}
        onClick={() => {
          setUnassigned(true);
          setBroken(false);
          navigate('/');
        }}
        aria-pressed={atRoot && unassigned}
      >
        Unassigned
        {stats ? <span className={styles.count}>{stats.unassigned}</span> : null}
      </button>
      {stats && stats.broken > 0 ? (
        <button
          type="button"
          className={`${atRoot && broken ? styles.active : styles.item} ${styles.filterItem}`}
          onClick={() => {
            setBroken(true);
            setUnassigned(false);
            navigate('/');
          }}
          aria-pressed={atRoot && broken}
        >
          Broken links
          <span className={styles.count}>{stats.broken}</span>
        </button>
      ) : null}
      <ul className={styles.hubList}>
        {(data?.items ?? []).map((hub) => (
          <li key={hub.id}>
            <NavLink
              to={`/hubs/${hub.id}`}
              onClick={() => {
                setUnassigned(false);
                setBroken(false);
              }}
              className={({ isActive }) => (isActive ? styles.active : styles.item)}
            >
              {hub.name} <span className={styles.count}>{hub.linkCount}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className={styles.newHub}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New hub…"
          aria-label="New hub name"
        />
        <button type="submit">Add</button>
      </form>
      {createHub.isError ? <p className={styles.error}>{createHub.error.message}</p> : null}
      <SidebarMenu />
    </nav>
  );
}
