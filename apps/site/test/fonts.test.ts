import { describe, expect, it } from 'vitest';
import { read } from './source';

// Google Fonts answers a request whose axis range exceeds the font's with the
// other families only: Bricolage vanished from both apps while this read 12..120.
describe('brand fonts', () => {
  it.each(['apps/site/src/styles/custom.css', 'apps/web/src/global.css'])('%s asks for Bricolage within its axes', (file) => {
    const css = read(file);
    const url = /@import url\('(https:\/\/fonts\.googleapis\.com\/css2\?[^']+)'\)/.exec(css)?.[1] ?? '';
    const bricolage = /family=Bricolage\+Grotesque:opsz,wght@([^&]+)/.exec(url)?.[1];
    expect(bricolage).toBe('12..96,400..800');
    expect(url).toContain('family=Geist:');
  });
});
