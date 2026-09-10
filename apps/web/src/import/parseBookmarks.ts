import type { ImportItem } from '../api/client';

export interface ParsedFile {
  items: ImportItem[];
  /** Entries that are not web links: bookmarklets, `place:` queries, feeds. */
  nonWeb: number;
  /** Same url listed more than once in the file, collapsed to one item. */
  duplicates: number;
}

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFileError';
  }
}

function isWebUrl(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  return s.startsWith('http://') || s.startsWith('https://');
}

/**
 * The folder chain an anchor sits in, root first.
 *
 * Netscape HTML is famously malformed — `<DT>` and `<p>` are never closed — so
 * the parsed tree varies between exporters: a folder's `<DL>` may be a sibling
 * of the `<DT><H3>` that names it, or a child of that same `<DT>`. Both shapes
 * are checked rather than assuming one, because guessing wrong silently drops
 * every folder name.
 */
function folderChain(anchor: Element): string[] {
  const names: string[] = [];
  let node: Element | null = anchor.parentElement;

  while (node) {
    if (node.tagName === 'DL') {
      const heading =
        node.previousElementSibling?.querySelector(':scope > h3') ??
        (node.previousElementSibling?.tagName === 'H3' ? node.previousElementSibling : null) ??
        (node.parentElement?.tagName === 'DT'
          ? node.parentElement.querySelector(':scope > h3')
          : null);
      const name = heading?.textContent?.trim();
      if (name) names.unshift(name);
    }
    node = node.parentElement;
  }
  return names;
}

/**
 * Netscape bookmark HTML — what Chrome, Firefox and Safari all export.
 *
 * Folder names become the item's folderPath, which the server records as a
 * capture hint rather than a hub: an import lands unsorted on purpose, and the
 * hint is what Claude reads when you later ask it to sort.
 */
export function parseNetscapeHtml(html: string): ParsedFile {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const anchors = [...doc.querySelectorAll('a[href]')];
  if (anchors.length === 0) {
    throw new UnsupportedFileError('No bookmarks found in that HTML file.');
  }

  const byUrl = new Map<string, ImportItem>();
  let nonWeb = 0;
  let duplicates = 0;

  for (const a of anchors) {
    const href = a.getAttribute('href') ?? '';
    if (!isWebUrl(href)) {
      nonWeb += 1;
      continue;
    }
    const url = href.trim();
    if (byUrl.has(url)) {
      duplicates += 1;
      continue;
    }
    const title = (a.textContent ?? '').trim();
    const folderPath = folderChain(a).join('/');
    byUrl.set(url, {
      url,
      ...(title === '' ? {} : { title }),
      ...(folderPath === '' ? {} : { folderPath }),
    });
  }

  return { items: [...byUrl.values()], nonWeb, duplicates };
}

interface BackupLink {
  url?: unknown;
  title?: unknown;
  hubs?: unknown;
}

/**
 * bukmark's own backup JSON, so a file this app produced can come back in.
 *
 * Hub membership is NOT restored — the import path deliberately creates no
 * hubs — so a restored link arrives unsorted with its old hub names carried as
 * a hint. Callers surface that; it should not be a surprise found later.
 */
export function parseBackupJson(text: string): ParsedFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new UnsupportedFileError('That file is not valid JSON.');
  }

  const links = (data as { links?: unknown })?.links;
  if (!Array.isArray(links)) {
    throw new UnsupportedFileError('That JSON file has no "links" array — is it a bukmark backup?');
  }

  const byUrl = new Map<string, ImportItem>();
  let nonWeb = 0;
  let duplicates = 0;

  for (const raw of links as BackupLink[]) {
    const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
    if (!isWebUrl(url)) {
      nonWeb += 1;
      continue;
    }
    if (byUrl.has(url)) {
      duplicates += 1;
      continue;
    }
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const hubs = Array.isArray(raw.hubs)
      ? raw.hubs.filter((h): h is string => typeof h === 'string')
      : [];
    byUrl.set(url, {
      url,
      ...(title === '' ? {} : { title }),
      // Hubs are parallel, not nested, so they are joined as a list rather than
      // a path: this is a hint for sorting, not a folder location.
      ...(hubs.length === 0 ? {} : { folderPath: hubs.join(', ') }),
    });
  }

  return { items: [...byUrl.values()], nonWeb, duplicates };
}

export function parseImportFile(filename: string, text: string): ParsedFile {
  const name = filename.toLowerCase();
  if (name.endsWith('.json')) return parseBackupJson(text);
  if (name.endsWith('.html') || name.endsWith('.htm')) return parseNetscapeHtml(text);
  throw new UnsupportedFileError('Choose a bookmarks HTML file or a bukmark JSON backup.');
}
