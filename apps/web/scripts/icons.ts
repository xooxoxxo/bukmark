/**
 * Draws the web app icons from the logo mark: `pnpm --filter @bukmark/web icons`.
 *
 * public/logo-mark.png is a 140×200 raster with hard edges, so scaling it up
 * to 512 px would show every stair-step. The mark is plain geometry, so it is
 * redrawn from shapes fitted to that file instead; src/pwa.test.ts holds the
 * fit to the PNG and the committed icons to this output.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, type Image } from './png';

interface Circle {
  x: number;
  y: number;
  r: number;
}

/**
 * In logo-mark.png pixels: a stem, a bowl (a circle plus the block below its
 * centre) with a round counter, a V notch cut from the bottom edge, and a dot.
 */
const MARK = {
  left: 16.9,
  right: 108.1,
  top: 13,
  bottom: 166.2,
  stemRight: 53,
  bowl: { x: 62.2, y: 98.25, r: 46 },
  counter: { x: 62.35, y: 99.4, r: 15.4 },
  notch: { x: 62.5, y: 142.65 },
  dot: { x: 93.25, y: 35.75, r: 11 },
};

const MARK_WIDTH = MARK.right - MARK.left;
const MARK_HEIGHT = MARK.bottom - MARK.top;

/** --bk-paper and --bk-accent from src/global.css. */
export const PAPER = [0xfb, 0xf7, 0xf3] as const;
export const ACCENT = [0xfd, 0x44, 0x1d] as const;

function inCircle({ x: cx, y: cy, r }: Circle, x: number, y: number): boolean {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inMark(x: number, y: number): boolean {
  if (inCircle(MARK.dot, x, y)) return true;
  if (x < MARK.left || x > MARK.right || y < MARK.top || y > MARK.bottom) return false;
  if (x > MARK.stemRight && y < MARK.bowl.y && !inCircle(MARK.bowl, x, y)) return false;
  if (inCircle(MARK.counter, x, y)) return false;
  const { notch } = MARK;
  const floor =
    x <= notch.x
      ? MARK.bottom - ((MARK.bottom - notch.y) * (x - MARK.left)) / (notch.x - MARK.left)
      : MARK.bottom - ((MARK.bottom - notch.y) * (MARK.right - x)) / (MARK.right - notch.x);
  return y <= floor;
}

const SAMPLES = 8;

/**
 * How much of each pixel the mark covers, 0–1, with one logo pixel drawn as
 * `scale` pixels and the logo's origin at (originX, originY).
 */
export function markCoverage(
  width: number,
  height: number,
  scale: number,
  originX = 0,
  originY = 0,
): Float64Array {
  const cover = new Float64Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        const y = (py + (sy + 0.5) / SAMPLES - originY) / scale;
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (inMark((px + (sx + 0.5) / SAMPLES - originX) / scale, y)) hits++;
        }
      }
      cover[py * width + px] = hits / (SAMPLES * SAMPLES);
    }
  }
  return cover;
}

export interface Icon {
  file: string;
  size: number;
  purpose: 'any' | 'maskable';
}

export const ICONS: Icon[] = [
  { file: 'icon-192.png', size: 192, purpose: 'any' },
  { file: 'icon-512.png', size: 512, purpose: 'any' },
  { file: 'icon-maskable-192.png', size: 192, purpose: 'maskable' },
  { file: 'icon-maskable-512.png', size: 512, purpose: 'maskable' },
];

/**
 * Mark height as a share of the icon. A launcher may crop a maskable icon to
 * the circle of radius 40% (the manifest spec's safe zone); at 64% the mark's
 * outermost corners sit at 37%.
 */
const HEIGHT_SHARE = { any: 0.8, maskable: 0.64 };

export function renderIcon({ size, purpose }: Icon): Image {
  const scale = (size * HEIGHT_SHARE[purpose]) / MARK_HEIGHT;
  const cover = markCoverage(
    size,
    size,
    scale,
    (size - MARK_WIDTH * scale) / 2 - MARK.left * scale,
    (size - MARK_HEIGHT * scale) / 2 - MARK.top * scale,
  );
  const rgba = new Uint8Array(size * size * 4);
  cover.forEach((c, i) => {
    if (purpose === 'maskable') {
      // Maskable icons are full-bleed: the launcher supplies the shape, not transparency.
      for (let ch = 0; ch < 3; ch++) {
        rgba[i * 4 + ch] = Math.round(PAPER[ch]! + (ACCENT[ch]! - PAPER[ch]!) * c);
      }
      rgba[i * 4 + 3] = 255;
    } else {
      // Accent under the transparent pixels too, so scaling never blends in a dark fringe.
      rgba.set(ACCENT, i * 4);
      rgba[i * 4 + 3] = Math.round(255 * c);
    }
  });
  return { width: size, height: size, rgba };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
  for (const icon of ICONS) {
    writeFileSync(join(publicDir, icon.file), encodePng(renderIcon(icon)));
    console.log(`wrote public/${icon.file}`);
  }
}
