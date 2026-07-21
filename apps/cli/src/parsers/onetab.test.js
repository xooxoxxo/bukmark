import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOneTab } from './onetab.js';
const fixture = readFileSync(new URL('../../fixtures/sample-onetab.txt', import.meta.url).pathname, 'utf8');
describe('parseOneTab', () => {
    const caps = parseOneTab(fixture);
    it('parses all URL-shaped lines (including junk/malformed ones)', () => {
        expect(caps).toHaveLength(10);
    });
    it('splits url | title on first pipe only', () => {
        const hn = caps.find((c) => c.url.includes('ycombinator'));
        expect(hn?.title).toBe('Some HN thread | with pipe in title');
    });
    it('applies group hint until blank line', () => {
        const arxiv = caps.find((c) => c.url.includes('arxiv'));
        expect(arxiv?.groupHint).toBe('Research tabs');
        const first = caps.find((c) => c.url.includes('drizzle'));
        expect(first?.groupHint).toBeUndefined();
    });
    it('treats non-URL line as hint, not capture', () => {
        expect(caps.some((c) => c.url.startsWith('notaurl'))).toBe(false);
        const hinted = caps.find((c) => c.url.includes('ycombinator'));
        expect(hinted?.groupHint).toBe('notaurl | dangling title');
    });
    it('handles url-only lines without pipe', () => {
        expect(parseOneTab('https://example.com/x\n')).toEqual([
            { url: 'https://example.com/x', title: '' },
        ]);
    });
    it('strips BOM and tolerates CRLF', () => {
        const caps2 = parseOneTab('﻿https://a.com/1 | A\r\n\r\nGroup\r\nhttps://b.com/2 | B\r\n');
        expect(caps2).toHaveLength(2);
        expect(caps2[1]?.groupHint).toBe('Group');
    });
});
