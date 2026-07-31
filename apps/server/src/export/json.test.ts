import { describe, expect, it } from 'vitest';
import { toBackupJson } from './json.js';
import type { ExportLink } from './types.js';

function link(over: Partial<ExportLink> = {}): ExportLink {
  return {
    url: 'https://example.com/a', title: 'Example A', note: 'why', status: 'active',
    relevance: 4, dupeCount: 2, hubs: ['rust'], imageUrl: 'https://cdn/og.png',
    groupHint: 'Bookmarks Bar/Dev',
    firstSeen: '2026-07-21T10:00:00.000Z', lastSeen: '2026-07-29T20:12:25.832Z',
    ...over,
  };
}

describe('toBackupJson', () => {
  it('wraps links with version, timestamp and count', () => {
    const out = JSON.parse(toBackupJson([link()], '2026-07-31T12:00:00.000Z'));
    expect(out.version).toBe(1);
    expect(out.exportedAt).toBe('2026-07-31T12:00:00.000Z');
    expect(out.count).toBe(1);
    expect(out.links).toHaveLength(1);
  });

  it('preserves every field needed to restore a link', () => {
    const out = JSON.parse(toBackupJson([link()], '2026-07-31T12:00:00.000Z'));
    expect(out.links[0]).toEqual({
      url: 'https://example.com/a',
      title: 'Example A',
      note: 'why',
      status: 'active',
      relevance: 4,
      dupeCount: 2,
      hubs: ['rust'],
      imageUrl: 'https://cdn/og.png',
      groupHint: 'Bookmarks Bar/Dev',
      firstSeen: '2026-07-21T10:00:00.000Z',
      lastSeen: '2026-07-29T20:12:25.832Z',
    });
  });

  it('exports hubs by name, since a restore lands in a database where old ids mean nothing', () => {
    const out = JSON.parse(toBackupJson([link({ hubs: ['rust', 'reading'] })], '2026-07-31T12:00:00.000Z'));
    expect(out.links[0].hubs).toEqual(['rust', 'reading']);
  });

  it('carries no database id', () => {
    const out = JSON.parse(toBackupJson([link()], '2026-07-31T12:00:00.000Z'));
    expect(out.links[0]).not.toHaveProperty('id');
  });

  it('is valid json for an empty export', () => {
    const out = JSON.parse(toBackupJson([], '2026-07-31T12:00:00.000Z'));
    expect(out.count).toBe(0);
    expect(out.links).toEqual([]);
  });

  it('round-trips: parsing the output yields the input links', () => {
    const links = [link(), link({ url: 'https://b.com', hubs: [], note: '' })];
    const out = JSON.parse(toBackupJson(links, '2026-07-31T12:00:00.000Z'));
    expect(out.links).toEqual(links);
  });
});
