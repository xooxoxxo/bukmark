import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  UnsupportedFileError,
  ZIP_MAX_BYTES,
  checkZipSize,
  parseBackupJson,
  parseImportBytes,
  parseImportFile,
  parseOmnivoreHighlights,
} from './parseBookmarks';

/**
 * Omnivore's own highlightToMarkdown (packages/api/src/utils/parser.ts in
 * omnivore-app/omnivore), so the fixtures are byte-for-byte what its exporter
 * wrote rather than our guess at it.
 */
interface Highlight {
  type: 'HIGHLIGHT' | 'NOTE';
  quote?: string;
  annotation?: string;
  labels?: { name: string }[];
}
const formatHighlightQuote = (quote: string): string => quote.replace(/^(?=\n)$|^\s*?\n/gm, '> ');
const highlightToMarkdown = (h: Highlight): string => {
  if (h.type === 'HIGHLIGHT' && h.quote) {
    const quote = formatHighlightQuote(h.quote);
    const labels = h.labels?.map((label) => `#${label.name}`).join(' ');
    const note = h.annotation;
    return `> ${quote} ${labels ? `\n\n${labels}` : ''}${note ? `\n\n${note}` : ''}`;
  } else if (h.type === 'NOTE' && h.annotation) {
    return `${h.annotation}\n\n`;
  }
  return '';
};
const highlightsFile = (hs: Highlight[]) => hs.map(highlightToMarkdown).join('\n\n');

function item(slug: string, url: string, extra: Record<string, unknown> = {}) {
  return {
    id: `id-${slug}`,
    slug,
    title: `Title ${slug}`,
    description: 'A description that is not imported.',
    author: 'Someone',
    url,
    state: 'Active',
    readingProgress: 0,
    thumbnail: null,
    labels: [],
    savedAt: '2024-05-01T10:00:00.000Z',
    updatedAt: '2024-05-02T10:00:00.000Z',
    publishedAt: null,
    ...extra,
  };
}

const LONG = 'x'.repeat(10001);

/**
 * Rewrites a field of one entry's local header and central directory record:
 * signature, then the field at `local` / `central` bytes in.
 */
function patchEntry(zip: Uint8Array, name: string, write: (view: DataView, at: number) => void, local: number, central: number) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const target = new TextDecoder().decode(strToU8(name));
  let patched = 0;
  for (let i = 0; i + 46 < zip.length; i++) {
    const sig = view.getUint32(i, true);
    const nameAt = sig === 0x04034b50 ? i + 30 : sig === 0x02014b50 ? i + 46 : -1;
    if (nameAt < 0) continue;
    const nameLen = view.getUint16(sig === 0x04034b50 ? i + 26 : i + 28, true);
    if (new TextDecoder().decode(zip.subarray(nameAt, nameAt + nameLen)) !== target) continue;
    write(view, i + (sig === 0x04034b50 ? local : central));
    patched += 1;
  }
  expect(patched).toBe(2);
}
/** Sets an entry's compression method to one no unzipper knows. */
const breakCompression = (zip: Uint8Array, name: string) =>
  patchEntry(zip, name, (v, at) => v.setUint16(at, 99, true), 8, 10);
/** Claims an entry inflates to `size` bytes. */
const setOriginalSize = (zip: Uint8Array, name: string, size: number) =>
  patchEntry(zip, name, (v, at) => v.setUint32(at, size, true), 22, 24);

function omnivoreZip(prefix = ''): Uint8Array {
  const meta0 = [
    item('first-post', 'https://a.com/first', { labels: ['rust', 'to read'] }),
    item('archived-one', 'https://a.com/archived', { state: 'Archived' }),
    item('a-pdf', 'file:///Users/me/doc.pdf'),
  ];
  const meta1 = [
    item('with-notes', 'https://b.com/notes'),
    item('first-post-again', 'https://a.com/first'),
  ];
  return zipSync({
    [`${prefix}metadata_0_to_3.json`]: strToU8(JSON.stringify(meta0, null, 2)),
    [`${prefix}metadata_3_to_5.json`]: strToU8(JSON.stringify(meta1, null, 2)),
    [`${prefix}content/first-post.html`]: strToU8('<html><body>Saved page</body></html>'),
    [`${prefix}highlights/first-post.md`]: strToU8(
      highlightsFile([
        { type: 'HIGHLIGHT', quote: 'A plain highlight.' },
        { type: 'HIGHLIGHT', quote: 'Two paragraphs.\n\nThe second one.' },
      ]),
    ),
    [`${prefix}highlights/archived-one.md`]: strToU8(
      highlightsFile([{ type: 'HIGHLIGHT', quote: 'From an archived item.' }]),
    ),
    [`${prefix}highlights/with-notes.md`]: strToU8(
      highlightsFile([
        { type: 'HIGHLIGHT', quote: 'Noted.', annotation: 'My thought.' },
        {
          type: 'HIGHLIGHT',
          quote: 'Labelled and noted.',
          labels: [{ name: 'idea' }, { name: 'later' }],
          annotation: 'First paragraph.\n\nSecond paragraph.',
        },
        { type: 'HIGHLIGHT', quote: LONG },
      ]),
    ),
  });
}

describe('Omnivore highlights markdown', () => {
  it('reads each quote, with its note, and leaves highlight labels out when a note follows', () => {
    const md = highlightsFile([
      { type: 'HIGHLIGHT', quote: 'One line.' },
      { type: 'HIGHLIGHT', quote: 'Line one\nline two' },
      { type: 'HIGHLIGHT', quote: 'P1\n\nP2\n' },
      { type: 'HIGHLIGHT', quote: 'Tagged.', labels: [{ name: 'x' }] },
      { type: 'HIGHLIGHT', quote: 'Both.', labels: [{ name: 'y' }], annotation: 'A note.' },
      { type: 'HIGHLIGHT', quote: 'Note only.', annotation: 'Just a note.' },
    ]);
    expect(parseOmnivoreHighlights(md)).toEqual([
      { text: 'One line.' },
      { text: 'Line one\nline two' },
      { text: 'P1\n\nP2' },
      // A lone labels line can't be told from a "#word" note, so it is kept.
      { text: 'Tagged.', note: '#x' },
      { text: 'Both.', note: 'A note.' },
      { text: 'Note only.', note: 'Just a note.' },
    ]);
  });

  it('drops a page note that comes before every highlight', () => {
    const md = highlightsFile([
      { type: 'NOTE', annotation: 'About the whole page.' },
      { type: 'HIGHLIGHT', quote: 'Quoted.' },
    ]);
    expect(parseOmnivoreHighlights(md)).toEqual([{ text: 'Quoted.' }]);
  });

  it('starts a highlight only after a blank line, not at a ">" inside a note', () => {
    expect(parseOmnivoreHighlights('> A \n\nsee:\n> cited')).toEqual([{ text: 'A', note: 'see:\n> cited' }]);
  });

  it('keeps a single "#word" note on a highlight with no labels', () => {
    const md = highlightsFile([
      { type: 'HIGHLIGHT', quote: 'Quoted.', annotation: '#todo' },
      { type: 'HIGHLIGHT', quote: 'Next.' },
    ]);
    expect(parseOmnivoreHighlights(md)).toEqual([{ text: 'Quoted.', note: '#todo' }, { text: 'Next.' }]);
  });

  it('reads a page note after a highlight as part of that highlight\'s note', () => {
    // Documented limit: the export does not mark where a note ends.
    const md = highlightsFile([
      { type: 'HIGHLIGHT', quote: 'Quoted.', annotation: 'Mine.' },
      { type: 'NOTE', annotation: 'About the page.' },
      { type: 'HIGHLIGHT', quote: 'Later.' },
    ]);
    expect(parseOmnivoreHighlights(md)).toEqual([
      { text: 'Quoted.', note: 'Mine.\n\nAbout the page.' },
      { text: 'Later.' },
    ]);
  });

  it('reads CRLF files and an empty file', () => {
    expect(parseOmnivoreHighlights('> One. \r\n\r\nA note.')).toEqual([{ text: 'One.', note: 'A note.' }]);
    expect(parseOmnivoreHighlights('')).toEqual([]);
  });
});

describe('Omnivore export ZIP', () => {
  it('imports links, labels as a hint, and highlights as quotes', () => {
    const parsed = parseImportBytes('omnivore-export.zip', omnivoreZip());
    expect(parsed.items).toEqual([
      {
        url: 'https://a.com/first',
        title: 'Title first-post',
        folderPath: 'tags: rust, to read',
        quotes: [{ text: 'A plain highlight.' }, { text: 'Two paragraphs.\n\nThe second one.' }],
      },
      // Archived in Omnivore, imported like any other link.
      {
        url: 'https://a.com/archived',
        title: 'Title archived-one',
        quotes: [{ text: 'From an archived item.' }],
      },
      {
        url: 'https://b.com/notes',
        title: 'Title with-notes',
        quotes: [
          { text: 'Noted.', note: 'My thought.' },
          { text: 'Labelled and noted.', note: 'First paragraph.\n\nSecond paragraph.' },
        ],
      },
    ]);
    expect(parsed.nonWeb).toBe(1);
    expect(parsed.duplicates).toBe(1);
    // The highlight over the server's 10000-character limit.
    expect(parsed.quotesNotRestored).toBe(1);
  });

  it('finds the files under a top-level folder too', () => {
    const parsed = parseImportBytes('re-zipped.zip', omnivoreZip('omnivore/'));
    expect(parsed.items.map((i) => i.url)).toEqual([
      'https://a.com/first',
      'https://a.com/archived',
      'https://b.com/notes',
    ]);
    expect(parsed.items[0]!.quotes).toHaveLength(2);
  });

  it('sends a link with more than 200 highlights as several items', () => {
    const many = Array.from({ length: 205 }, (_, i) => ({ type: 'HIGHLIGHT' as const, quote: `Q${i}` }));
    const zip = zipSync({
      'metadata_0_to_1.json': strToU8(JSON.stringify([item('busy', 'https://c.com/busy')])),
      'highlights/busy.md': strToU8(highlightsFile(many)),
    });
    const { items } = parseImportBytes('export.zip', zip);
    expect(items.map((i) => i.quotes?.length)).toEqual([200, 5]);
    expect(items.every((i) => i.url === 'https://c.com/busy')).toBe(true);
  });

  it('matches a highlights file to its item whatever the Unicode normalization', () => {
    const slug = 'café-notes';
    const zip = zipSync({
      'metadata_0_to_1.json': strToU8(JSON.stringify([item(slug.normalize('NFC'), 'https://c.com/cafe')])),
      // What a macOS re-zip stores: the decomposed (NFD) name.
      [`highlights/${slug.normalize('NFD')}.md`]: strToU8('> Un café. '),
    });
    expect(parseImportBytes('export.zip', zip).items[0]!.quotes).toEqual([{ text: 'Un café.' }]);
  });

  it('never inflates content/: an unreadable page entry does not matter', () => {
    const zip = zipSync({
      'metadata_0_to_1.json': strToU8(JSON.stringify([item('p', 'https://c.com/p')])),
      'content/p.html': strToU8('<p>page</p>'),
    });
    breakCompression(zip, 'content/p.html');
    expect(() => unzipSync(zip)).toThrow(); // proof the entry really is unreadable
    expect(parseImportBytes('export.zip', zip).items).toEqual([{ url: 'https://c.com/p', title: 'Title p' }]);
  });

  it('refuses a metadata or highlights file over 50 MB instead of dropping it', () => {
    const zip = zipSync({ 'metadata_0_to_1.json': strToU8('[]') });
    setOriginalSize(zip, 'metadata_0_to_1.json', 60 * 1024 * 1024);
    expect(() => parseImportBytes('export.zip', zip)).toThrow(/too large/);
  });

  it('refuses an export over 1 GB before reading it', () => {
    expect(() => checkZipSize(ZIP_MAX_BYTES + 1)).toThrow(/too large to read in the browser/);
    expect(() => checkZipSize(ZIP_MAX_BYTES)).not.toThrow();
  });

  it('rejects a ZIP with no metadata files', () => {
    const zip = zipSync({ 'notes/readme.txt': strToU8('hi') });
    expect(() => parseImportBytes('other.zip', zip)).toThrow(/Omnivore export/);
  });

  it('rejects bytes that are not a ZIP', () => {
    expect(() => parseImportBytes('broken.zip', strToU8('not a zip'))).toThrow(UnsupportedFileError);
  });
});

describe('a bare Omnivore metadata JSON file', () => {
  it('imports through the .json path, without highlights', () => {
    const meta = [
      item('one', 'https://a.com/1', { labels: ['news'] }),
      item('two', 'javascript:void(0)'),
      item('three', 'https://a.com/3', { state: 'archived' }),
    ];
    const parsed = parseImportFile('metadata_0_to_3.json', JSON.stringify(meta));
    expect(parsed).toEqual({
      items: [
        { url: 'https://a.com/1', title: 'Title one', folderPath: 'tags: news' },
        { url: 'https://a.com/3', title: 'Title three' },
      ],
      nonWeb: 1,
      duplicates: 0,
    });
  });

  it('still rejects a JSON array that is not Omnivore metadata', () => {
    expect(() => parseBackupJson('[{"name":"x"}]')).toThrow(/bukmark backup/);
    expect(() => parseBackupJson('[]')).toThrow(UnsupportedFileError);
  });
});

describe('the existing formats are unchanged through the bytes entry point', () => {
  const html = '<DL><p><DT><H3>reading</H3><DL><p><DT><A HREF="https://a.com/1">Alpha</A></DL><p></DL><p>';
  const csv = 'url,title,tags\nhttps://a.com/2,Beta,x';
  const json = JSON.stringify({ links: [{ url: 'https://a.com/3', hubs: ['h'], quotes: [{ text: 'q' }] }] });

  it.each([
    ['bookmarks.html', html],
    ['export.csv', csv],
    ['backup.json', json],
  ])('%s', (name, text) => {
    expect(parseImportBytes(name, strToU8(text))).toEqual(parseImportFile(name, text));
  });
});
