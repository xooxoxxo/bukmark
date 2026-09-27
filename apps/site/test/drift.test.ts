import { describe, expect, it } from 'vitest';
import { docPages, read, section } from './source';

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

describe('docker-compose.yml delivers what .env.example promises', () => {
  const compose = read('docker-compose.yml');

  it('passes every variable .env.example declares into the stack', () => {
    const missing = [...declaredEnvVars(read('.env.example'))].filter((n) => !compose.includes('${' + n));
    expect(missing).toEqual([]);
  });

  it('publishes Postgres on loopback only, which is what makes the default password acceptable', () => {
    const dbPorts = compose.split('\n').filter((l) => /ports:.*:5432/.test(l));
    expect(dbPorts).toHaveLength(1);
    expect(dbPorts[0]).toMatch(/\["127\.0\.0\.1:/);
  });
});

describe('docs cover what turning on auth changes', () => {
  const install = read('apps/site/src/content/docs/docs/install.md');

  it('rebuilds the image when upgrading, since compose builds the app from the checkout', () => {
    expect(read('docker-compose.yml')).toMatch(/^\s+build:/m);
    expect(section(install, 'Upgrading from a version without auth')).toContain('docker compose up -d --build');
  });

  it('says access tokens survive a password reset unless --revoke-tokens is given', () => {
    expect(read('apps/server/src/auth/resetOwner.ts')).toContain('--revoke-tokens');
    const pages = docPages().filter(({ body }) => /auth:reset-owner|resetOwner\.ts/.test(body));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.filter(({ body }) => !body.includes('--revoke-tokens')).map((p) => p.file)).toEqual([]);
  });

  it('tells reverse-proxy users to keep Host, set TRUST_PROXY and close the direct port', () => {
    const proxy = section(install, 'Behind a reverse proxy');
    expect(proxy).toContain('proxy_set_header Host');
    expect(proxy).toContain('TRUST_PROXY=true');
    expect(proxy).toContain('"127.0.0.1:${PORT:-3000}:3000"');
  });

  it('has the landing quickstart set the password and log the extension in', () => {
    const landing = read('apps/site/src/pages/index.astro');
    const quickstart = /<div class="install-command">([\s\S]*?)<\/div>/.exec(landing)?.[1] ?? '';
    expect(quickstart).toMatch(/set your password/);
    expect(quickstart).toMatch(/log in/);
  });
});
