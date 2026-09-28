import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { read, sections, sourceFiles } from './source';

const docsDir = join(import.meta.dirname, '../src/content/docs/docs');

const slugs = new Set(
  readdirSync(docsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, '')),
);

describe('internal documentation links resolve', () => {
  it('every /docs/ link points at a page that exists', () => {
    const broken: string[] = [];
    for (const file of readdirSync(docsDir).filter((f) => f.endsWith('.md'))) {
      const body = readFileSync(join(docsDir, file), 'utf8');
      for (const m of body.matchAll(/\]\(\/docs\/([a-z0-9-]*)\/?[^)]*\)/g)) {
        const target = m[1] === '' ? 'index' : m[1];
        if (!slugs.has(target)) broken.push(`${file} -> /docs/${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('every #fragment names a heading on the page it points at', () => {
    // Starlight's heading ids: lower case, punctuation dropped, spaces to hyphens.
    const slug = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
    const ids = new Map(
      [...slugs].map((s) => [s, new Set(sections(readFileSync(join(docsDir, `${s}.md`), 'utf8')).map((h) => slug(h.title)))]),
    );
    const broken: string[] = [];
    for (const file of readdirSync(docsDir).filter((f) => f.endsWith('.md'))) {
      const body = readFileSync(join(docsDir, file), 'utf8');
      for (const m of body.matchAll(/\]\((?:\/docs\/([a-z0-9-]*)\/?)?#([^)\s]+)\)/g)) {
        const target = m[1] === undefined ? file.replace(/\.md$/, '') : m[1] || 'index';
        if (!ids.get(target)?.has(m[2]!)) broken.push(`${file} -> ${target}#${m[2]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('every docs link in the web app points at a page and heading that exist', () => {
    // The web app links out as `${DOCS_URL}<page>/#<heading>`.
    const slug = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
    const links: string[] = [];
    const broken: string[] = [];
    for (const file of sourceFiles('apps/web/src', ['.ts', '.tsx'])) {
      for (const m of read(file).matchAll(/\$\{DOCS_URL\}([a-z0-9-]*)\/?(?:#([^`'"\s]+))?/g)) {
        const page = m[1] || 'index';
        links.push(`${page}#${m[2] ?? ''}`);
        if (!slugs.has(page)) broken.push(`${file} -> ${page}`);
        else if (m[2] && !sections(readFileSync(join(docsDir, `${page}.md`), 'utf8')).some((h) => slug(h.title) === m[2])) {
          broken.push(`${file} -> ${page}#${m[2]}`);
        }
      }
    }
    expect(links).toContain('phone#ios-shortcut');
    expect(broken).toEqual([]);
  });

  it('has the docs index plus all nine documentation pages', () => {
    for (const s of ['index', 'install', 'extension', 'phone', 'sorting', 'export', 'cli', 'development', 'api', 'privacy']) {
      expect(slugs.has(s), `missing ${s}.md`).toBe(true);
    }
  });
});
