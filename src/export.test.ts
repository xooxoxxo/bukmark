import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportAll } from './export.js';
import { emptyStore } from './store.js';
import type { LinkRecord, Store, Triage } from './types.js';

const T = '2026-07-21T10:00:00Z';

function link(url: string, title: string, extra: Partial<LinkRecord> = {}): LinkRecord {
  return {
    url, title, sources: ['onetab_import'], dupeCount: 1, groupHints: [],
    firstSeen: T, lastSeen: T, ...extra,
  };
}
const tri = (category: string, relevance: Triage['relevance'], extra: Partial<Triage> = {}): Triage =>
  ({ category, keep: true, relevance, explanation: `why ${relevance}`, triagedAt: T, ...extra });

function fullStore(): Store {
  const store = emptyStore();
  store.links['h1'] = link('https://a.com/1?x=1&y=2', 'Alpha <One> & "Co"', { triage: tri('homelab', 5) });
  store.links['h2'] = link('https://a.com/2', 'Beta', { dupeCount: 3, triage: tri('homelab', 4) });
  store.links['h3'] = link('https://a.com/3', 'Gamma, "quoted"', { triage: tri('reading', 2) });
  store.links['h4'] = link('https://a.com/4', 'Tossed', {
    triage: tri('reading', 1, { keep: false, reason: 'dead' }),
  });
  store.links['h5'] = link('https://mail.google.com/x', 'Gmail', { junk: { rule: 'gmail' } });
  store.links['h6'] = link('https://a.com/6', 'Pending');
  return store;
}

describe('exportAll', () => {
  it('writes Netscape HTML with category folders, kept links only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bm-'));
    const r = exportAll(fullStore(), dir);
    expect(r.count).toBe(3);
    const html = readFileSync(join(dir, 'bookmarks.html'), 'utf8');
    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(html).toContain('<DT><H3>homelab</H3>');
    expect(html).toContain('TAGS="homelab"');
    expect(html).toContain('Alpha &lt;One&gt; &amp; &quot;Co&quot;');
    expect(html).toContain('HREF="https://a.com/1?x=1&amp;y=2"');
    expect(html).not.toContain('Tossed');
    expect(html).not.toContain('mail.google.com');
    expect(html).not.toContain('Pending');
    // relevance order within category: Alpha (5) before Beta (4)
    expect(html.indexOf('a.com/1')).toBeLessThan(html.indexOf('a.com/2'));
  });

  it('writes CSV with quoted fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bm-'));
    exportAll(fullStore(), dir);
    const csv = readFileSync(join(dir, 'links.csv'), 'utf8');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('url,title,category,relevance,explanation,dupeCount,firstSeen');
    expect(lines).toHaveLength(4); // header + 3 kept
    expect(csv).toContain('"Gamma, ""quoted"""');
    expect(csv).toContain('https://a.com/2,Beta,homelab,4,why 4,3,');
  });

  it('empty title falls back to url', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bm-'));
    const store = emptyStore();
    store.links['h1'] = link('https://a.com/x', '', { triage: tri('misc', 3) });
    exportAll(store, dir);
    const html = readFileSync(join(dir, 'bookmarks.html'), 'utf8');
    expect(html).toContain('>https://a.com/x</A>');
  });
});
