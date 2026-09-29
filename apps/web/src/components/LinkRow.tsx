import { useState } from 'react';
import { useHubs } from '../api/queries';
import type { LinkDto } from '../api/types';
import { useEditing } from '../state/editing';
import { useSelection } from '../state/selection';
import styles from './LinkRow.module.css';
import { InlineNoteEditor } from './InlineNoteEditor';
import { Snippet } from './Snippet';
import { Checkbox } from './ui/Checkbox';

export function LinkRow({ link }: { link: LinkDto }) {
  const selected = useSelection((s) => s.selected.has(link.id));
  const toggle = useSelection((s) => s.toggle);
  const edit = useEditing((s) => s.open);
  const { data: hubs } = useHubs();
  const [thumbBroken, setThumbBroken] = useState(false);
  const hubName = new Map((hubs?.items ?? []).map((h) => [h.id, h.name]));

  return (
    <div className={styles.row}>
      <Checkbox
        className={styles.rowCheck}
        checked={selected}
        onCheckedChange={() => toggle(link.id)}
        aria-label={`Select ${link.title}`}
      />
      {link.imageUrl && !thumbBroken ? (
        <img
          className={styles.thumb}
          src={link.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setThumbBroken(true)}
        />
      ) : (
        <span className={styles.thumbEmpty} aria-hidden="true" />
      )}
      <div className={styles.body}>
        <div className={styles.titleLine}>
          <a href={link.url} target="_blank" rel="noreferrer">
            {link.title || link.url}
          </a>
          {link.dupeCount > 1 ? <span className={styles.dupe}>×{link.dupeCount}</span> : null}
          {link.broken ? <span className={styles.gone}>{goneLabel(link)}</span> : null}
        </div>
        <div className={styles.note}>
          <InlineNoteEditor link={link} />
        </div>
        {link.snippet ? <Snippet text={link.snippet} className={styles.snippet} /> : null}
      </div>
      <div className={styles.chips}>
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
  );
}

/** A broken link's marker: what the check found. */
export function goneLabel(link: Pick<LinkDto, 'httpStatus' | 'checkError'>): string {
  return link.checkError === 'dns' ? 'Gone · no domain' : `Gone · ${link.httpStatus}`;
}
