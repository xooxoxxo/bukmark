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

/**
 * RFC 4180 CSV parser with support for quoted fields, doubled quotes, CRLF/LF,
 * BOM, and embedded newlines. Returns an array of strings, one per column.
 */
function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          // Doubled quote: add one quote to the field
          field += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i += 1;
        }
      } else {
        field += char;
        i += 1;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i += 1;
      } else if (char === ',') {
        fields.push(field);
        field = '';
        i += 1;
      } else {
        field += char;
        i += 1;
      }
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Split CSV into lines, handling CRLF and LF, plus BOM if present.
 */
function splitCSVLines(text: string): string[] {
  // Strip BOM if present
  let clean = text.startsWith('﻿') ? text.slice(1) : text;
  // Normalize to LF
  clean = clean.replace(/\r\n/g, '\n');
  return clean.split('\n').filter((line) => line.trim().length > 0);
}

/**
 * CSV export from Raindrop, Pocket, Instapaper, Linkwarden, or a generic
 * spreadsheet. The parser detects headers case-insensitively and maps:
 * - url/link/href → url (required)
 * - title/name → title
 * - note/description/excerpt/selection → note (added to folderPath as hint)
 * - folder/collection/category → folderPath
 * - tags/labels → included in folderPath as a hint
 */
export function parseCSV(text: string): ParsedFile {
  const lines = splitCSVLines(text);
  if (lines.length === 0) {
    throw new UnsupportedFileError('That CSV file is empty.');
  }

  const headerLine = lines[0]!;
  const headers = parseCSVRow(headerLine);
  const normalizedHeaders = headers.map((h: string) => h.toLowerCase().trim());

  // Detect column indices
  const urlIdx = normalizedHeaders.findIndex(
    (h) => h === 'url' || h === 'link' || h === 'href' || h === 'address',
  );
  const titleIdx = normalizedHeaders.findIndex((h) => h === 'title' || h === 'name');
  const noteIdx = normalizedHeaders.findIndex(
    (h) => h === 'note' || h === 'description' || h === 'excerpt' || h === 'selection',
  );
  const folderIdx = normalizedHeaders.findIndex(
    (h) => h === 'folder' || h === 'collection' || h === 'category',
  );
  const tagsIdx = normalizedHeaders.findIndex(
    (h) => h === 'tags' || h === 'labels' || h === 'keywords',
  );

  if (urlIdx === -1) {
    throw new UnsupportedFileError(
      'This CSV has no url column (expected "url", "link", "href", or "address").',
    );
  }

  const byUrl = new Map<string, ImportItem>();
  let nonWeb = 0;
  let duplicates = 0;

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVRow(lines[i]!);
    const url = fields[urlIdx]?.trim() ?? '';

    if (!isWebUrl(url)) {
      nonWeb += 1;
      continue;
    }

    if (byUrl.has(url)) {
      duplicates += 1;
      continue;
    }

    const title = titleIdx >= 0 ? (fields[titleIdx]?.trim() ?? '') : '';
    const note = noteIdx >= 0 ? (fields[noteIdx]?.trim() ?? '') : '';
    const folder = folderIdx >= 0 ? (fields[folderIdx]?.trim() ?? '') : '';
    const tags = tagsIdx >= 0 ? (fields[tagsIdx]?.trim() ?? '') : '';

    // Build folderPath as a hint: folder name, with tags appended if present.
    // Notes are collected but not used in folderPath since the server doesn't
    // accept notes on import; they are silently dropped.
    const pathParts: string[] = [];
    if (folder) pathParts.push(folder);
    if (tags) pathParts.push(`tags: ${tags}`);
    const folderPath = pathParts.join(' / ');

    byUrl.set(url, {
      url,
      ...(title === '' ? {} : { title }),
      ...(folderPath === '' ? {} : { folderPath }),
    });
  }

  return { items: [...byUrl.values()], nonWeb, duplicates };
}

export function parseImportFile(filename: string, text: string): ParsedFile {
  const name = filename.toLowerCase();
  if (name.endsWith('.json')) return parseBackupJson(text);
  if (name.endsWith('.html') || name.endsWith('.htm')) return parseNetscapeHtml(text);
  if (name.endsWith('.csv')) return parseCSV(text);
  throw new UnsupportedFileError(
    'Choose a bookmarks HTML file, a CSV file, or a bukmark JSON backup.',
  );
}
