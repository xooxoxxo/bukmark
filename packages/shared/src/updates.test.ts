import { describe, expect, it } from 'vitest';
import { compareVersions } from './updates.js';

describe('compareVersions', () => {
  it('compares dotted numbers, not strings', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.3.0', '0.4.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('ignores a leading v and treats missing parts as 0', () => {
    expect(compareVersions('v0.4.0', '0.4.0')).toBe(0);
    expect(compareVersions('0.4', '0.4.0')).toBe(0);
    expect(compareVersions('0.4.1', 'v0.4')).toBeGreaterThan(0);
  });

  it('ignores a pre-release suffix', () => {
    expect(compareVersions('0.4.0-rc.1', '0.4.0')).toBe(0);
    expect(compareVersions('0.4.0-rc.1', '0.3.9')).toBeGreaterThan(0);
  });
});
