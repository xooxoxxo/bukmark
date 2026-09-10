import { describe, expect, it } from 'vitest';
import {
  UnsupportedFileError,
  parseBackupJson,
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

  it('rejects json that is not a backup', () => {
    expect(() => parseBackupJson('{"nope":true}')).toThrow(UnsupportedFileError);
  });

  it('rejects malformed json', () => {
    expect(() => parseBackupJson('{')).toThrow(UnsupportedFileError);
  });
});

describe('parseImportFile', () => {
  it('picks the parser from the file extension', () => {
    expect(parseImportFile('bookmarks_1_1_26.html', CHROME_EXPORT).items).toHaveLength(3);
    expect(parseImportFile('backup.json', '{"links":[]}').items).toHaveLength(0);
  });

  it('rejects a format it cannot read', () => {
    expect(() => parseImportFile('links.csv', 'url,title')).toThrow(UnsupportedFileError);
  });
});
