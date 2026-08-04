import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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

  it('has the docs index plus all seven documentation pages', () => {
    for (const s of ['index', 'install', 'extension', 'sorting', 'export', 'cli', 'development', 'api']) {
      expect(slugs.has(s), `missing ${s}.md`).toBe(true);
    }
  });
});
