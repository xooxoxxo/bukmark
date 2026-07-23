import { describe, expect, it } from 'vitest';
import { isPrivateIp, resolvesToPublic } from './ssrfGuard.js';

describe('isPrivateIp', () => {
  const blocked = [
    '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1',
    '::1', '::', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip', '999.1.1.1', '10.0.0.01',
  ];
  const allowed = [
    '8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.255.255', '100.63.255.255',
    '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8',
  ];

  for (const ip of blocked) {
    it(`blocks ${ip}`, () => expect(isPrivateIp(ip)).toBe(true));
  }
  for (const ip of allowed) {
    it(`allows ${ip}`, () => expect(isPrivateIp(ip)).toBe(false));
  }
});

describe('resolvesToPublic (literal IPs, no DNS)', () => {
  it('rejects a loopback literal', async () => {
    expect(await resolvesToPublic('127.0.0.1')).toBe(false);
  });
  it('accepts a public literal', async () => {
    expect(await resolvesToPublic('8.8.8.8')).toBe(true);
  });
});
