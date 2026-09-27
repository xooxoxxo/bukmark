import { describe, expect, it } from 'vitest';
import { parseTrustProxy } from './config.js';

describe('parseTrustProxy', () => {
  it('trusts only the nearest proxy for TRUST_PROXY=true, never every hop', () => {
    expect(parseTrustProxy('true')).toBe(1);
  });

  it('is off by default', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('passes a hop count or proxy addresses through', () => {
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('10.0.0.0/8,127.0.0.1')).toBe('10.0.0.0/8,127.0.0.1');
  });
});
