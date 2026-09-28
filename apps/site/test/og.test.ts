import { describe, expect, it } from 'vitest';
import { OG_HEIGHT, OG_WIDTH, renderDocCard, renderHomeCard } from '../src/og/render';
import { docPages, read } from './source';

/** Width and height from a PNG's IHDR chunk. */
const size = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

describe('share images', () => {
  it('draws the landing card and a docs card at 1200x630, the size every network crops to', async () => {
    for (const png of [await renderHomeCard(), await renderDocCard('Install', 'Run bukmark with Docker.', '/docs/install/')]) {
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(size(png)).toEqual({ width: OG_WIDTH, height: OG_HEIGHT });
      expect([OG_WIDTH, OG_HEIGHT]).toEqual([1200, 630]);
    }
  });

  it('gives the landing page a large card with its own image, title and alt text', () => {
    const landing = read('apps/site/src/pages/index.astro');
    for (const tag of ['og:title', 'og:description', 'og:image', 'og:image:alt', 'twitter:image', 'twitter:image:alt']) {
      expect(landing).toContain(`"${tag}"`);
    }
    expect(landing).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(landing).toContain("image: 'https://bukmark.it/og/home.png'");
  });

  it('gives every docs page a card at the path the image route writes', () => {
    const middleware = read('apps/site/src/routeData.ts');
    const route = read('apps/site/src/pages/og/[...slug].png.ts');
    expect(middleware).toContain('`${SITE}/og/${id}.png`');
    expect(route).toContain("entry.id === 'docs' ? 'docs/index' : entry.id");
    expect(middleware).toContain("route.entry.id === 'docs' ? 'docs/index' : route.entry.id");
    expect(read('apps/site/astro.config.mjs')).toContain("routeMiddleware: './src/routeData.ts'");
    expect(docPages().length).toBeGreaterThan(5);
  });
});
