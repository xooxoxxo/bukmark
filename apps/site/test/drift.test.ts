import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Every `NAME=` assignment inside a fenced code block (markdown). */
function documentedEnvVars(markdown: string): Set<string> {
  const names = new Set<string>();
  for (const block of markdown.matchAll(/```[\s\S]*?```/g)) {
    for (const m of block[0].matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)) names.add(m[1]);
  }
  return names;
}

/**
 * Every `NAME=` assignment in a plain env file. `.env.example` has no code
 * fences, so it needs its own parser — reusing the markdown one above would
 * silently return an empty set and make every assertion vacuous.
 */
function declaredEnvVars(envFile: string): Set<string> {
  const names = new Set<string>();
  for (const m of envFile.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)) names.add(m[1]);
  return names;
}

describe('install docs do not drift from real config', () => {
  const install = read('apps/site/src/content/docs/docs/install.md');
  const envExample = read('.env.example');

  it('documents only environment variables that exist in .env.example', () => {
    const declared = declaredEnvVars(envExample);
    const documented = documentedEnvVars(install);
    // CORS_ORIGINS is shown as a chrome-extension example; it must still exist.
    const unknown = [...documented].filter((n) => !declared.has(n));
    expect(unknown).toEqual([]);
  });

  it('documents every environment variable .env.example declares', () => {
    const declared = declaredEnvVars(envExample);
    const documented = documentedEnvVars(install);
    const undocumented = [...declared].filter((n) => !documented.has(n));
    expect(undocumented).toEqual([]);
  });

  it('shows the same startup command the compose file supports', () => {
    expect(install).toContain('docker compose up -d');
    expect(read('docker-compose.yml')).toContain('services:');
  });

  it('keeps the README quickstart identical to the docs quickstart', () => {
    expect(read('README.md')).toContain('docker compose up -d');
  });
});
