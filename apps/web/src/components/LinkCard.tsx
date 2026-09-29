import { useState } from 'react';
import { useHubs } from '../api/queries';
import type { LinkDto } from '../api/types';
import { useEditing } from '../state/editing';
import { useSelection } from '../state/selection';
import styles from './LinkCard.module.css';
import { InlineNoteEditor } from './InlineNoteEditor';
import { goneLabel, quoteLabel } from './LinkRow';
import { Snippet } from './Snippet';
import { Checkbox } from './ui/Checkbox';

export function LinkCard({ link }: { link: LinkDto }) {
  const selected = useSelection((s) => s.selected.has(link.id));
  const toggle = useSelection((s) => s.toggle);
  const edit = useEditing((s) => s.open);
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
      </div>
      <div className={styles.body}>
        <a href={link.url} target="_blank" rel="noreferrer" className={styles.title}>
          {link.title || link.url}
        </a>
        {link.snippet ? <Snippet text={link.snippet} className={styles.snippet} /> : null}
        <div className={styles.note}>
          <InlineNoteEditor link={link} compact />
        </div>
        <div className={styles.chips}>
          {link.broken ? <span className={styles.gone}>{goneLabel(link)}</span> : null}
          {link.quoteCount ? <span className={styles.quotes}>{quoteLabel(link.quoteCount)}</span> : null}
          {link.hubIds.map((id) => (
            <span key={id} className={styles.chip}>
              {hubName.get(id) ?? '…'}
            </span>
          ))}
          <button type="button" className={styles.edit} onClick={() => edit(link.id)} aria-label={`Edit ${link.title || link.url}`}>
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}
