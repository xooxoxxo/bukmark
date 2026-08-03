import type { ExportLink } from './types.js';

const HEADER = 'url,title,note,hubs,relevance,status,dupeCount,firstSeen';

/** RFC 4180: quote when the field contains a comma, quote or newline; double internal quotes. */
function cell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(links: ExportLink[]): string {
  const rows = [HEADER];
  for (const l of links) {
    rows.push(
      [
        l.url,
        l.title,
        l.note,
        // Semicolons, not commas — a comma here would look like a new column.
        l.hubs.join(';'),
        l.relevance === null ? '' : String(l.relevance),
        l.status,
        String(l.dupeCount),
        l.firstSeen,
      ]
        .map(cell)
        .join(','),
    );
  }
  rows.push('');
  return rows.join('\n');
}
