import { describe, expect, it } from 'vitest';
import { copyText, sourceAddress } from './copyText';

describe('sourceAddress', () => {
  it('keeps host and path, drops the scheme, www., query and fragment', () => {
    expect(sourceAddress('https://www.example.com/article?utm_source=x#top')).toBe('example.com/article');
    expect(sourceAddress('http://blog.example.com/a/b/')).toBe('blog.example.com/a/b/');
  });

  it('gives the bare host for a site root, and keeps a port', () => {
    expect(sourceAddress('https://example.com/')).toBe('example.com');
    expect(sourceAddress('http://localhost:8080/notes')).toBe('localhost:8080/notes');
  });

  it('only drops www. as a whole label', () => {
    expect(sourceAddress('https://wwwexample.com/x')).toBe('wwwexample.com/x');
  });

  it('strips the scheme from an address the URL parser rejects', () => {
    expect(sourceAddress('https://www.bad host/x')).toBe('bad host/x');
  });
});

describe('copyText', () => {
  it('puts the passage in quotes, then the title and address on a dash line', () => {
    expect(
      copyText({
        text: 'The quoted passage.',
        sourceTitle: 'Example Article',
        sourceUrl: 'https://www.example.com/article',
      }),
    ).toBe('"The quoted passage."\n— Example Article, example.com/article');
  });

  it('falls back to the address alone when the title is empty or blank', () => {
    const quote = { text: 'Quote.', sourceUrl: 'https://example.com/path' };
    expect(copyText({ ...quote, sourceTitle: '' })).toBe('"Quote."\n— example.com/path');
    expect(copyText({ ...quote, sourceTitle: '   ' })).toBe('"Quote."\n— example.com/path');
  });

  it('keeps the line breaks inside the passage', () => {
    expect(copyText({ text: 'one\ntwo', sourceTitle: 'T', sourceUrl: 'https://a.com/' })).toBe(
      '"one\ntwo"\n— T, a.com',
    );
  });
});
