import { unzipSync } from 'fflate';
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
  if (typeof q.note === 'string' && q.note.length > QUOTE_MAX_CHARS) return null;
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

/**
 * A link's quotes ride on its item, up to the per-item cap and a byte budget;
 * the rest go as further items with the same url, which the server merges
 * (a text it already has is skipped, so nothing doubles).
 */
function withQuotes(
  byUrl: Map<string, ImportItem>,
  quotesByUrl: Map<string, ImportQuote[]>,
): ImportItem[] {
  const items: ImportItem[] = [];
  for (const [url, item] of byUrl) {
    const [first = [], ...rest] = chunkBySize(quotesByUrl.get(url) ?? [], QUOTES_PER_ITEM);
    items.push({ ...item, ...(first.length === 0 ? {} : { quotes: first }) });
    for (const chunk of rest) {
      items.push({
        url,
        ...(item.title === undefined ? {} : { title: item.title }),
        ...(item.folderPath === undefined ? {} : { folderPath: item.folderPath }),
        quotes: chunk,
      });
    }
  }
  return items;
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

  // A bare metadata_<n>_to_<m>.json from an Omnivore export: links and labels,
  // no highlights (those are in the ZIP's highlights/ folder).
  if (isOmnivoreMetadata(data)) return parseOmnivoreItems(data, new Map());

  const links = (data as { links?: unknown })?.links;
  if (!Array.isArray(links)) {
    throw new UnsupportedFileError('That JSON file has no "links" array — is it a bukmark backup or an Omnivore export?');
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

  const items = withQuotes(byUrl, quotesByUrl);

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

/*
 * Omnivore exports.
 *
 * Omnivore (shut down November 2024) exported a ZIP, written by
 * packages/api/src/jobs/export.ts in omnivore-app/omnivore:
 *   metadata_<from>_to_<to>.json   an array of up to 20 items each:
 *     { id, slug, title, description, author, url, state, readingProgress,
 *       thumbnail, labels: string[], savedAt, updatedAt, publishedAt }
 *     state is 'Archived' | 'Active' | 'Unknown'; not read here
 *   content/<slug>.html or .pdf    the saved page, not read here
 *   highlights/<slug>.md           the item's highlights, see below
 */

interface OmnivoreItem {
  url?: unknown;
  title?: unknown;
  slug?: unknown;
  labels?: unknown;
}

function isOmnivoreMetadata(data: unknown): data is OmnivoreItem[] {
  if (!Array.isArray(data) || data.length === 0) return false;
  return data.every(
    (o) =>
      typeof o === 'object' &&
      o !== null &&
      'url' in o &&
      ('savedAt' in o || 'slug' in o),
  );
}

/**
 * One item's highlights file, as Omnivore's highlightToMarkdown wrote it: the
 * highlights joined by a blank line, each one
 *
 *   > quote text, its later lines NOT prefixed, a blank line inside it as "> "
 *   (blank line) #label #label        when the highlight had labels
 *   (blank line) the note             when it had one; may run several paragraphs
 *
 * and a page note (no quote) as its bare text.
 *
 * So the file is read as paragraphs (split at blank lines), and only a
 * paragraph that starts with ">" starts a highlight; a ">" line inside a note
 * paragraph is part of the note. Every other paragraph belongs to the
 * highlight above it. The format has no delimiter between a highlight's note
 * and a following page note, so a page note that comes after a highlight is
 * read as part of that highlight's note; one before every highlight is
 * dropped (bukmark's import takes no link notes).
 */
export function parseOmnivoreHighlights(markdown: string): ImportQuote[] {
  const paragraphs: string[][] = [];
  let para: string[] = [];
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') {
      if (para.length > 0) paragraphs.push(para);
      para = [];
    } else {
      para.push(line);
    }
  }
  if (para.length > 0) paragraphs.push(para);

  const isQuote = (p: string[] | undefined) => p !== undefined && p[0]!.startsWith('>');
  const quotes: { text: string; notes: string[] }[] = [];

  paragraphs.forEach((p, i) => {
    if (isQuote(p)) {
      // The first line carries the "> " Omnivore prefixed; a later line that is
      // only ">" is a blank line of the original quote.
      const text = p
        .map((l, j) => (j === 0 ? l.replace(/^>\s?/, '') : /^>\s*$/.test(l) ? '' : l))
        .join('\n')
        .trim();
      quotes.push({ text, notes: [] });
      return;
    }
    const current = quotes[quotes.length - 1];
    if (!current) return; // a page note before any highlight
    const text = p.join('\n').trim();
    // Omnivore's highlight labels line ("#idea #later") comes right after the
    // quote and before the note. A lone "#word" line with no note after it is
    // kept as the note: it may be the reader's words, and losing a note is
    // worse than keeping a labels line.
    const next = paragraphs[i + 1];
    const isLabels =
      isQuote(paragraphs[i - 1]) && p.length === 1 && /^#[^\s#]/.test(text) && next !== undefined && !isQuote(next);
    if (!isLabels) current.notes.push(text);
  });

  return quotes.map(({ text, notes }) => ({
    text,
    ...(notes.length === 0 ? {} : { note: notes.join('\n\n') }),
  }));
}

function parseOmnivoreItems(
  data: OmnivoreItem[],
  highlightsBySlug: Map<string, string>,
): ParsedFile {
  const byUrl = new Map<string, ImportItem>();
  const quotesByUrl = new Map<string, ImportQuote[]>();
  let nonWeb = 0;
  let duplicates = 0;
  let quotesNotRestored = 0;

  const readHighlights = (slug: unknown): ImportQuote[] => {
    const md = typeof slug === 'string' ? highlightsBySlug.get(slug.normalize('NFC')) : undefined;
    if (md === undefined) return [];
    const raw = parseOmnivoreHighlights(md);
    const ok = raw.map(readQuote).filter((q): q is ImportQuote => q !== null);
    quotesNotRestored += raw.length - ok.length;
    return ok;
  };

  for (const raw of data) {
    const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
    if (!isWebUrl(url)) {
      nonWeb += 1;
      continue;
    }
    if (byUrl.has(url)) {
      duplicates += 1;
      quotesByUrl.get(url)!.push(...readHighlights(raw.slug));
      continue;
    }
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const labels = Array.isArray(raw.labels)
      ? raw.labels.filter((l): l is string => typeof l === 'string' && l.trim() !== '')
      : [];
    quotesByUrl.set(url, readHighlights(raw.slug));
    byUrl.set(url, {
      url,
      ...(title === '' ? {} : { title }),
      // Labels are tags, so they become the same sorting hint a CSV's tags do.
      ...(labels.length === 0 ? {} : { folderPath: `tags: ${labels.join(', ')}` }),
    });
  }

  return {
    items: withQuotes(byUrl, quotesByUrl),
    nonWeb,
    duplicates,
    ...(quotesNotRestored === 0 ? {} : { quotesNotRestored }),
  };
}

const METADATA_FILE = /(?:^|\/)metadata_\d+_to_\d+\.json$/;
const HIGHLIGHTS_FILE = /(?:^|\/)highlights\/([^/]+)\.md$/;

/**
 * The whole ZIP is read into memory and unpacked on the main thread, so a
 * multi-gigabyte export (content/ holds every saved page) would freeze the tab
 * or fail with an unhelpful RangeError. Over this, it is refused up front.
 */
export const ZIP_MAX_BYTES = 1024 * 1024 * 1024;
/** A metadata or highlights file over this is not a real one; it is not inflated. */
const ZIP_ENTRY_MAX_BYTES = 50 * 1024 * 1024;

/** Throws before a ZIP is read when it is too large to read in the browser. */
export function checkZipSize(bytes: number): void {
  if (bytes > ZIP_MAX_BYTES) {
    throw new UnsupportedFileError(
      'That export is too large to read in the browser. Delete its content folder and zip it again, or import a metadata_*.json file.',
    );
  }
}

/**
 * An Omnivore export ZIP. Only the metadata and highlights entries are
 * inflated: content/ holds every saved page, often most of the archive's size,
 * and nothing in it is imported. Entries may sit under a top-level folder, as
 * when the export was unzipped and zipped again.
 */
export function parseOmnivoreZip(bytes: Uint8Array): ParsedFile {
  checkZipSize(bytes.length);
  let entries: Record<string, Uint8Array>;
  let tooLarge: string | undefined;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        if (!METADATA_FILE.test(f.name) && !HIGHLIGHTS_FILE.test(f.name)) return false;
        if (f.originalSize > ZIP_ENTRY_MAX_BYTES) {
          tooLarge ??= f.name;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new UnsupportedFileError('That ZIP file could not be read.');
  }
  // A skipped metadata or highlights file would drop links or quotes unsaid.
  if (tooLarge !== undefined) {
    throw new UnsupportedFileError(`${tooLarge} in that ZIP is too large to read.`);
  }

  const decoder = new TextDecoder();
  const items: OmnivoreItem[] = [];
  const highlightsBySlug = new Map<string, string>();
  let metadataFiles = 0;
  // Sorted so metadata_0_to_20 comes before metadata_20_to_40.
  const names = Object.keys(entries).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  for (const name of names) {
    const text = decoder.decode(entries[name]);
    const highlight = HIGHLIGHTS_FILE.exec(name);
    if (highlight) {
      // NFC: a ZIP made again on macOS stores non-ASCII names decomposed (NFD).
      highlightsBySlug.set(highlight[1]!.normalize('NFC'), text);
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new UnsupportedFileError(`${name} in that ZIP is not valid JSON.`);
    }
    if (!Array.isArray(data)) {
      throw new UnsupportedFileError(`${name} in that ZIP is not an Omnivore item list.`);
    }
    metadataFiles += 1;
    items.push(...(data as OmnivoreItem[]));
  }

  if (metadataFiles === 0) {
    throw new UnsupportedFileError(
      'That ZIP has no metadata_*.json files — is it an Omnivore export?',
    );
  }
  return parseOmnivoreItems(items, highlightsBySlug);
}

export function parseImportFile(filename: string, text: string): ParsedFile {
  const name = filename.toLowerCase();
  if (name.endsWith('.json')) return parseBackupJson(text);
  if (name.endsWith('.html') || name.endsWith('.htm')) return parseNetscapeHtml(text);
  if (name.endsWith('.csv')) return parseCSV(text);
  throw new UnsupportedFileError(
    'Choose a bookmarks HTML file, a CSV file, a bukmark JSON backup, or an Omnivore export ZIP.',
  );
}

export function isZipFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.zip');
}

/**
 * The entry point for a file read as bytes: a ZIP (an Omnivore export) is
 * unpacked; any other file is decoded as UTF-8 text and parsed as
 * parseImportFile would.
 */
export function parseImportBytes(filename: string, bytes: Uint8Array): ParsedFile {
  if (isZipFile(filename)) return parseOmnivoreZip(bytes);
  return parseImportFile(filename, new TextDecoder().decode(bytes));
}
