import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestFile } from './ingest.js';
import { normalizeUrl } from '@bookmarkt/shared';
import { loadStore } from './store.js';
function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'bm-'));
    return {
        dir,
        paths: { dataDir: join(dir, 'data'), workDir: join(dir, 'work'), outputDir: join(dir, 'out') },
    };
}
const FIXTURE = new URL('../fixtures/sample-onetab.txt', import.meta.url).pathname;
describe('ingestFile', () => {
    it('ingests fixture with correct counts', () => {
        const { paths } = setup();
        const r = ingestFile(paths, FIXTURE, 'onetab_import', { now: '2026-07-21T10:00:00Z' });
        expect(r.alreadyIngested).toBe(false);
        expect(r.captures).toBe(10);
        // 9 parse-ok captures minus 1 malformed = 9 stored links? No:
        // utm+www article variants collapse → 8 stored links, 1 bump.
        expect(r.added).toBe(8);
        expect(r.bumped).toBe(1);
        expect(r.malformed).toBe(1);
        expect(r.malformedSamples[0]).toContain('https://:bad');
        // junk: gmail, accounts.google, chrome:// → 3
        expect(r.junked).toBe(3);
    });
    it('collapsed variants share one record with dupeCount 2', () => {
        const { paths } = setup();
        ingestFile(paths, FIXTURE, 'onetab_import');
        const store = loadStore(join(paths.dataDir, 'store.json'));
        const n = normalizeUrl('https://www.example.com/article?utm_source=news');
        if (!n.ok)
            throw new Error('unexpected');
        expect(store.links[n.urlHash]?.dupeCount).toBe(2);
    });
    it('re-ingest of same file is a no-op', () => {
        const { paths } = setup();
        ingestFile(paths, FIXTURE, 'onetab_import');
        const before = JSON.stringify(loadStore(join(paths.dataDir, 'store.json')));
        const r2 = ingestFile(paths, FIXTURE, 'onetab_import');
        expect(r2.alreadyIngested).toBe(true);
        expect(JSON.stringify(loadStore(join(paths.dataDir, 'store.json')))).toBe(before);
    });
    it('allowlist rescues junk on forced re-ingest', () => {
        const { paths } = setup();
        ingestFile(paths, FIXTURE, 'onetab_import');
        writeFileSync(join(paths.dataDir, 'allow.txt'), 'https://mail.google.com/*\n');
        ingestFile(paths, FIXTURE, 'onetab_import', { force: true });
        const store = loadStore(join(paths.dataDir, 'store.json'));
        const gmail = Object.values(store.links).find((l) => l.url.startsWith('https://mail.google.com'));
        expect(gmail?.junk).toBeUndefined();
    });
    it('stores chrome:// as junk browser-internal', () => {
        const { paths } = setup();
        ingestFile(paths, FIXTURE, 'onetab_import');
        const store = loadStore(join(paths.dataDir, 'store.json'));
        const internal = Object.values(store.links).find((l) => l.url === 'chrome://settings/');
        expect(internal?.junk).toEqual({ rule: 'browser-internal' });
    });
});
