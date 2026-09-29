import { describe, expect, it } from 'vitest';
import { toNetscapeHtml } from './netscape.js';
import type { ExportLink } from './types.js';

function link(over: Partial<ExportLink> = {}): ExportLink {
  return {
    url: 'https://example.com/a',
    title: 'Example A',
    note: '',
    status: 'active',
    relevance: null,
    dupeCount: 1,
    hubs: [],
    imageUrl: null,
    groupHint: null,
    firstSeen: '2026-07-21T10:00:00.000Z',
    lastSeen: '2026-07-21T10:00:00.000Z',
    quotes: [],
    ...over,
  };
}

describe('toNetscapeHtml', () => {
  it('emits the doctype browsers look for', () => {
    expect(toNetscapeHtml([])).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
  });

  it('writes an anchor with href and title', () => {
    const out = toNetscapeHtml([link({ hubs: ['rust'] })]);
    expect(out).toContain('HREF="https://example.com/a"');
    expect(out).toContain('>Example A</A>');
  });

  it('puts a link under a folder named for its hub', () => {
    const out = toNetscapeHtml([link({ hubs: ['rust'] })]);
    expect(out).toContain('<H3>rust</H3>');
  });

  it('duplicates a link under every hub it belongs to', () => {
    const out = toNetscapeHtml([link({ hubs: ['rust', 'reading'] })]);
    expect(out).toContain('<H3>rust</H3>');
    expect(out).toContain('<H3>reading</H3>');
    // once per folder
    expect(out.split('HREF="https://example.com/a"').length - 1).toBe(2);
  });

  it('lists every hub in TAGS so tag-aware importers get the full picture', () => {
    const out = toNetscapeHtml([link({ hubs: ['rust', 'reading'] })]);
    expect(out).toContain('TAGS="reading,rust"');
  });

  it('puts hubless links in an Unsorted folder rather than dropping them', () => {
    const out = toNetscapeHtml([link({ hubs: [] })]);
    expect(out).toContain('<H3>Unsorted</H3>');
    expect(out).toContain('HREF="https://example.com/a"');
  });

  it('names the folder of a hub called Unsorted apart from the one for links in no hub, as sync does', () => {
    const out = toNetscapeHtml([
      link({ url: 'https://a.com', hubs: ['Unsorted'] }),
      link({ url: 'https://b.com', hubs: ['Unsorted (hub)'] }),
      link({ url: 'https://c.com', hubs: [] }),
      link({ url: 'https://d.com', hubs: ['Notes (hub)'] }),
    ]);
    expect(out.match(/<H3>[^<]*<\/H3>/g)).toEqual([
      '<H3>bukmark</H3>', '<H3>Notes (hub)</H3>', '<H3>Unsorted (hub)</H3>', '<H3>Unsorted (hub) (hub)</H3>', '<H3>Unsorted</H3>',
    ]);
  });

  it('emits the note as a DD description, which survives into browsers', () => {
    const out = toNetscapeHtml([link({ hubs: ['rust'], note: 'the book' })]);
    expect(out).toContain('<DD>the book');
  });

  it('omits DD entirely when there is no note', () => {
    expect(toNetscapeHtml([link({ hubs: ['rust'] })])).not.toContain('<DD>');
  });

  it('escapes html in titles, notes, urls and hub names', () => {
    const out = toNetscapeHtml([
      link({ url: 'https://x.com/?a=1&b=2', title: '<script>', note: 'a & b', hubs: ['a"b'] }),
    ]);
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('a &amp; b');
    expect(out).toContain('a=1&amp;b=2');
    expect(out).toContain('&quot;');
    expect(out).not.toContain('<script>');
  });

  it('falls back to the url when a title is empty', () => {
    const out = toNetscapeHtml([link({ hubs: ['rust'], title: '' })]);
    expect(out).toContain('>https://example.com/a</A>');
  });

  it('sets ADD_DATE from firstSeen as unix seconds', () => {
    const out = toNetscapeHtml([link({ hubs: ['rust'] })]);
    expect(out).toContain(`ADD_DATE="${Math.floor(Date.parse('2026-07-21T10:00:00.000Z') / 1000)}"`);
  });

  it('sorts folders alphabetically with Unsorted last', () => {
    const out = toNetscapeHtml([
      link({ url: 'https://a.com', hubs: ['zebra'] }),
      link({ url: 'https://b.com', hubs: ['alpha'] }),
      link({ url: 'https://c.com', hubs: [] }),
    ]);
    expect(out.indexOf('<H3>alpha</H3>')).toBeLessThan(out.indexOf('<H3>zebra</H3>'));
    expect(out.indexOf('<H3>zebra</H3>')).toBeLessThan(out.indexOf('<H3>Unsorted</H3>'));
  });

  it('produces a valid empty document for no links: only the bukmark folder', () => {
    const out = toNetscapeHtml([]);
    expect(out).toContain('<DL><p>');
    expect(out).toContain('</DL><p>');
    expect(out.match(/<H3>/g)).toEqual(['<H3>']);
    expect(out).toContain('<H3>bukmark</H3>');
  });

  it('puts every folder inside one top-level bukmark folder, as sync lays them out', () => {
    const out = toNetscapeHtml([
      link({ url: 'https://a.com', hubs: ['rust'] }),
      link({ url: 'https://c.com', hubs: [] }),
    ]);
    // Nesting depth of each folder and link, counted from the <DL> opens and closes before it.
    const depthAt = (needle: string): number => {
      const before = out.slice(0, out.indexOf(needle));
      return (before.match(/<DL><p>/g) ?? []).length - (before.match(/<\/DL><p>/g) ?? []).length;
    };
    expect(depthAt('<H3>bukmark</H3>')).toBe(1);
    expect(depthAt('<H3>rust</H3>')).toBe(2);
    expect(depthAt('<H3>Unsorted</H3>')).toBe(2);
    expect(depthAt('HREF="https://a.com"')).toBe(3);
    expect(depthAt('HREF="https://c.com"')).toBe(3);
    // Opens and closes balance, and bukmark is the only thing at the top.
    expect((out.match(/<DL><p>/g) ?? []).length).toBe((out.match(/<\/DL><p>/g) ?? []).length);
    expect(out.indexOf('<H3>bukmark</H3>')).toBeLessThan(out.indexOf('<H3>rust</H3>'));
  });
});
