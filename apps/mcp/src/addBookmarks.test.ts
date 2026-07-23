import { describe, expect, it } from 'vitest';
import { summarize, toRequestBody, type ItemResult } from './addBookmarks.js';

describe('toRequestBody', () => {
  it('keeps url + provided fields, drops undefined', () => {
    expect(toRequestBody({ url: 'https://a.com', title: 'A', relevance: 4 })).toEqual({
      url: 'https://a.com', title: 'A', relevance: 4,
    });
  });

  it('passes only url when nothing else given', () => {
    expect(toRequestBody({ url: 'https://a.com' })).toEqual({ url: 'https://a.com' });
  });
});

describe('summarize', () => {
  it('counts outcomes and lists per-item lines', () => {
    const results: ItemResult[] = [
      { url: 'https://a.com', outcome: 'created' },
      { url: 'https://b.com', outcome: 'updated' },
      { url: 'https://c.com', outcome: 'resurrected' },
      { url: 'https://d.com', error: 'HTTP 400' },
    ];
    const text = summarize(results);
    expect(text).toContain('1 created, 1 updated, 1 resurrected, 1 failed');
    expect(text).toContain('https://a.com → created');
    expect(text).toContain('https://d.com → error: HTTP 400');
  });
});
