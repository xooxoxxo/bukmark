import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const LIGHT = /(?:^|\n):root\s*\{([^}]*)\}/;
const DARK = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{([^}]*)\}/;

function tokens(css: string, block: RegExp): Record<string, string> {
  const body = block.exec(css)?.[1] ?? '';
  return Object.fromEntries(
    [...body.matchAll(/(--bk-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2]!.trim()]),
  );
}

const pages = { 'popup.html': read('../popup.html'), 'options.html': read('../options.html') };

describe('extension pages', () => {
  it.each(Object.entries(pages))('%s styles only through the shared token sheet', (_file, html) => {
    expect(html).toContain('<link rel="stylesheet" href="/src/ui.css" />');
    expect(html).not.toMatch(/<style|\sstyle="/);
  });

  it.each([
    ['popup.html', 'loginStatus'],
    ['popup.html', 'status'],
    ['options.html', 'urlStatus'],
    ['options.html', 'authStatus'],
    ['options.html', 'importStatus'],
  ] as const)('%s announces #%s politely', (file, id) => {
    const tag = new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`).exec(pages[file])?.[0] ?? '';
    expect(tag).toContain('role="status"');
    expect(tag).toContain('aria-live="polite"');
  });
});

describe('ui.css tokens', () => {
  const ui = read('./ui.css');
  const web = read('../../web/src/global.css');

  it('match the web app’s light palette and scales', () => {
    expect(Object.keys(tokens(ui, LIGHT)).length).toBeGreaterThan(20);
    expect(tokens(ui, LIGHT)).toEqual(tokens(web, LIGHT));
  });

  it('match the web app’s dark palette', () => {
    expect(Object.keys(tokens(ui, DARK))).toHaveLength(6);
    expect(tokens(ui, DARK)).toEqual(tokens(web, DARK));
  });

  it('keep colour literals inside the token blocks', () => {
    const rules = ui.replace(LIGHT, '').replace(DARK, '');
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|oklch\(|rgba?\(/i);
  });
});
