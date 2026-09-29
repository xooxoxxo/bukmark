import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// jsdom applies no CSS, so the rules from design.md that live only in
// stylesheets are checked against the source text.
const srcDir = dirname(fileURLToPath(import.meta.url));
const stylesheets: Record<string, string> = Object.fromEntries(
  readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.module.css'))
    .map((path) => [`./${path.split('\\').join('/')}`, readFileSync(join(srcDir, path), 'utf8')]),
);

interface Rule {
  file: string;
  selector: string;
  body: string;
}

function rulesOf(file: string, css: string): Rule[] {
  const rules: Rule[] = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ file, selector: (match[1] ?? '').trim(), body: match[2] ?? '' });
  }
  return rules;
}

const rules = Object.entries(stylesheets).flatMap(([file, css]) => rulesOf(file, css));

function rule(file: string, selector: string): Rule {
  const found = rules.find((r) => r.file === file && r.selector === selector);
  if (!found) throw new Error(`${file} has no ${selector} rule`);
  return found;
}

describe('design.md rules in component stylesheets', () => {
  it('finds the stylesheets', () => {
    expect(Object.keys(stylesheets)).toContain('./pages/TokensPage.module.css');
    expect(Object.keys(stylesheets)).toContain('./components/AuthScreen.module.css');
  });

  it('draws no shadows; scrollbar thumbs in global.css are the only exception', () => {
    const shadowed = rules.filter((r) => /box-shadow/.test(r.body));
    expect(shadowed.map((r) => `${r.file} ${r.selector}`)).toEqual([]);
  });

  it('never removes the outline in a focus rule, so the global accent ring applies', () => {
    const hidden = rules.filter(
      (r) => /:focus/.test(r.selector) && /outline:\s*(none|0)\b/.test(r.body),
    );
    expect(hidden.map((r) => `${r.file} ${r.selector}`)).toEqual([]);
  });

  it('colours errors with --danger, never the accent that links use', () => {
    const accented = rules.filter(
      (r) => /error/i.test(r.selector) && /color:\s*var\(--bk-accent\)/.test(r.body),
    );
    expect(accented.map((r) => `${r.file} ${r.selector}`)).toEqual([]);
  });
});

describe('TokensPage stylesheet', () => {
  const file = './pages/TokensPage.module.css';

  it('scrolls inside the fixed-height shell, which hides overflow on desktop', () => {
    const { body } = rule(file, '.container');
    expect(body).toMatch(/flex:\s*1;/);
    expect(body).toMatch(/min-height:\s*0;/);
    expect(body).toMatch(/overflow-y:\s*auto;/);
  });

  it('fills the destructive confirm with --danger and outlines secondary buttons in ink', () => {
    expect(rule(file, '.confirmButton').body).toMatch(/background-color:\s*var\(--danger\)/);
    expect(rule(file, '.secondaryButton').body).toMatch(/border:\s*2px solid var\(--bk-ink\)/);
  });
});

describe('Quotes stylesheets', () => {
  const card = './components/QuoteCard.module.css';

  it('sets the passage larger than list text, keeps its line breaks, and rules it in the accent', () => {
    const { body } = rule(card, '.text');
    expect(body).toMatch(/white-space:\s*pre-line;/);
    expect(body).toMatch(/border-left:\s*2px solid var\(--bk-accent\);/);
    expect(body).toMatch(/font-size:\s*var\(--bk-text-md\);/);
  });

  it('colours card errors and the delete confirm with --danger', () => {
    expect(rule(card, '.error').body).toMatch(/color:\s*var\(--danger\)/);
    expect(rule(card, '.danger').body).toMatch(/background:\s*var\(--danger\)/);
  });

  it('keeps corners square', () => {
    const rounded = rules.filter(
      (r) => /Quote/.test(r.file) && /border-radius:\s*(?!0\b)/.test(r.body),
    );
    expect(rounded.map((r) => `${r.file} ${r.selector}`)).toEqual([]);
  });
});
