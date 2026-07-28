import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl, DEFAULT_BASE_URL } from './settings';

describe('normalizeBaseUrl', () => {
  it('strips a trailing slash so path joins do not double up', () => {
    expect(normalizeBaseUrl('http://host:8085/')).toBe('http://host:8085');
  });

  it('leaves a clean url alone', () => {
    expect(normalizeBaseUrl('http://host:8085')).toBe('http://host:8085');
  });

  it('trims surrounding whitespace from a pasted value', () => {
    expect(normalizeBaseUrl('  http://host:8085  ')).toBe('http://host:8085');
  });

  it('falls back to the default when given an empty string', () => {
    expect(normalizeBaseUrl('')).toBe(DEFAULT_BASE_URL);
  });

  it('defaults to the tailnet address, which resolves both at home and away', () => {
    expect(DEFAULT_BASE_URL).toBe('http://localhost:8085');
  });
});
