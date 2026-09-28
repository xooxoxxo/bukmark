/**
 * Draws every logo asset from one geometry: `pnpm --filter @bukmark/web icons`.
 *
 * The mark is plain shapes, so it is described, not traced: a stem, a bowl (a
 * circle plus the block below its centre) with a round counter, a V notch cut
 * from the bottom edge, and a dot. The numbers are measured from the brand
 * artwork, a 1254 px square. From them come the SVGs (the mark and the favicon,
 * for the web app and the site), the web app's install icons and PNG favicon,
 * the site's PNG favicon, and the extension's toolbar icons. src/pwa.test.ts
 * holds every committed file to this output.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, type Image } from './png';

interface Circle {
  x: number;
  y: number;
  r: number;
}

/** In artwork pixels. */
export const MARK = {
  left: 271,
  right: 982,
  top: 98,
  bottom: 1160,
  stemRight: 536,
  bowl: { x: 626.5, y: 728, r: 355.5 },
  counter: { x: 627, y: 728, r: 130 },
  notch: { x: 626.5, y: 980 },
  dot: { x: 856.5, y: 260, r: 82.5 },
};

const MARK_WIDTH = MARK.right - MARK.left;
const MARK_HEIGHT = MARK.bottom - MARK.top;

/** --bk-paper and --bk-accent from src/global.css. */
export const PAPER = [0xfb, 0xf7, 0xf3] as const;
export const ACCENT = [0xfd, 0x44, 0x1d] as const;
const ACCENT_HEX = `#${ACCENT.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

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

const n = (v: number) => String(Math.round(v * 100) / 100);

/** The same shapes as inMark, as SVG: the body with its counter cut out, and the dot. */
export function markShapes(fill = ACCENT_HEX): string {
  const { left, right, top, bottom, stemRight, bowl, counter, notch, dot } = MARK;
  // Where the stem's right edge meets the bowl's circle.
  const joinY = bowl.y - Math.sqrt(bowl.r ** 2 - (stemRight - bowl.x) ** 2);
  const body =
    `M${n(left)} ${n(top)}H${n(stemRight)}V${n(joinY)}` +
    `A${n(bowl.r)} ${n(bowl.r)} 0 0 1 ${n(right)} ${n(bowl.y)}` +
    `V${n(bottom)}L${n(notch.x)} ${n(notch.y)}L${n(left)} ${n(bottom)}Z`;
  const hole =
    `M${n(counter.x - counter.r)} ${n(counter.y)}` +
    `a${n(counter.r)} ${n(counter.r)} 0 1 0 ${n(2 * counter.r)} 0` +
    `a${n(counter.r)} ${n(counter.r)} 0 1 0 ${n(-2 * counter.r)} 0Z`;
  return (
    `<path fill="${fill}" fill-rule="evenodd" d="${body}${hole}"/>` +
    `<circle fill="${fill}" cx="${n(dot.x)}" cy="${n(dot.y)}" r="${n(dot.r)}"/>`
  );
}

/** The mark alone, its box tight around it: for headers and inline use. */
export function logoSvg(): string {
  const box = `${n(MARK.left)} ${n(MARK.top)} ${n(MARK_WIDTH)} ${n(MARK_HEIGHT)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${markShapes()}</svg>\n`;
}

/** The mark centred in a square, filling most of its height: for browser tabs. */
export function faviconSvg(): string {
  const side = MARK_HEIGHT / HEIGHT_SHARE.glyph;
  const x = MARK.left - (side - MARK_WIDTH) / 2;
  const y = MARK.top - (side - MARK_HEIGHT) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x)} ${n(y)} ${n(side)} ${n(side)}">${markShapes()}</svg>\n`;
}

const SAMPLES = 8;

/**
 * How much of each pixel the mark covers, 0–1, with one artwork pixel drawn as
 * `scale` pixels and the artwork's origin at (originX, originY).
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

/** `glyph`: a favicon or toolbar icon, where every pixel of height counts. */
export type Purpose = 'any' | 'maskable' | 'glyph';

export interface Icon {
  file: string;
  size: number;
  purpose: Purpose;
}

/** The web app manifest's icons, in apps/web/public. */
export const ICONS: Icon[] = [
  { file: 'icon-192.png', size: 192, purpose: 'any' },
  { file: 'icon-512.png', size: 512, purpose: 'any' },
  { file: 'icon-maskable-192.png', size: 192, purpose: 'maskable' },
  { file: 'icon-maskable-512.png', size: 512, purpose: 'maskable' },
];

/** Everything written, by path from apps/. */
export const PNGS: { path: string; icon: Icon }[] = [
  ...ICONS.map((icon) => ({ path: `web/public/${icon.file}`, icon })),
  { path: 'web/public/favicon.png', icon: { file: 'favicon.png', size: 64, purpose: 'glyph' } },
  { path: 'site/public/favicon.png', icon: { file: 'favicon.png', size: 64, purpose: 'glyph' } },
  ...[16, 32, 48, 128].map((size) => ({
    path: `extension/public/icons/icon-${size}.png`,
    icon: { file: `icon-${size}.png`, size, purpose: 'glyph' as const },
  })),
];

export const SVGS: { path: string; draw: () => string }[] = [
  { path: 'web/public/logo-mark.svg', draw: logoSvg },
  { path: 'web/public/favicon.svg', draw: faviconSvg },
  { path: 'site/public/logo-mark.svg', draw: logoSvg },
  { path: 'site/public/favicon.svg', draw: faviconSvg },
];

/**
 * Mark height as a share of the icon. A launcher may crop a maskable icon to
 * the circle of radius 40% (the manifest spec's safe zone); at 64% the mark's
 * outermost corners sit at 37%.
 */
const HEIGHT_SHARE: Record<Purpose, number> = { any: 0.8, maskable: 0.64, glyph: 0.94 };

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
  const appsDir = fileURLToPath(new URL('../../', import.meta.url));
  const write = (path: string, data: string | Uint8Array) => {
    mkdirSync(dirname(join(appsDir, path)), { recursive: true });
    writeFileSync(join(appsDir, path), data);
    console.log(`wrote apps/${path}`);
  };
  for (const { path, icon } of PNGS) write(path, encodePng(renderIcon(icon)));
  for (const { path, draw } of SVGS) write(path, draw());
}
