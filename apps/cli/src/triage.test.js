import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyStore, mergeCapture } from './store.js';
import { collectResultFiles, mergeBatch, normalizeCategory, prepareBatches, validateBatch, } from './triage.js';
const T = '2026-07-21T10:00:00Z';
function storeWith(n, junkEvery) {
    const s = emptyStore();
    for (let i = 0; i < n; i++) {
        const h = `h${String(i).padStart(3, '0')}`;
        mergeCapture(s, { urlHash: h, url: `https://x.com/${i}`, title: `T${i}` }, 'onetab_import', T);
        if (junkEvery && i % junkEvery === 0)
            s.links[h].junk = { rule: 'gmail' };
    }
    return s;
}
describe('prepareBatches', () => {
    it('splits untriaged non-junk links into batches', () => {
        const dir = mkdtempSync(join(tmpdir(), 'bm-'));
        const s = storeWith(7, 3); // h000,h003,h006 junk → 4 queueable
        const count = prepareBatches(s, dir, { batchSize: 3 });
        expect(count).toBe(2);
        const b1 = JSON.parse(readFileSync(join(dir, 'batch-1.json'), 'utf8'));
        expect(b1.batch).toBe(1);
        expect(b1.links).toHaveLength(3);
        expect(b1.links[0]).toEqual({
            urlHash: 'h001', url: 'https://x.com/1', title: 'T1', dupeCount: 1, groupHints: [],
        });
    });
    it('skips already-triaged links', () => {
        const dir = mkdtempSync(join(tmpdir(), 'bm-'));
        const s = storeWith(2);
        s.links['h000'].triage = {
            category: 'x', keep: true, relevance: 3, explanation: 'e', triagedAt: T,
        };
        expect(prepareBatches(s, dir, { batchSize: 10 })).toBe(1);
        const b1 = JSON.parse(readFileSync(join(dir, 'batch-1.json'), 'utf8'));
        expect(b1.links.map((l) => l.urlHash)).toEqual(['h001']);
    });
    it('returns 0 and writes nothing when queue empty', () => {
        const dir = mkdtempSync(join(tmpdir(), 'bm-'));
        expect(prepareBatches(emptyStore(), dir)).toBe(0);
        expect(readdirSync(dir)).toEqual([]);
    });
});
const good = {
    urlHash: 'h001', category: 'Home Lab', keep: true, relevance: 4, explanation: 'useful',
};
describe('validateBatch', () => {
    const s = storeWith(3, 3); // h000 junk
    it('accepts valid batch', () => {
        expect(validateBatch(s, { batch: 1, results: [good] })).toEqual({ ok: true });
    });
    it.each([
        [{ ...good, urlHash: 'nope' }, 'unknown urlHash'],
        [{ ...good, urlHash: 'h000' }, 'junk link'],
        [{ ...good, relevance: 6 }, 'relevance'],
        [{ ...good, relevance: 2.5 }, 'relevance'],
        [{ ...good, category: '' }, 'category'],
        [{ ...good, explanation: '' }, 'explanation'],
        [{ ...good, explanation: 'x'.repeat(161) }, 'explanation'],
        [{ ...good, keep: false }, 'reason'],
    ])('rejects whole batch: %o', (entry, needle) => {
        const v = validateBatch(s, { batch: 1, results: [good, entry] });
        expect(v.ok).toBe(false);
        if (!v.ok)
            expect(v.errors.join(' ')).toContain(needle);
    });
});
describe('mergeBatch + canon', () => {
    it('merges and canonicalizes category', () => {
        const s = storeWith(3, 3);
        const canon = { categories: ['homelab'] };
        const n = mergeBatch(s, canon, { batch: 1, results: [good] }, T);
        expect(n).toBe(1);
        expect(s.links['h001'].triage).toEqual({
            category: 'homelab', keep: true, relevance: 4, explanation: 'useful', triagedAt: T,
        });
        expect(canon.categories).toEqual(['homelab']);
    });
    it('new category appended to canon as slug', () => {
        const canon = { categories: [] };
        expect(normalizeCategory('AI  Tools', canon)).toBe('ai-tools');
        expect(canon.categories).toEqual(['ai-tools']);
        expect(normalizeCategory('ai_tools', canon)).toBe('ai-tools');
        expect(canon.categories).toEqual(['ai-tools']);
    });
    it('keep=false stores reason', () => {
        const s = storeWith(3, 3);
        const canon = { categories: [] };
        mergeBatch(s, canon, {
            batch: 1,
            results: [{ ...good, keep: false, reason: 'stale 2019 promo' }],
        }, T);
        expect(s.links['h001'].triage?.reason).toBe('stale 2019 promo');
    });
});
describe('collectResultFiles', () => {
    it('reads batch-*.result.json sorted', () => {
        const dir = mkdtempSync(join(tmpdir(), 'bm-'));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'batch-2.result.json'), JSON.stringify({ batch: 2, results: [] }));
        writeFileSync(join(dir, 'batch-1.result.json'), JSON.stringify({ batch: 1, results: [] }));
        writeFileSync(join(dir, 'batch-1.json'), JSON.stringify({ batch: 1, links: [] }));
        expect(collectResultFiles(dir).map((f) => f.batch)).toEqual([1, 2]);
    });
});
