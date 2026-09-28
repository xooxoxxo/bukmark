import { describe, expect, it } from 'vitest';
import { captureFromParams, firstWebUrl, isWebUrl } from './capture';

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
