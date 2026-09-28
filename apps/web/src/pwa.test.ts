import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCENT, ICONS, PAPER, markCoverage, renderIcon } from '../scripts/icons';
import { decodePng } from '../scripts/png';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(webDir, 'public');
const manifest = JSON.parse(readFileSync(join(publicDir, 'manifest.webmanifest'), 'utf8')) as {
  icons: ManifestIcon[];
  [member: string]: unknown;
};

const readPng = (file: string) => decodePng(readFileSync(join(publicDir, file)));
const hex = (rgb: readonly number[]) =>
  `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/** A light-mode brand token from global.css. */
function token(name: string): string {
  const css = readFileSync(join(webDir, 'src/global.css'), 'utf8');
  const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
  const value = root.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();
  if (!value) throw new Error(`global.css :root has no ${name}`);
  return value;
}

describe('web app manifest', () => {
  it('is linked from index.html', () => {
    const html = readFileSync(join(webDir, 'index.html'), 'utf8');
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
  });

  // Chrome's install criteria (https://web.dev/articles/install-criteria, updated
  // 2024-09-19): HTTPS, plus a manifest with name or short_name, 192 and 512 px
  // icons, start_url, a standalone-like display, and no prefer_related_applications.
  // No service worker: Chrome stopped requiring one to install from the menu in
  // 108 on Android and 112 on desktop (https://developer.chrome.com/blog/update-install-criteria).
  it("meets Chrome's install criteria", () => {
    expect(manifest.name).toBe('bukmark');
    expect(manifest.short_name).toBe('bukmark');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.prefer_related_applications).toBeUndefined();

    const anyPurpose = manifest.icons.filter((icon) => (icon.purpose ?? 'any') === 'any');
    expect(anyPurpose.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      const { width, height } = readPng(icon.src.replace(/^\//, ''));
      expect(`${width}x${height}`).toBe(icon.sizes);
    }
  });

  it('offers maskable icons for launchers that crop to a shape', () => {
    expect(
      manifest.icons.filter((icon) => icon.purpose === 'maskable').map((icon) => icon.sizes),
    ).toEqual(['192x192', '512x512']);
  });

  it('registers /save as a GET share target that receives title, text and url', () => {
    expect(manifest.share_target).toEqual({
      action: '/save',
      method: 'GET',
      // The only value GET allows, and the default; Chrome's manifest parser still warns without it.
      enctype: 'application/x-www-form-urlencoded',
      params: { title: 'title', text: 'text', url: 'url' },
    });
  });

  it('takes its colours from the brand tokens', () => {
    expect(manifest.background_color).toBe(token('--bk-paper'));
    expect(manifest.theme_color).toBe(token('--bk-ink'));
  });

  it('lists exactly the icons the generator draws', () => {
    expect(
      manifest.icons.map((icon) => ({
        file: icon.src.replace(/^\//, ''),
        size: Number(icon.sizes.split('x')[0]),
        purpose: icon.purpose,
      })),
    ).toEqual(ICONS);
  });
});

describe('icons', () => {
  it('draw the mark the logo artwork shows', () => {
    const logo = readPng('logo-mark.png');
    const cover = markCoverage(logo.width, logo.height, 1);
    let inked = 0;
    let differ = 0;
    cover.forEach((c, i) => {
      const alpha = logo.rgba[i * 4 + 3]!;
      if (alpha >= 128) inked++;
      if (c >= 0.5 !== alpha >= 128) differ++;
    });
    expect(inked).toBeGreaterThan(9000);
    // Only single stray edge pixels differ; a 1 px change to any shape costs far more.
    expect(differ / inked).toBeLessThan(0.005);
  });

  it('match the generator pixel for pixel (regenerate: `pnpm --filter @bukmark/web icons`)', () => {
    for (const icon of ICONS) {
      const shipped = readPng(icon.file);
      const drawn = renderIcon(icon);
      expect([shipped.width, shipped.height]).toEqual([icon.size, icon.size]);
      expect(Buffer.from(shipped.rgba).equals(Buffer.from(drawn.rgba)), icon.file).toBe(true);
    }
  });

  it('use the brand paper and accent', () => {
    expect(hex(PAPER)).toBe(token('--bk-paper'));
    expect(hex(ACCENT)).toBe(token('--bk-accent'));
  });

  it('draw the mark in the accent on transparency for purpose "any"', () => {
    for (const icon of ICONS.filter((i) => i.purpose === 'any')) {
      const { width, rgba } = readPng(icon.file);
      const alphaAt = (x: number, y: number) => rgba[(y * width + x) * 4 + 3];
      expect([alphaAt(0, 0), alphaAt(width - 1, width - 1)]).toEqual([0, 0]);

      let solid = 0;
      const colours = new Set<string>();
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] === 255) solid++;
        if (rgba[i + 3]! > 0) colours.add(hex([...rgba.subarray(i, i + 3)]));
      }
      expect([...colours]).toEqual([hex(ACCENT)]);
      expect(solid).toBeGreaterThan(width * width * 0.2);
    }
  });

  it('keep the maskable mark inside the 40% safe-zone circle on a full-bleed paper square', () => {
    for (const icon of ICONS.filter((i) => i.purpose === 'maskable')) {
      const { width, rgba } = readPng(icon.file);
      const centre = width / 2;
      const safe = width * 0.4;
      let accent = 0;
      const seeThrough: string[] = [];
      const outsideSafeZone: string[] = [];
      for (let y = 0; y < width; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const pixel = hex([...rgba.subarray(i, i + 3)]);
          if (rgba[i + 3] !== 255) seeThrough.push(`(${x}, ${y})`);
          if (Math.hypot(x + 0.5 - centre, y + 0.5 - centre) > safe && pixel !== hex(PAPER)) {
            outsideSafeZone.push(`(${x}, ${y}) ${pixel}`);
          }
          if (pixel === hex(ACCENT)) accent++;
        }
      }
      expect(seeThrough, icon.file).toEqual([]);
      expect(outsideSafeZone, icon.file).toEqual([]);
      expect(accent).toBeGreaterThan(width * width * 0.1);
    }
  });
});
