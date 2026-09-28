import type { ExportLink } from './types.js';

const UNSORTED = 'Unsorted';
/** The one top-level folder: the same one bookmark sync keeps in the browser. */
const ROOT = 'bukmark';

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function anchor(l: ExportLink): string[] {
  const added = Math.floor(Date.parse(l.firstSeen) / 1000);
  const tags = esc([...l.hubs].sort().join(','));
  const label = esc(l.title === '' ? l.url : l.title);
  const lines = [
    `            <DT><A HREF="${esc(l.url)}" ADD_DATE="${added}" TAGS="${tags}">${label}</A>`,
  ];
  // <DD> is the standard Netscape description element. The v0 exporter never
  // used it, so notes — the record of WHY a link was kept — were lost on export.
  if (l.note !== '') lines.push(`            <DD>${esc(l.note)}`);
  return lines;
}

/**
 * Netscape bookmark HTML — the format Chrome, Firefox and Safari all import.
 *
 * Hubs are many-to-many but Netscape folders are a tree, so a link in two hubs
 * is written under BOTH folders. Duplication is the honest answer: the link
 * genuinely is in both, browsers cope with it, and TAGS carries the full set for
 * importers that understand tags. Choosing a "primary" hub would invent a
 * ranking that does not exist in the data.
 *
 * Every folder sits inside one "bukmark" folder, so importing the file lays
 * links out as bookmark sync does, and none of them land loose among the
 * browser's own bookmarks.
 */
export function toNetscapeHtml(links: ExportLink[]): string {
  const byHub = new Map<string, ExportLink[]>();
  const unsorted: ExportLink[] = [];

  for (const l of links) {
    if (l.hubs.length === 0) {
      unsorted.push(l);
      continue;
    }
    for (const hub of l.hubs) {
      const bucket = byHub.get(hub);
      if (bucket) bucket.push(l);
      else byHub.set(hub, [l]);
    }
  }

  const out: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    `    <DT><H3>${ROOT}</H3>`,
    '    <DL><p>',
  ];

  const folders: [string, ExportLink[]][] = [...byHub.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (unsorted.length > 0) folders.push([UNSORTED, unsorted]);

  for (const [name, items] of folders) {
    out.push(`        <DT><H3>${esc(name)}</H3>`, '        <DL><p>');
    for (const l of items) out.push(...anchor(l));
    out.push('        </DL><p>');
  }

  out.push('    </DL><p>', '</DL><p>', '');
  return out.join('\n');
}
