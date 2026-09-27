import { afterEach, describe, expect, it } from 'vitest';
import { RateLimiter, clientKey } from './rateLimit.js';

describe('clientKey', () => {
  it('keeps IPv4 addresses and unwraps IPv4-mapped IPv6', () => {
    expect(clientKey('198.51.100.7')).toBe('198.51.100.7');
    expect(clientKey('::ffff:198.51.100.7')).toBe('198.51.100.7');
  });

  it('groups IPv6 clients by /64, however the address is written', () => {
    const key = clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(key).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8:1:2::1')).toBe(key);
    expect(clientKey('2001:0DB8:0001:0002:0:0:0:ffff')).toBe(key);
    expect(clientKey('2001:db8:1:3::1')).not.toBe(key);
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
  });
});

describe('RateLimiter', () => {
  let limiter: RateLimiter;
  afterEach(() => limiter.close());

  it('allows the limit, then refuses with a retry-after in seconds', () => {
    limiter = new RateLimiter();
    for (let i = 0; i < 10; i++) expect(limiter.check('198.51.100.7', 'login').allowed).toBe(true);
    const refused = limiter.check('198.51.100.7', 'login');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfter).toBeGreaterThan(14 * 60);
    expect(refused.retryAfter).toBeLessThanOrEqual(15 * 60);
    expect(limiter.check('198.51.100.7', 'setup').allowed).toBe(true);
    expect(limiter.check('198.51.100.8', 'login').allowed).toBe(true);
  });

  it('counts a whole IPv6 /64 as one client', () => {
    limiter = new RateLimiter();
    for (let i = 0; i < 10; i++) limiter.check(`2001:db8:1:2::${i + 1}`, 'login');
    expect(limiter.check('2001:db8:1:2::ffff', 'login').allowed).toBe(false);
  });

  it('reset clears one bucket', () => {
    limiter = new RateLimiter();
    for (let i = 0; i < 11; i++) limiter.check('198.51.100.7', 'login');
    limiter.reset('198.51.100.7', 'login');
    expect(limiter.check('198.51.100.7', 'login').allowed).toBe(true);
  });

  it('never holds more than maxEntries buckets, evicting the oldest', () => {
    limiter = new RateLimiter(3);
    for (let i = 0; i < 100; i++) limiter.check(`10.0.0.${i}`, 'login');
    expect(limiter.size).toBe(3);
    for (let i = 0; i < 10; i++) limiter.check('10.0.0.99', 'login');
    expect(limiter.check('10.0.0.99', 'login').allowed).toBe(false);
  });
});
