import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './normalize.js';
const ok = (raw) => {
    const r = normalizeUrl(raw);
    if (!r.ok)
        throw new Error(`expected ok for ${raw}: ${r.reason}`);
    return r.url;
};
describe('normalizeUrl', () => {
    it.each([
        ['https://Example.COM/Path', 'https://example.com/Path'],
        ['https://www.example.com/a', 'https://example.com/a'],
        ['https://example.com', 'https://example.com/'],
        ['https://example.com:443/a', 'https://example.com/a'],
        ['http://example.com:80/a', 'http://example.com/a'],
        ['https://example.com/a#section', 'https://example.com/a'],
        ['https://example.com/a?utm_source=x&utm_medium=y', 'https://example.com/a'],
        ['https://example.com/a?fbclid=z&id=1', 'https://example.com/a?id=1'],
        ['https://example.com/a?gclid=1&ref=tw&mc_cid=2', 'https://example.com/a'],
        ['https://example.com/a?b=2&a=1', 'https://example.com/a?b=2&a=1'],
        ['  https://example.com/a  ', 'https://example.com/a'],
    ])('%s → %s', (raw, expected) => {
        expect(ok(raw)).toBe(expected);
    });
    it('same page via utm + www variants yields same hash', () => {
        const a = normalizeUrl('https://www.example.com/article?utm_source=n');
        const b = normalizeUrl('https://example.com/article');
        expect(a.ok && b.ok && a.urlHash === b.urlHash).toBe(true);
    });
    it('rejects non-http schemes', () => {
        expect(normalizeUrl('chrome://settings/')).toEqual({ ok: false, reason: 'non-http' });
        expect(normalizeUrl('about:blank')).toEqual({ ok: false, reason: 'non-http' });
        expect(normalizeUrl('file:///etc/hosts')).toEqual({ ok: false, reason: 'non-http' });
    });
    it('rejects garbage', () => {
        expect(normalizeUrl('https://:bad')).toEqual({ ok: false, reason: 'unparseable' });
        expect(normalizeUrl('not a url')).toEqual({ ok: false, reason: 'unparseable' });
    });
    it('hash is sha256 hex of normalized url', () => {
        const r = normalizeUrl('https://example.com/a');
        expect(r.ok && /^[0-9a-f]{64}$/.test(r.urlHash)).toBe(true);
    });
});
