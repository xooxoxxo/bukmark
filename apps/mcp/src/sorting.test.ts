import { describe, expect, it } from 'vitest';
import { formatHubs, formatUnsorted, summarizeAssign, type HubSummary, type UnsortedLink } from './sorting.js';

const LINK: UnsortedLink = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  url: 'https://rust-lang.org',
  title: 'Rust',
  note: 'the book',
  groupHint: 'Bookmarks Bar/Dev',
  firstSeen: '2026-07-28T10:00:00.000Z',
};

describe('formatUnsorted', () => {
  it('includes id, url, title, note and the folder hint', () => {
    const out = formatUnsorted([LINK]);
    expect(out).toContain(LINK.id);
    expect(out).toContain('https://rust-lang.org');
    expect(out).toContain('Rust');
    expect(out).toContain('the book');
    expect(out).toContain('Bookmarks Bar/Dev');
  });

  it('omits the hint marker when there is no group hint', () => {
    expect(formatUnsorted([{ ...LINK, groupHint: null }])).not.toContain('was in:');
  });

  it('says so plainly when nothing is unsorted', () => {
    expect(formatUnsorted([])).toBe('Nothing unsorted.');
  });

  it('leads with the count', () => {
    expect(formatUnsorted([LINK, { ...LINK, id: 'b' }])).toMatch(/^2 unsorted/);
  });
});

describe('formatHubs', () => {
  const hubs: HubSummary[] = [
    { id: 'h1', name: 'rust', description: 'systems', linkCount: 12 },
    { id: 'h2', name: 'homelab', description: '', linkCount: 3 },
  ];

  it('lists each hub with its link count', () => {
    const out = formatHubs(hubs);
    expect(out).toContain('rust (12)');
    expect(out).toContain('homelab (3)');
  });

  it('says so plainly when there are no hubs', () => {
    expect(formatHubs([])).toBe('No hubs yet.');
  });
});

describe('summarizeAssign', () => {
  it('reports assignments and newly created hubs', () => {
    const out = summarizeAssign({ assigned: 5, hubsCreated: ['rust'], unknownLinkIds: [] });
    expect(out).toContain('5 assigned');
    expect(out).toContain('new hubs: rust');
  });

  it('surfaces unknown link ids rather than silently dropping them', () => {
    const out = summarizeAssign({ assigned: 1, hubsCreated: [], unknownLinkIds: ['ghost-id'] });
    expect(out).toContain('ghost-id');
    expect(out).toContain('not found');
  });
});
