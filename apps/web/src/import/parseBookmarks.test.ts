import { describe, expect, it } from 'vitest';
import {
  UnsupportedFileError,
  parseBackupJson,
  parseCSV,
  parseImportFile,
  parseNetscapeHtml,
} from './parseBookmarks';

/** Chrome's shape: a toolbar folder, a nested folder, unclosed <DT> and <p>. */
const CHROME_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.com/one" ADD_DATE="1700000001">One</A>
        <DT><H3 ADD_DATE="1700000002">Rust</H3>
        <DL><p>
            <DT><A HREF="https://example.com/rust" ADD_DATE="1700000003">Rust Book</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://example.com/loose">Loose</A>
</DL><p>`;

/** What apps/server/src/export/netscape.ts emits, notes included. */
const BUKMARK_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>reading</H3>
    <DL><p>
        <DT><A HREF="https://a.com/1" ADD_DATE="1700000000" TAGS="reading">Alpha</A>
        <DD>Why I kept this.
    </DL><p>
    <DT><H3>Unsorted</H3>
    <DL><p>
        <DT><A HREF="https://a.com/2" ADD_DATE="1700000000" TAGS="">Beta</A>
    </DL><p>
</DL><p>`;

describe('parseNetscapeHtml', () => {
  it('reads url and title from each anchor', () => {
    const { items } = parseNetscapeHtml(CHROME_EXPORT);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ url: 'https://example.com/one', title: 'One' });
  });

  it('records the nested folder chain as the folder path', () => {
    const { items } = parseNetscapeHtml(CHROME_EXPORT);
    const rust = items.find((i) => i.url === 'https://example.com/rust');
    expect(rust?.folderPath).toBe('Bookmarks bar/Rust');
  });

  it('leaves folderPath unset for a link outside any folder', () => {
    const { items } = parseNetscapeHtml(CHROME_EXPORT);
    const loose = items.find((i) => i.url === 'https://example.com/loose');
    expect(loose?.folderPath).toBeUndefined();
  });

  it('round-trips bukmark’s own HTML export, hub name as the folder', () => {
    const { items } = parseNetscapeHtml(BUKMARK_EXPORT);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ url: 'https://a.com/1', title: 'Alpha', folderPath: 'reading' });
  });

  it('counts bookmarklets and place: queries as non-web instead of importing them', () => {
    const html = `<DL><p>
      <DT><A HREF="javascript:void(0)">Bookmarklet</A>
      <DT><A HREF="place:type=6&sort=14">Recent Tags</A>
      <DT><A HREF="https://ok.com/">Fine</A>
    </DL><p>`;
    const { items, nonWeb } = parseNetscapeHtml(html);
    expect(nonWeb).toBe(2);
    expect(items).toHaveLength(1);
  });

  it('collapses a url listed under two folders into one item', () => {
    const html = `<DL><p>
      <DT><H3>A</H3>
      <DL><p><DT><A HREF="https://dup.com/">Dup</A></DL><p>
      <DT><H3>B</H3>
      <DL><p><DT><A HREF="https://dup.com/">Dup</A></DL><p>
    </DL><p>`;
    const { items, duplicates } = parseNetscapeHtml(html);
    expect(items).toHaveLength(1);
    expect(duplicates).toBe(1);
  });

  it('rejects an HTML file with no bookmarks in it', () => {
    expect(() => parseNetscapeHtml('<html><body><p>hello</p></body></html>')).toThrow(
      UnsupportedFileError,
    );
  });
});

describe('parseBackupJson', () => {
  const backup = JSON.stringify({
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    count: 2,
    links: [
      { url: 'https://a.com/1', title: 'Alpha', hubs: ['reading', 'rust'] },
      { url: 'https://a.com/2', title: 'Beta', hubs: [] },
    ],
  });

  it('reads links out of a backup file', () => {
    const { items } = parseBackupJson(backup);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ url: 'https://a.com/2', title: 'Beta' });
  });

  it('carries old hub names as a comma list, not a folder path', () => {
    const { items } = parseBackupJson(backup);
    expect(items[0]?.folderPath).toBe('reading, rust');
  });

  describe('quotes', () => {
    const withQuotes = JSON.stringify({
      version: 1,
      links: [
        {
          url: 'https://a.com/1', title: 'Alpha', hubs: [],
          quotes: [
            { text: 'First.', note: 'n', createdAt: '2026-01-02T03:04:05.000Z' },
            { text: 'No note.' },
            { text: '   ' },
            { note: 'no text' },
            'not an object',
          ],
        },
        { url: 'https://a.com/2', title: 'Beta', quotes: 'nope' },
        { url: 'https://a.com/3' },
      ],
      orphanQuotes: [
        { text: 'Lonely.', note: 'x', sourceUrl: 'https://gone.com/p', sourceTitle: 'Gone', createdAt: '2026-02-01T00:00:00.000Z' },
        { text: 'Bare.', sourceUrl: 'https://gone.com/q' },
        { text: 'No source.' },
        { text: '', sourceUrl: 'https://gone.com/r' },
      ],
    });

    it('reads each link\'s quotes and drops unusable ones', () => {
      const { items } = parseBackupJson(withQuotes);
      expect(items[0]?.quotes).toEqual([
        { text: 'First.', note: 'n', createdAt: '2026-01-02T03:04:05.000Z' },
        { text: 'No note.' },
      ]);
      expect(items[1]).not.toHaveProperty('quotes');
      expect(items[2]).not.toHaveProperty('quotes');
    });

    it('reads the top-level orphanQuotes and needs a source url on each', () => {
      const { orphanQuotes } = parseBackupJson(withQuotes);
      expect(orphanQuotes).toEqual([
        { text: 'Lonely.', note: 'x', sourceUrl: 'https://gone.com/p', sourceTitle: 'Gone', createdAt: '2026-02-01T00:00:00.000Z' },
        { text: 'Bare.', sourceUrl: 'https://gone.com/q' },
      ]);
    });

    it('skips quotes over the server limits rather than failing the whole import', () => {
      const big = 'x'.repeat(10001);
      const many = Array.from({ length: 250 }, (_, i) => ({ text: `q${i}` }));
      const { items } = parseBackupJson(JSON.stringify({
        links: [{ url: 'https://a.com/1', quotes: [{ text: big }, ...many] }],
      }));
      expect(items[0]?.quotes).toHaveLength(200);
      expect(items[0]?.quotes?.[0]?.text).toBe('q0');
    });

    it('an older backup without quotes parses as before', () => {
      const parsed = parseBackupJson(backup);
      expect(parsed.items[0]).not.toHaveProperty('quotes');
      expect(parsed.orphanQuotes ?? []).toEqual([]);
    });
  });

  it('rejects json that is not a backup', () => {
    expect(() => parseBackupJson('{"nope":true}')).toThrow(UnsupportedFileError);
  });

  it('rejects malformed json', () => {
    expect(() => parseBackupJson('{')).toThrow(UnsupportedFileError);
  });
});

describe('parseCSV', () => {
  const POCKET_CSV = `title,url,time_added,tags,status
Article One,https://example.com/one,1700000000,"reading,tech",unread
Article Two,https://example.com/two,1700000001,"",archive`;

  const RAINDROP_CSV = `id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite
1,Rust Book,Keep this,From the official,https://rust.example.com/book,Learning/Rust,"rust,lang",1700000000,,false
2,Simple Link,,,https://simple.example.com,Reading,,,false`;

  const INSTAPAPER_CSV = `URL,Title,Selection,Folder,Timestamp
https://instapaper.example.com/one,Instapaper Article,Some excerpt,Articles,1700000000
https://instapaper.example.com/two,Another Article,,,1700000001`;

  const GENERIC_CSV = `url,name,note,folder
https://generic.example.com/one,First Link,My note,Tech
https://generic.example.com/two,Second Link,,`;

  it('parses Pocket CSV format', () => {
    const { items } = parseCSV(POCKET_CSV);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      url: 'https://example.com/one',
      title: 'Article One',
      folderPath: 'tags: reading,tech',
    });
    expect(items[1]).toMatchObject({ url: 'https://example.com/two', title: 'Article Two' });
  });

  it('parses Raindrop CSV format with folder and tags', () => {
    const { items } = parseCSV(RAINDROP_CSV);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      url: 'https://rust.example.com/book',
      title: 'Rust Book',
      folderPath: 'Learning/Rust / tags: rust,lang',
    });
  });

  it('parses Instapaper CSV format', () => {
    const { items } = parseCSV(INSTAPAPER_CSV);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      url: 'https://instapaper.example.com/one',
      title: 'Instapaper Article',
      folderPath: 'Articles',
    });
  });

  it('handles case-insensitive headers', () => {
    const mixed = `URL,Title,Folder
https://case.example.com,Ignored Case,MY FOLDER`;
    const { items } = parseCSV(mixed);
    expect(items[0]).toMatchObject({
      url: 'https://case.example.com',
      title: 'Ignored Case',
      folderPath: 'MY FOLDER',
    });
  });

  it('handles quoted fields with embedded commas and newlines', () => {
    const quoted = `url,title,note
https://quoted.example.com,"Title, with comma","Note with
embedded newline"
https://next.example.com,Next,`;
    const { items, nonWeb } = parseCSV(quoted);
    // The newline inside the quoted note must not end the record.
    expect(nonWeb).toBe(0);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      url: 'https://quoted.example.com',
      title: 'Title, with comma',
    });
    expect(items[1]).toMatchObject({ url: 'https://next.example.com', title: 'Next' });
  });

  it('handles doubled quotes in quoted fields', () => {
    const doubled = `url,title
https://doubled.example.com,"She said ""Hello"""`;
    const { items } = parseCSV(doubled);
    expect(items[0]).toMatchObject({
      url: 'https://doubled.example.com',
      title: 'She said "Hello"',
    });
  });

  it('handles BOM in CSV', () => {
    const bom = '﻿url,title\nhttps://bom.example.com,BOM File';
    const { items } = parseCSV(bom);
    expect(items[0]).toMatchObject({
      url: 'https://bom.example.com',
      title: 'BOM File',
    });
  });

  it('handles CRLF line endings', () => {
    const crlf = `url,title\r\nhttps://crlf.example.com,CRLF File`;
    const { items } = parseCSV(crlf);
    expect(items[0]).toMatchObject({
      url: 'https://crlf.example.com',
      title: 'CRLF File',
    });
  });

  it('counts non-web rows', () => {
    const mixed = `url,title
https://ok.example.com,OK
javascript:void(0),Bookmarklet
https://ok2.example.com,OK2`;
    const { items, nonWeb } = parseCSV(mixed);
    expect(items).toHaveLength(2);
    expect(nonWeb).toBe(1);
  });

  it('collapses duplicate URLs', () => {
    const dups = `url,title,folder
https://dup.example.com,First,A
https://dup.example.com,Second,B`;
    const { items, duplicates } = parseCSV(dups);
    expect(items).toHaveLength(1);
    expect(duplicates).toBe(1);
  });

  it('rejects CSV with no URL column', () => {
    const noUrl = `title,folder
Some Title,Some Folder`;
    expect(() => parseCSV(noUrl)).toThrow(UnsupportedFileError);
  });

  it('recognizes link and href as URL column aliases', () => {
    const link = `link,title\nhttps://alias.example.com,Link Alias`;
    const href = `href,title\nhttps://alias.example.com,Href Alias`;
    expect(parseCSV(link).items[0]?.url).toBe('https://alias.example.com');
    expect(parseCSV(href).items[0]?.url).toBe('https://alias.example.com');
  });

  it('handles empty CSV rows gracefully', () => {
    const sparse = `url,title
https://sparse.example.com,Sparse


`;
    const { items } = parseCSV(sparse);
    expect(items).toHaveLength(1);
  });

  it('ignores notes since the import schema does not accept them', () => {
    const notes = `url,title,note
https://note.example.com,Has Note,This note is dropped`;
    const { items } = parseCSV(notes);
    // The note field is detected but not added to folderPath unless there's also a folder or tags
    expect(items[0]).toMatchObject({
      url: 'https://note.example.com',
      title: 'Has Note',
    });
  });
});

describe('parseImportFile', () => {
  it('picks the parser from the file extension', () => {
    expect(parseImportFile('bookmarks_1_1_26.html', CHROME_EXPORT).items).toHaveLength(3);
    expect(parseImportFile('backup.json', '{"links":[]}').items).toHaveLength(0);
    expect(
      parseImportFile('export.csv', 'url,title\nhttps://csv.example.com,CSV').items,
    ).toHaveLength(1);
  });

  it('rejects a format it cannot read', () => {
    expect(() => parseImportFile('links.txt', 'url,title')).toThrow(UnsupportedFileError);
  });
});
