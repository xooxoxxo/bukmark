import { chunkBySize } from '../api/importSize';
import type { ImportItem, ImportOrphanQuote, ImportQuote } from '../api/client';

export interface ParsedFile {
  items: ImportItem[];
  /** Entries that are not web links: bookmarklets, `place:` queries, feeds. */
  nonWeb: number;
  /** Same url listed more than once in the file, collapsed to one item. */
  duplicates: number;
  /** Quotes whose page is gone, from a bukmark backup. Absent when there are none. */
  orphanQuotes?: ImportOrphanQuote[];
  /** Quotes in a backup that cannot be restored (empty text, or over the server's length limit). Absent when none. */
  quotesNotRestored?: number;
}

// The server's limits. A quote over them would fail the whole batch, so it is
// left out and counted in ParsedFile.quotesNotRestored instead.
const QUOTE_MAX_CHARS = 10000;
/** The server takes this many quotes per item; a link with more is sent as several items. */
const QUOTES_PER_ITEM = 200;

function readQuote(raw: unknown): ImportQuote | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const q = raw as Record<string, unknown>;
  if (typeof q.text !== 'string' || q.text.trim() === '' || q.text.length > QUOTE_MAX_CHARS) return null;
  return {
    text: q.text,
    ...(typeof q.note === 'string' && q.note !== '' ? { note: q.note } : {}),
    ...(typeof q.createdAt === 'string' && q.createdAt !== '' ? { createdAt: q.createdAt } : {}),
  };
}

function readOrphanQuote(raw: unknown): ImportOrphanQuote | null {
  const quote = readQuote(raw);
  const q = raw as Record<string, unknown>;
  if (!quote || typeof q.sourceUrl !== 'string' || q.sourceUrl.trim() === '') return null;
  return {
    ...quote,
    sourceUrl: q.sourceUrl,
    ...(typeof q.sourceTitle === 'string' && q.sourceTitle !== '' ? { sourceTitle: q.sourceTitle } : {}),
  };
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
  quotes?: unknown;
}

/**
 * bukmark's own backup JSON, so a file this app produced can come back in.
 *
 * Quotes are restored: each link's own, and the top-level orphan quotes of
 * pages that were deleted.
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
  const quotesByUrl = new Map<string, ImportQuote[]>();
  let nonWeb = 0;
  let duplicates = 0;
  let quotesNotRestored = 0;

  const readQuotes = (raw: unknown): ImportQuote[] => {
    if (!Array.isArray(raw)) return [];
    const ok = raw.map(readQuote).filter((q): q is ImportQuote => q !== null);
    quotesNotRestored += raw.length - ok.length;
    return ok;
  };

  for (const raw of links as BackupLink[]) {
    const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
    if (!isWebUrl(url)) {
      nonWeb += 1;
      continue;
    }
    if (byUrl.has(url)) {
      duplicates += 1;
      // The same page listed twice is one link, but its quotes are not thrown away.
      quotesByUrl.get(url)!.push(...readQuotes(raw.quotes));
      continue;
    }
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const hubs = Array.isArray(raw.hubs)
      ? raw.hubs.filter((h): h is string => typeof h === 'string')
      : [];
    quotesByUrl.set(url, readQuotes(raw.quotes));
    byUrl.set(url, {
      url,
      ...(title === '' ? {} : { title }),
      // Hubs are parallel, not nested, so they are joined as a list rather than
      // a path: this is a hint for sorting, not a folder location.
      ...(hubs.length === 0 ? {} : { folderPath: hubs.join(', ') }),
    });
  }

  // A link's quotes ride on its item, up to the per-item cap and a byte budget;
  // the rest go as further items with the same url, which the server merges
  // (a text it already has is skipped, so nothing doubles).
  const items: ImportItem[] = [];
  for (const [url, item] of byUrl) {
    const [first = [], ...rest] = chunkBySize(quotesByUrl.get(url) ?? [], QUOTES_PER_ITEM);
    items.push({ ...item, ...(first.length === 0 ? {} : { quotes: first }) });
    for (const chunk of rest) {
      items.push({ url, ...(item.title === undefined ? {} : { title: item.title }), quotes: chunk });
    }
  }

  const rawOrphans = (data as { orphanQuotes?: unknown }).orphanQuotes;
  const orphanQuotes = Array.isArray(rawOrphans)
    ? rawOrphans.map(readOrphanQuote).filter((q): q is ImportOrphanQuote => q !== null)
    : [];
  if (Array.isArray(rawOrphans)) quotesNotRestored += rawOrphans.length - orphanQuotes.length;

  return {
    items,
    nonWeb,
    duplicates,
    ...(orphanQuotes.length === 0 ? {} : { orphanQuotes }),
    ...(quotesNotRestored === 0 ? {} : { quotesNotRestored }),
  };
}

/**
 * RFC 4180 records: quoted fields, doubled quotes, CRLF or LF, a leading BOM.
 * The whole text is read in one pass, not split into lines first, because a
 * quoted field may hold a newline (Raindrop notes and excerpts often do), and
 * splitting first would cut that record in two. Blank lines are dropped.
 */
function parseCSVRecords(text: string): string[][] {
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  const endRecord = () => {
    record.push(field);
    if (record.some((f) => f.trim() !== '')) records.push(record);
    record = [];
    field = '';
  };

  for (let i = 0; i < src.length; i++) {
    const char = src[i];
    if (inQuotes) {
      if (char === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && src[i + 1] === '\n') i += 1;
      endRecord();
    } else {
      field += char;
    }
  }
  if (field !== '' || record.length > 0) endRecord();
  return records;
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
  const records = parseCSVRecords(text);
  if (records.length === 0) {
    throw new UnsupportedFileError('That CSV file is empty.');
  }

  const headers = records[0]!;
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

  for (const fields of records.slice(1)) {
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
