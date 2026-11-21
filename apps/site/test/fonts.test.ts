import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { read, root } from './source';

describe('brand fonts', () => {
  it('serves both web app fonts from bundled assets', () => {
    const css = read('apps/web/src/global.css');
    const urls = [...css.matchAll(/src: url\('([^']+)'\)/g)].map(m => m[1]!);
    expect(urls.map(path => path.split('/').pop())).toEqual(['geist-latin.woff2', 'bricolage-800.ttf']);
    for (const path of urls) expect(existsSync(join(root, 'apps/web/src', path))).toBe(true);
    expect(read('apps/web/index.html')).not.toContain('fonts.googleapis.com');
  });

  // Served from the site and preloaded, a docs page paints in its own faces
  // instead of swapping them in after the first frame.
  it('the website serves its fonts itself and preloads them', () => {
    const css = read('apps/site/src/styles/custom.css');
    expect(css).not.toMatch(/@import url\(['"]?https:/);
    const files = [...css.matchAll(/src: url\('(\/fonts\/[^']+\.woff2)'\)/g)].map((m) => m[1]!);
    expect(files).toEqual(['/fonts/geist-latin.woff2']);
    for (const file of files) expect(existsSync(join(root, 'apps/site/public', file))).toBe(true);

    const config = read('apps/site/astro.config.mjs');
    expect(config).toContain("['geist-latin'].map");
    expect(config).toContain("rel: 'preload'");
    expect(read('apps/site/src/pages/index.astro')).toContain('<link rel="preload" href="/fonts/geist-latin.woff2" as="font"');
  });
});
