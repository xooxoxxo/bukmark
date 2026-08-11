import { useState, type FormEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { useCreateHub, useHubs } from '../api/queries';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const { data } = useHubs();
  const createHub = useCreateHub();
  const [name, setName] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || createHub.isPending) return;
    createHub.mutate({ name: trimmed }, { onSuccess: () => setName('') });
  }

  return (
    <nav className={styles.sidebar}>
      <h1 className={styles.title}>
        <img src="/logo-mark.png" alt="" className={styles.logo} />
        bukmark
      </h1>
      <NavLink to="/" end className={({ isActive }) => (isActive ? styles.active : styles.item)}>
        All links
      </NavLink>
      <ul className={styles.hubList}>
        {(data?.items ?? []).map((hub) => (
          <li key={hub.id}>
            <NavLink
              to={`/hubs/${hub.id}`}
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
    </nav>
  );
}
