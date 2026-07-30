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

  it('defaults to localhost so a fresh clone works with no configuration', () => {
    expect(DEFAULT_BASE_URL).toBe('http://localhost:3000');
  });

  it('never ships a private or tailnet default', () => {
    // A published default pointing at someone's LAN is both a leak and broken
    // for everyone else. Self-hosters set their own URL in the options page.
    expect(DEFAULT_BASE_URL).not.toMatch(/\b(?:10|127|192\.168|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./);
    expect(DEFAULT_BASE_URL).not.toContain('.home');
  });
});
