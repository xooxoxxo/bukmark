import { useState } from 'react';
import { useHubs } from '../api/queries';
import type { LinkDto } from '../api/types';
import { useSelection } from '../state/selection';
import styles from './LinkRow.module.css';

export function LinkRow({ link }: { link: LinkDto }) {
  const selected = useSelection((s) => s.selected.has(link.id));
  const toggle = useSelection((s) => s.toggle);
  const { data: hubs } = useHubs();
  const [thumbBroken, setThumbBroken] = useState(false);
  const hubName = new Map((hubs?.items ?? []).map((h) => [h.id, h.name]));

  return (
    <div className={styles.row}>
      <input
        type="checkbox"
        checked={selected}
        onChange={() => toggle(link.id)}
        aria-label={`Select ${link.title}`}
      />
      <span className={styles.badge}>{link.relevance ?? '–'}</span>
      {link.imageUrl && !thumbBroken ? (
        <img
          className={styles.thumb}
          src={link.imageUrl}
          alt=""
          loading="lazy"
          onError={() => setThumbBroken(true)}
        />
      ) : null}
      <div className={styles.body}>
        <div className={styles.titleLine}>
          <a href={link.url} target="_blank" rel="noreferrer">
            {link.title || link.url}
          </a>
          {link.dupeCount > 1 ? <span className={styles.dupe}>×{link.dupeCount}</span> : null}
        </div>
        {link.note ? <p className={styles.note}>{link.note}</p> : null}
      </div>
      <div className={styles.chips}>
        {link.hubIds.map((id) => (
          <span key={id} className={styles.chip}>
            {hubName.get(id) ?? '…'}
          </span>
        ))}
      </div>
    </div>
  );
}
