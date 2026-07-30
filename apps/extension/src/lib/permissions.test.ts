import { describe, expect, it } from 'vitest';
import { originPatternFor } from './permissions';

describe('originPatternFor', () => {
  it('builds a match pattern including the port', () => {
    expect(originPatternFor('http://localhost:3000')).toBe('http://localhost:3000/*');
  });

  it('keeps a non-default port on a hostname', () => {
    expect(originPatternFor('http://bookmarkt.example.com:8085')).toBe(
      'http://bookmarkt.example.com:8085/*',
    );
  });

  it('handles https', () => {
    expect(originPatternFor('https://books.example.com')).toBe('https://books.example.com/*');
  });

  it('ignores a path, since match patterns are per-origin', () => {
    expect(originPatternFor('http://localhost:3000/api/links')).toBe('http://localhost:3000/*');
  });

  it('tolerates a trailing slash', () => {
    expect(originPatternFor('http://localhost:3000/')).toBe('http://localhost:3000/*');
  });

  it('returns null for a non-http scheme', () => {
    expect(originPatternFor('ftp://localhost:3000')).toBeNull();
  });

  it('returns null for an unparseable url', () => {
    expect(originPatternFor('not a url')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(originPatternFor('')).toBeNull();
  });
});
