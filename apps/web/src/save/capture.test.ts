import { describe, expect, it } from 'vitest';
import { captureFromParams, firstWebUrl, isWebUrl, quoteFromParams } from './capture';

describe('firstWebUrl', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['Look at this https://example.com/a?b=1&c=2#top please', 'https://example.com/a?b=1&c=2#top'],
    ['Headline\nhttps://example.com/story', 'https://example.com/story'],
    ['Read https://example.com/a.', 'https://example.com/a'],
    ['"https://example.com/a", she said', 'https://example.com/a'],
    ['(see https://example.com/a)', 'https://example.com/a'],
    ['[docs](https://example.com/a)', 'https://example.com/a'],
    ['<https://example.com/a>', 'https://example.com/a'],
    ['https://en.wikipedia.org/wiki/Heat_(1995_film)', 'https://en.wikipedia.org/wiki/Heat_(1995_film)'],
    ['(https://en.wikipedia.org/wiki/Heat_(1995_film)).', 'https://en.wikipedia.org/wiki/Heat_(1995_film)'],
    ['HTTP://EXAMPLE.COM/A', 'HTTP://EXAMPLE.COM/A'],
    ['first http://one.example then https://two.example', 'http://one.example'],
  ])('finds the link in %j', (text, url) => {
    expect(firstWebUrl(text)).toBe(url);
  });

  it.each([
    'no link here',
    'ftp://example.com/file javascript:alert(1)',
    'https:// is not a link',
    '',
  ])('finds nothing in %j', (text) => {
    expect(firstWebUrl(text)).toBe('');
  });

  it('skips a broken candidate and takes the next real link', () => {
    expect(firstWebUrl('https://. then https://example.com/a')).toBe('https://example.com/a');
  });
});

describe('isWebUrl', () => {
  it.each(['https://example.com', 'http://localhost:3000/a', '  https://example.com/a  '])(
    'accepts %j',
    (value) => expect(isWebUrl(value)).toBe(true),
  );

  it.each(['javascript:alert(1)', 'ftp://example.com', 'example.com', 'data:text/html,hi', ''])(
    'refuses %j',
    (value) => expect(isWebUrl(value)).toBe(false),
  );
});

describe('captureFromParams', () => {
  const capture = (query: string) => captureFromParams(new URLSearchParams(query));

  it('takes url and title as given (the bookmarklet)', () => {
    expect(capture('url=https%3A%2F%2Fexample.com%2Fa&title=Example')).toEqual({
      url: 'https://example.com/a',
      title: 'Example',
    });
  });

  it('takes the link from text when url is empty (Android share)', () => {
    expect(capture('title=Example&text=Example%20https%3A%2F%2Fexample.com%2Fa&url=')).toEqual({
      url: 'https://example.com/a',
      title: 'Example',
    });
  });

  it('prefers url over a link in text', () => {
    expect(
      capture('url=https%3A%2F%2Fexample.com%2Fa&text=https%3A%2F%2Fexample.com%2Fb').url,
    ).toBe('https://example.com/a');
  });

  it('keeps a url that is not a web link, for the page to refuse visibly', () => {
    expect(capture('url=javascript%3Aalert(1)&text=https%3A%2F%2Fexample.com%2Fa').url).toBe(
      'javascript:alert(1)',
    );
  });

  it('falls back to a link in title, and does not repeat it as the title', () => {
    expect(capture('title=https%3A%2F%2Fexample.com%2Fa')).toEqual({
      url: 'https://example.com/a',
      title: '',
    });
  });

  it('trims what it is given and starts empty when nothing was shared', () => {
    expect(capture('url=%20https%3A%2F%2Fexample.com%2Fa%20&title=%20Example%20')).toEqual({
      url: 'https://example.com/a',
      title: 'Example',
    });
    expect(capture('')).toEqual({ url: '', title: '' });
  });
});

describe('quoteFromParams', () => {
  const quote = (params: Record<string, string>) => {
    const search = new URLSearchParams(params);
    return quoteFromParams(search, captureFromParams(search));
  };
  const PAGE = 'https://example.com/a';

  it('takes the text shared with a url as the quote', () => {
    expect(quote({ url: PAGE, title: 'Example', text: 'A passage worth keeping.' })).toBe(
      'A passage worth keeping.',
    );
  });

  it.each([
    ['at its end', `A passage.\n${PAGE}`],
    ['after a space', `A passage. ${PAGE}`],
    ['with a text fragment', `A passage.\n${PAGE}#:~:text=A%20passage`],
    ['written differently', 'A passage.\nhttp://www.example.com/a/'],
  ])('strips the page url from the end of the text %s', (_, text) => {
    expect(quote({ url: PAGE, text })).toBe('A passage.');
  });

  it('keeps a link that is not the page, at the end or in the middle', () => {
    expect(quote({ url: PAGE, text: 'See https://other.example/b' })).toBe('See https://other.example/b');
    expect(quote({ url: PAGE, text: `Visit ${PAGE} for more` })).toBe(`Visit ${PAGE} for more`);
  });

  it('keeps the newlines of the selection and drops the quote marks Chrome wraps it in', () => {
    expect(quote({ text: `"First line.\nSecond line."\n${PAGE}#:~:text=First` })).toBe(
      'First line.\nSecond line.',
    );
    expect(quote({ url: PAGE, text: '“Curly.”' })).toBe('Curly.');
    expect(quote({ url: PAGE, text: '"Opened" and "closed"' })).toBe('"Opened" and "closed"');
  });

  it.each([
    ['a url only', { url: PAGE, text: PAGE }],
    ['a url only, with the url field empty', { url: '', text: PAGE }],
    ['another url only', { url: PAGE, text: 'https://other.example/b' }],
    ['the title and the url', { title: 'Example page', text: `Example page ${PAGE}` }],
    ['nothing', { url: PAGE, title: 'Example' }],
    ['blank text', { url: PAGE, text: '  \n ' }],
    ['text with no page to quote from', { text: 'just some words' }],
    ['text with a page that cannot be saved', { url: 'javascript:alert(1)', text: 'words' }],
  ])('is empty for %s', (_, params) => {
    expect(quote(params)).toBe('');
  });
});
