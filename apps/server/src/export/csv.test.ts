import { describe, expect, it } from 'vitest';
import { toCsv } from './csv.js';
import type { ExportLink } from './types.js';

function link(over: Partial<ExportLink> = {}): ExportLink {
  return {
    url: 'https://example.com/a', title: 'Example A', note: '', status: 'active',
    relevance: null, dupeCount: 1, hubs: [], imageUrl: null, groupHint: null,
    firstSeen: '2026-07-21T10:00:00.000Z', lastSeen: '2026-07-21T10:00:00.000Z', quotes: [],
    ...over,
  };
}

describe('toCsv', () => {
  it('starts with the documented header row', () => {
    expect(toCsv([]).split('\n')[0]).toBe(
      'url,title,note,hubs,relevance,status,dupeCount,firstSeen',
    );
  });

  it('writes one row per link', () => {
    const rows = toCsv([link(), link({ url: 'https://b.com' })]).trim().split('\n');
    expect(rows).toHaveLength(3); // header + 2
  });

  it('joins hubs with semicolons so they do not collide with the delimiter', () => {
    expect(toCsv([link({ hubs: ['rust', 'reading'] })])).toContain('rust;reading');
  });

  it('quotes fields containing a comma', () => {
    expect(toCsv([link({ title: 'a,b' })])).toContain('"a,b"');
  });

  it('doubles internal quotes, per RFC 4180', () => {
    expect(toCsv([link({ title: 'say "hi"' })])).toContain('"say ""hi"""');
  });

  it('quotes fields containing a newline', () => {
    expect(toCsv([link({ note: 'line1\nline2' })])).toContain('"line1\nline2"');
  });

  it('writes an empty cell for a null relevance', () => {
    expect(toCsv([link({ relevance: null })]).split('\n')[1]).toContain(',,active,');
  });

  it('writes the relevance when present', () => {
    expect(toCsv([link({ relevance: 4 })]).split('\n')[1]).toContain(',4,active,');
  });

  it('handles a field containing a comma, a quote and a newline at once', () => {
    expect(toCsv([link({ note: 'say "hi",\nthen leave' })])).toContain('"say ""hi"",\nthen leave"');
  });
});
