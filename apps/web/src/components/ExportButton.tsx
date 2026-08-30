import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { buildExportUrl, type ExportFormat } from '../api/exportUrl';
import { useFilters } from '../state/filters';
import styles from './ExportButton.module.css';

const FORMATS: [ExportFormat, string][] = [
  ['html', 'HTML'],
  ['json', 'JSON'],
  ['csv', 'CSV'],
];

export function ExportButton() {
  const [open, setOpen] = useState(false);
  const { q, unassigned, status } = useFilters();
  // hub is NOT in the filter store — it is the route param on hubs/:hubId.
  // AppToolbar renders inside Layout inside Routes, so useParams reaches it.
  const { hubId } = useParams<{ hubId: string }>();

  const current = (format: ExportFormat): string =>
    buildExportUrl({ format, q, hub: hubId, unassigned, status });

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((v) => !v)}>
        Export
      </button>
      {open && (
        <div className={styles.menu}>
          {FORMATS.map(([format, label]) => (
            <a key={format} className={styles.item} href={current(format)} download
               onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
          <hr className={styles.sep} />
          {/* Ignores the current view on purpose: exporting a filtered subset
              and calling it a backup is the mistake this entry prevents. */}
          <a className={styles.item} href={buildExportUrl({ format: 'json', status: 'all' })} download
             onClick={() => setOpen(false)}>
            Full backup (JSON)
          </a>
        </div>
      )}
    </div>
  );
}
