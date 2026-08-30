import { useState } from 'react';
import { useHubs } from '../api/queries';
import type { LinkDto } from '../api/types';
import { useSelection } from '../state/selection';
import styles from './LinkCard.module.css';
import { Checkbox } from './ui/Checkbox';

export function LinkCard({ link }: { link: LinkDto }) {
  const selected = useSelection((s) => s.selected.has(link.id));
  const toggle = useSelection((s) => s.toggle);
  const { data: hubs } = useHubs();
  const [broken, setBroken] = useState(false);
  const hubName = new Map((hubs?.items ?? []).map((h) => [h.id, h.name]));

  return (
    <div className={styles.card}>
      <div className={styles.media}>
        {link.imageUrl && !broken ? (
          <img src={link.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        ) : (
          <div className={styles.placeholder} aria-hidden="true" />
        )}
        <Checkbox
          className={styles.check}
          checked={selected}
          onCheckedChange={() => toggle(link.id)}
          aria-label={`Select ${link.title || link.url}`}
        />
        <span className={styles.badge}>{link.relevance ?? '–'}</span>
      </div>
      <div className={styles.body}>
        <a href={link.url} target="_blank" rel="noreferrer" className={styles.title}>
          {link.title || link.url}
        </a>
        <div className={styles.chips}>
          {link.hubIds.map((id) => (
            <span key={id} className={styles.chip}>
              {hubName.get(id) ?? '…'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
