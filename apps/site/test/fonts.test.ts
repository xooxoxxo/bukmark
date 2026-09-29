import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { read, root } from './source';

// Google Fonts answers a request whose axis range exceeds the font's with the
// other families only: Bricolage vanished from both apps while this read 12..120.
describe('brand fonts', () => {
  it('the web app asks Google for Bricolage within its axes', () => {
    const css = read('apps/web/src/global.css');
    const url = /@import url\('(https:\/\/fonts\.googleapis\.com\/css2\?[^']+)'\)/.exec(css)?.[1] ?? '';
    const bricolage = /family=Bricolage\+Grotesque:opsz,wght@([^&]+)/.exec(url)?.[1];
    expect(bricolage).toBe('12..96,400..800');
    expect(url).toContain('family=Geist:');
  });

  // Served from the site and preloaded, a docs page paints in its own faces
  // instead of swapping them in after the first frame.
  it('the website serves its fonts itself and preloads them', () => {
    const css = read('apps/site/src/styles/custom.css');
    expect(css).not.toMatch(/@import url\(['"]?https:/);
    const files = [...css.matchAll(/src: url\('(\/fonts\/[^']+\.woff2)'\)/g)].map((m) => m[1]!);
    expect(files).toEqual(['/fonts/bricolage-grotesque-latin.woff2', '/fonts/geist-latin.woff2']);
    for (const file of files) expect(existsSync(join(root, 'apps/site/public', file))).toBe(true);

    const config = read('apps/site/astro.config.mjs');
    expect(config).toContain("['bricolage-grotesque-latin', 'geist-latin'].map");
    expect(config).toContain("rel: 'preload'");
    expect(read('apps/site/src/pages/index.astro')).toContain('<link rel="preload" href="/fonts/geist-latin.woff2" as="font"');
  });
});
