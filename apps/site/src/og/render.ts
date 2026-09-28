/**
 * Share images (Open Graph / X cards), drawn at build time from the brand's
 * own fonts and colours: satori lays the card out, resvg turns it into a PNG.
 * No browser is involved, so any machine that builds the site draws the same
 * cards.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

// Exact brand values (src/styles/custom.css).
const PAPER = '#fbf7f3';
const INK = '#0e0f13';
const ACCENT = '#fd441d';
const MUTED_ON_INK = '#b9b3ad';
const MUTED_ON_PAPER = '#5d5750';

// From the site's folder, where every build runs: import.meta.url points into
// the bundler's output by the time this code runs.
const SITE_DIR = process.cwd();
const font = (file: string) => readFileSync(join(SITE_DIR, 'src/og/fonts', file));
const FONTS = [
  { name: 'Bricolage', data: font('bricolage-800.ttf'), weight: 800 as const, style: 'normal' as const },
  { name: 'Geist', data: font('geist-500.ttf'), weight: 500 as const, style: 'normal' as const },
  { name: 'Geist', data: font('geist-700.ttf'), weight: 700 as const, style: 'normal' as const },
  { name: 'Geist Mono', data: font('geist-mono-500.ttf'), weight: 500 as const, style: 'normal' as const },
];

const LOGO = `data:image/svg+xml;base64,${readFileSync(join(SITE_DIR, 'public/logo-mark.svg')).toString('base64')}`;

type Style = Record<string, string | number>;
interface Node {
  type: string;
  props: { style?: Style; src?: string; width?: number; height?: number; children?: Child | Child[] };
}
type Child = Node | string | null;

const h = (type: string, style: Style, children?: Child | Child[], extra: Omit<Node['props'], 'style' | 'children'> = {}): Node => ({
  type,
  props: { style: { display: 'flex', ...style }, children, ...extra },
});

function brand(color: string): Node {
  return h('div', { alignItems: 'center', gap: 18 }, [
    h('img', { width: 40, height: 60 }, null, { src: LOGO, width: 40, height: 60 }),
    h('div', { fontFamily: 'Bricolage', fontSize: 46, color, letterSpacing: -1 }, 'bukmark'),
  ]);
}

const chip = (text: string, color: string): Node =>
  h('div', { padding: '10px 18px', border: `3px solid ${color}`, color, fontFamily: 'Geist', fontWeight: 700, fontSize: 24 }, text);

/** The landing page's card: the promise, what it is, and where it runs. */
function homeCard(): Node {
  return h('div', { width: OG_WIDTH, height: OG_HEIGHT, flexDirection: 'column', background: INK, color: PAPER }, [
    h('div', { flex: 1, flexDirection: 'column', justifyContent: 'space-between', padding: '56px 72px 44px' }, [
      h('div', { justifyContent: 'space-between', alignItems: 'center' }, [
        brand(PAPER),
        h('div', { fontFamily: 'Geist Mono', fontSize: 26, color: ACCENT }, 'bukmark.it'),
      ]),
      h('div', { flexDirection: 'column', fontFamily: 'Bricolage', fontSize: 148, lineHeight: 0.9, letterSpacing: -7 }, [
        h('div', {}, 'Bookmarks'),
        h('div', {}, [h('span', {}, 'you own'), h('span', { color: ACCENT }, '.')]),
      ]),
      h('div', { flexDirection: 'column', gap: 22 }, [
        h('div', { fontFamily: 'Geist', fontWeight: 500, fontSize: 32, color: MUTED_ON_INK }, 'Save any page in one click. Search what you saved. Sort it with AI.'),
        h('div', { gap: 14 }, [chip('Self-hosted', PAPER), chip('Open source', PAPER), chip('Chrome · Firefox · Safari', PAPER)]),
      ]),
    ]),
    h('div', { height: 18, background: ACCENT }),
  ]);
}

/** A docs page's card: which page, what it covers, under the brand. */
function docCard(title: string, description: string, path: string): Node {
  const size = title.length > 28 ? 88 : title.length > 18 ? 104 : 124;
  return h('div', { width: OG_WIDTH, height: OG_HEIGHT, flexDirection: 'column', background: PAPER, color: INK }, [
    h('div', { height: 18, background: ACCENT }),
    h('div', { flex: 1, flexDirection: 'column', justifyContent: 'space-between', padding: '48px 72px 52px' }, [
      h('div', { justifyContent: 'space-between', alignItems: 'center' }, [
        brand(INK),
        h('div', { padding: '8px 16px', background: INK, color: PAPER, fontFamily: 'Geist', fontWeight: 700, fontSize: 24, letterSpacing: 2 }, 'DOCS'),
      ]),
      h('div', { flexDirection: 'column', gap: 24 }, [
        h('div', { fontFamily: 'Bricolage', fontSize: size, lineHeight: 0.95, letterSpacing: -4 }, title),
        h('div', { fontFamily: 'Geist', fontWeight: 500, fontSize: 32, lineHeight: 1.35, color: MUTED_ON_PAPER, maxWidth: 1000 }, description),
      ]),
      h('div', { fontFamily: 'Geist Mono', fontSize: 24, color: ACCENT }, `bukmark.it${path}`),
    ]),
  ]);
}

async function toPng(node: Node): Promise<Buffer> {
  const svg = await satori(node as unknown as Parameters<typeof satori>[0], { width: OG_WIDTH, height: OG_HEIGHT, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
}

export const renderHomeCard = () => toPng(homeCard());
export const renderDocCard = (title: string, description: string, path: string) => toPng(docCard(title, description, path));
