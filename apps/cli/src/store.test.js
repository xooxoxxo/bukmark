import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyStore, loadStore, mergeCapture, saveStore } from './store.js';
const T1 = '2026-07-21T10:00:00Z';
const T2 = '2026-07-22T10:00:00Z';
const cap = { urlHash: 'h1', url: 'https://a.com/', title: 'A' };
describe('store persistence', () => {
    it('loadStore on missing file returns empty store', () => {
        const dir = mkdtempSync(join(tmpdir(), 'bm-'));
        expect(loadStore(join(dir, 'store.json'))).toEqual(emptyStore());
    });
    it('round-trips and creates parent dirs', () => {
        const dir = mkdtempSync(join(tmpdir(), 'bm-'));
        const file = join(dir, 'data', 'store.json');
        const s = emptyStore();
        mergeCapture(s, cap, 'onetab_import', T1);
        saveStore(file, s);
        expect(loadStore(file)).toEqual(s);
        expect(readFileSync(file, 'utf8')).toContain('\n');
    });
});
describe('mergeCapture', () => {
    it('adds new link with dupeCount 1', () => {
        const s = emptyStore();
        const r = mergeCapture(s, { ...cap, groupHint: 'g' }, 'onetab_import', T1);
        expect(r.added).toBe(true);
        expect(s.links['h1']).toEqual({
            url: 'https://a.com/', title: 'A', sources: ['onetab_import'],
            dupeCount: 1, groupHints: ['g'], firstSeen: T1, lastSeen: T1,
        });
    });
    it('bumps existing: dupeCount, lastSeen, new source, new hint', () => {
        const s = emptyStore();
        mergeCapture(s, { ...cap, groupHint: 'g' }, 'onetab_import', T1);
        const r = mergeCapture(s, { ...cap, groupHint: 'g2' }, 'chrome_import', T2);
        expect(r.added).toBe(false);
        const l = s.links['h1'];
        expect(l.dupeCount).toBe(2);
        expect(l.lastSeen).toBe(T2);
        expect(l.firstSeen).toBe(T1);
        expect(l.sources).toEqual(['onetab_import', 'chrome_import']);
        expect(l.groupHints).toEqual(['g', 'g2']);
    });
    it('does not duplicate source or hint', () => {
        const s = emptyStore();
        mergeCapture(s, { ...cap, groupHint: 'g' }, 'onetab_import', T1);
        mergeCapture(s, { ...cap, groupHint: 'g' }, 'onetab_import', T2);
        const l = s.links['h1'];
        expect(l.sources).toEqual(['onetab_import']);
        expect(l.groupHints).toEqual(['g']);
    });
    it('fills empty title, never overwrites non-empty', () => {
        const s = emptyStore();
        mergeCapture(s, { ...cap, title: '' }, 'onetab_import', T1);
        mergeCapture(s, { ...cap, title: 'Real' }, 'onetab_import', T2);
        expect(s.links['h1'].title).toBe('Real');
        mergeCapture(s, { ...cap, title: 'Other' }, 'onetab_import', T2);
        expect(s.links['h1'].title).toBe('Real');
    });
});
