import { describe, expect, it } from 'vitest';
import { matchKey } from './matchKey.js';

describe('matchKey', () => {
  it('http and https variants match', () => {
    const a = matchKey('http://example.com/page');
    const b = matchKey('https://example.com/page');
    expect(a).toBe(b);
  });

  it('www subdomain is stripped', () => {
    const a = matchKey('https://www.example.com/page');
    const b = matchKey('https://example.com/page');
    expect(a).toBe(b);
  });

  it('mobile subdomains are stripped', () => {
    const a = matchKey('https://m.example.com/page');
    const b = matchKey('https://mobile.example.com/page');
    const c = matchKey('https://example.com/page');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('amp subdomain is stripped', () => {
    const a = matchKey('https://amp.example.com/page');
    const b = matchKey('https://example.com/page');
    expect(a).toBe(b);
  });

  it('trailing slash is removed', () => {
    const a = matchKey('https://example.com/page');
    const b = matchKey('https://example.com/page/');
    expect(a).toBe(b);
  });

  it('root path keeps trailing slash', () => {
    const a = matchKey('https://example.com');
    const b = matchKey('https://example.com/');
    expect(a).toBe(b);
    expect(a).toContain('//example.com/');
  });

  it('/amp path segment is removed', () => {
    const a = matchKey('https://example.com/amp/article');
    const b = matchKey('https://example.com/article');
    expect(a).toBe(b);
  });

  it('amp-guide word does not match /amp rule', () => {
    const a = matchKey('https://example.com/amp-guide');
    const b = matchKey('https://example.com/guide');
    expect(a).not.toBe(b);
  });

  it('amp query param is removed', () => {
    const a = matchKey('https://example.com/page?amp=1');
    const b = matchKey('https://example.com/page');
    expect(a).toBe(b);
  });

  it('outputType=amp query param is removed', () => {
    const a = matchKey('https://example.com/page?outputType=amp');
    const b = matchKey('https://example.com/page');
    expect(a).toBe(b);
  });

  it('different query values do not match', () => {
    const a = matchKey('https://youtube.com/watch?v=A');
    const b = matchKey('https://youtube.com/watch?v=B');
    expect(a).not.toBe(b);
  });

  it('query params are sorted for stable matching', () => {
    const a = matchKey('https://example.com/page?b=2&a=1');
    const b = matchKey('https://example.com/page?a=1&b=2');
    expect(a).toBe(b);
  });

  it('fragment is ignored', () => {
    const a = matchKey('https://example.com/page#section1');
    const b = matchKey('https://example.com/page#section2');
    expect(a).toBe(b);
  });

  it('case-insensitive hostname', () => {
    const a = matchKey('https://Example.COM/page');
    const b = matchKey('https://example.com/page');
    expect(a).toBe(b);
  });

  it('preserves other query params', () => {
    const a = matchKey('https://example.com/page?id=123&name=test');
    expect(a).toContain('id=123');
    expect(a).toContain('name=test');
  });

  it('removes amp param but keeps others', () => {
    const a = matchKey('https://example.com/page?amp=1&id=123');
    const b = matchKey('https://example.com/page?id=123');
    expect(a).toBe(b);
  });
});
