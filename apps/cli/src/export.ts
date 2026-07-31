// SUPERSEDED — v0 only. This reads data/store.json and groups by
// `triage.category`, both of which are v0 CLI structures. Real data has lived
// in Postgres with hubs since m1, so this exports a model nothing writes to any
// more. The current exporter is GET /api/export (apps/server/src/export/).
// Left in place because the CLI's own future is undecided; do not extend it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LinkRecord, Store } from '@bookmarkt/shared';

function escHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escCsv(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function byRank(a: LinkRecord, b: LinkRecord): number {
  const rel = (b.triage?.relevance ?? 0) - (a.triage?.relevance ?? 0);
  if (rel !== 0) return rel;
  if (b.dupeCount !== a.dupeCount) return b.dupeCount - a.dupeCount;
  return a.title.localeCompare(b.title);
}

export function exportAll(
  store: Store,
  outputDir: string,
): { html: string; csv: string; count: number } {
  const kept = Object.values(store.links).filter((l) => !l.junk && l.triage?.keep);
  const byCategory = new Map<string, LinkRecord[]>();
  for (const l of kept) {
    const c = l.triage!.category;
    byCategory.set(c, [...(byCategory.get(c) ?? []), l]);
  }

  const html: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];
  for (const [category, links] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    html.push(`    <DT><H3>${escHtml(category)}</H3>`, '    <DL><p>');
    for (const l of links.sort(byRank)) {
      const added = Math.floor(Date.parse(l.firstSeen) / 1000);
      const title = escHtml(l.title === '' ? l.url : l.title);
      html.push(
        `        <DT><A HREF="${escHtml(l.url)}" ADD_DATE="${added}" TAGS="${escHtml(category)}">${title}</A>`,
      );
    }
    html.push('    </DL><p>');
  }
  html.push('</DL><p>', '');

  const csv: string[] = ['url,title,category,relevance,explanation,dupeCount,firstSeen'];
  for (const l of [...kept].sort(byRank)) {
    const t = l.triage!;
    csv.push(
      [l.url, l.title, t.category, String(t.relevance), t.explanation, String(l.dupeCount), l.firstSeen]
        .map(escCsv)
        .join(','),
    );
  }
  csv.push('');

  mkdirSync(outputDir, { recursive: true });
  const htmlPath = join(outputDir, 'bookmarks.html');
  const csvPath = join(outputDir, 'links.csv');
  writeFileSync(htmlPath, html.join('\n'));
  writeFileSync(csvPath, csv.join('\n'));
  return { html: htmlPath, csv: csvPath, count: kept.length };
}
