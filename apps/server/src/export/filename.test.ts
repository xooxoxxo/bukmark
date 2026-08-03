import { describe, expect, it } from 'vitest';
import { exportFilename, slugify } from './filename.js';

describe('slugify', () => {
  it('lowercases and keeps alphanumerics', () => {
    expect(slugify('Rust')).toBe('rust');
  });

  it('collapses runs of non-alphanumerics to a single hyphen', () => {
    expect(slugify('Rust / systems')).toBe('rust-systems');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --Rust--  ')).toBe('rust');
  });

  it('strips characters that would break a Content-Disposition header', () => {
    // A hub name is user-supplied. Newlines here would be header injection.
    expect(slugify('evil\r\nX-Injected: yes')).toBe('evil-x-injected-yes');
    expect(slugify('a"b')).toBe('a-b');
  });

  it('handles non-ascii by dropping it rather than mangling it', () => {
    expect(slugify('café ☕ notes')).toBe('caf-notes');
  });

  it('caps length at 40 characters with no trailing hyphen', () => {
    const out = slugify('a'.repeat(30) + ' ' + 'b'.repeat(30));
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('-')).toBe(false);
  });

  it('falls back to "export" when nothing survives', () => {
    expect(slugify('///')).toBe('export');
    expect(slugify('')).toBe('export');
  });
});

describe('exportFilename', () => {
  it('builds the documented shape', () => {
    expect(exportFilename('rust', 'html', '2026-07-31')).toBe('bukmark-rust-2026-07-31.html');
  });

  it('slugs the scope', () => {
    expect(exportFilename('Rust / systems', 'json', '2026-07-31')).toBe(
      'bukmark-rust-systems-2026-07-31.json',
    );
  });

  it('supports every format', () => {
    expect(exportFilename('all', 'csv', '2026-01-02')).toBe('bukmark-all-2026-01-02.csv');
  });
});
