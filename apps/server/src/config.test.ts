import { describe, expect, it } from 'vitest';
import { isFeedOff, parseExtensionIds, parseTrustProxy } from './config.js';

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

describe('parseExtensionIds', () => {
  it('is unset (null) when empty, so the built-in default applies', () => {
    expect(parseExtensionIds(undefined)).toBeNull();
    expect(parseExtensionIds('')).toBeNull();
    expect(parseExtensionIds(' , ,')).toBeNull();
  });

  it('splits on commas, trims, and lowercases hex hashes to match redirect URLs', () => {
    expect(parseExtensionIds(' abcdefghijklmnopabcdefghijklmnop , 79D9F60576061D67A8A6A23EE099801CBDD1CEEF,'))
      .toEqual(['abcdefghijklmnopabcdefghijklmnop', '79d9f60576061d67a8a6a23ee099801cbdd1ceef']);
  });
});

describe('isFeedOff', () => {
  it('reads off, false, 0 and no as off; unset or a URL is not', () => {
    for (const v of ['off', 'OFF', ' false ', '0', 'no']) expect(isFeedOff(v)).toBe(true);
    for (const v of [undefined, '', 'https://example.test/releases']) expect(isFeedOff(v)).toBe(false);
  });
});
