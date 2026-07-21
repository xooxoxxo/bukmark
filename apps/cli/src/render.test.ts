import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderAll } from './render.js';
import { emptyStore } from './store.js';
import type { Canon, LinkRecord, Store, Triage } from '@bookmarkt/shared';

const T = '2026-07-21T10:00:00Z';

function link(url: string, title: string, extra: Partial<LinkRecord> = {}): LinkRecord {
  return {
    url, title, sources: ['onetab_import'], dupeCount: 1, groupHints: [],
    firstSeen: T, lastSeen: T, ...extra,
  };
}
const tri = (category: string, relevance: Triage['relevance'], extra: Partial<Triage> = {}): Triage =>
  ({ category, keep: true, relevance, explanation: `why ${relevance}`, triagedAt: T, ...extra });

function fullStore(): { store: Store; canon: Canon } {
  const store = emptyStore();
  store.links['h1'] = link('https://a.com/1', 'Alpha', { triage: tri('homelab', 5) });
  store.links['h2'] = link('https://a.com/2', 'Beta', { dupeCount: 3, triage: tri('homelab', 4) });
  store.links['h3'] = link('https://a.com/3', 'Gamma', { triage: tri('reading', 2) });
  store.links['h4'] = link('https://a.com/4', 'Tossed', {
    triage: tri('reading', 1, { keep: false, reason: 'dead promo' }),
  });
  store.links['h5'] = link('https://mail.google.com/x', 'Gmail', { junk: { rule: 'gmail' } });
  store.links['h6'] = link('https://a.com/6', 'Pending');
  return { store, canon: { categories: ['homelab', 'reading'] } };
}

describe('renderAll', () => {
  it('writes INDEX, category files, junk report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bm-'));
    const { store, canon } = fullStore();
    renderAll(store, canon, dir);
    const index = readFileSync(join(dir, 'INDEX.md'), 'utf8');
    expect(index).toContain('Total links: 6');
    expect(index).toContain('Kept: 3');
    expect(index).toContain('Tossed: 1');
    expect(index).toContain('Junk: 1');
    expect(index).toContain('Pending triage: 1');
    expect(index).toContain('Dupes collapsed: 2');
    // homelab weight 9 > reading weight 2 → homelab first
    expect(index.indexOf('## homelab')).toBeLessThan(index.indexOf('## reading'));
    expect(index).toContain('[homelab.md](homelab.md)');

    const homelab = readFileSync(join(dir, 'homelab.md'), 'utf8');
    const alpha = homelab.indexOf('[Alpha](https://a.com/1) — 5/5 — why 5');
    const beta = homelab.indexOf('[Beta](https://a.com/2) — 4/5 — why 4 _(saved 3×)_');
    expect(alpha).toBeGreaterThan(-1);
    expect(beta).toBeGreaterThan(alpha);

    const junk = readFileSync(join(dir, 'junk-report.md'), 'utf8');
    expect(junk).toContain('### gmail');
    expect(junk).toContain('https://mail.google.com/x');
    expect(junk).toContain('Tossed');
    expect(junk).toContain('dead promo');
  });

  it('empty category (all tossed) gets no file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bm-'));
    const store = emptyStore();
    store.links['h4'] = link('https://a.com/4', 'Tossed', {
      triage: tri('reading', 1, { keep: false, reason: 'x' }),
    });
    renderAll(store, { categories: ['reading'] }, dir);
    expect(existsSync(join(dir, 'reading.md'))).toBe(false);
  });

  it('removes stale files from previous render', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bm-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'old-category.md'), 'stale');
    renderAll(emptyStore(), { categories: [] }, dir);
    expect(existsSync(join(dir, 'old-category.md'))).toBe(false);
    expect(existsSync(join(dir, 'INDEX.md'))).toBe(true);
  });
});
