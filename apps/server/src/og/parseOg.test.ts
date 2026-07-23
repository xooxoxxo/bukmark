import { describe, expect, it } from 'vitest';
import { parseOgImage } from './parseOg.js';

const PAGE = 'https://example.com/articles/post';

describe('parseOgImage', () => {
  it('extracts og:image', () => {
    const html = '<head><meta property="og:image" content="https://cdn.example.com/a.png"></head>';
    expect(parseOgImage(html, PAGE)).toBe('https://cdn.example.com/a.png');
  });

  it('accepts og:image:url variant', () => {
    const html = '<meta property="og:image:url" content="https://cdn.example.com/b.png">';
    expect(parseOgImage(html, PAGE)).toBe('https://cdn.example.com/b.png');
  });

  it('falls back to twitter:image only when no og:image', () => {
    const both = '<meta name="twitter:image" content="/tw.png"><meta property="og:image" content="/og.png">';
    expect(parseOgImage(both, PAGE)).toBe('https://example.com/og.png');
    const twOnly = '<meta name="twitter:image" content="/tw.png">';
    expect(parseOgImage(twOnly, PAGE)).toBe('https://example.com/tw.png');
  });

  it('handles content-before-property attribute order and single quotes', () => {
    const html = "<meta content='https://cdn.example.com/c.png' property='og:image'>";
    expect(parseOgImage(html, PAGE)).toBe('https://cdn.example.com/c.png');
  });

  it('resolves relative URLs against the page URL', () => {
    const html = '<meta property="og:image" content="../img/hero.jpg">';
    expect(parseOgImage(html, PAGE)).toBe('https://example.com/img/hero.jpg');
  });

  it('skips unparseable URLs and keeps scanning', () => {
    const html = '<meta property="og:image" content="http://"><meta name="twitter:image" content="https://ok.example.com/x.png">';
    expect(parseOgImage(html, PAGE)).toBe('https://ok.example.com/x.png');
  });

  it('returns null when nothing matches', () => {
    expect(parseOgImage('<html><body>hi</body></html>', PAGE)).toBeNull();
    expect(parseOgImage('<meta property="og:title" content="t">', PAGE)).toBeNull();
  });
});
