import { describe, expect, it } from 'vitest';
import { MAX_TEXT, pageText } from './pageText.js';

describe('pageText', () => {
  it('keeps the words and drops scripts, styles, navigation and comments', () => {
    const html = `<html><head><title>T</title><style>p{}</style></head><body>
      <nav><a href="/">Home</a> <a href="/about">About</a></nav>
      <script>var secret = 1;</script><!-- hidden -->
      <h1>Rust ownership</h1><p>Every value has an <em>owner</em>.</p>
      <footer>© 2026 Somebody</footer></body></html>`;
    expect(pageText(html)).toBe('Rust ownership\nEvery value has an owner.');
  });

  it('decodes entities, named and numeric', () => {
    expect(pageText('<p>Tom &amp; Jerry &#8212; &#x2014; caf&eacute;&nbsp;x</p>')).toBe('Tom & Jerry — — caf&eacute; x');
  });

  it('prefers the article when the page marks one out', () => {
    const article = 'The article itself. '.repeat(40);
    const html = `<body><div>${'Sidebar link. '.repeat(60)}</div><article><p>${article}</p></article></body>`;
    expect(pageText(html)).toBe(article.trim());
  });

  it('keeps the whole body when the article is only a teaser in a longer page', () => {
    const html = `<body><p>${'Main text here. '.repeat(40)}</p><article>Teaser</article></body>`;
    expect(pageText(html)).toContain('Main text here.');
  });

  it('says there is no text when there is none', () => {
    expect(pageText('<html><body><script>x()</script></body></html>')).toBeNull();
  });

  it('keeps at most MAX_TEXT characters', () => {
    expect(pageText(`<p>${'a'.repeat(MAX_TEXT + 50)}</p>`)!.length).toBe(MAX_TEXT);
  });
});
