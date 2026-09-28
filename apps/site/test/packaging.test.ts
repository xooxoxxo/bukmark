import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../astro.config.mjs';
import { PACKAGING_FILES, packagingFiles } from '../src/packaging.mjs';
import { read, root, sections } from './source';

const cli = read('packaging/bin/bukmark');
const installer = read('packaging/install.sh');

/** The body of the first heredoc in `script` that starts on a line matching `opener`. */
function heredoc(script: string, opener: RegExp): string {
  const lines = script.split('\n');
  const start = lines.findIndex((l) => opener.test(l));
  if (start < 0) throw new Error(`no heredoc matching ${opener}`);
  const end = lines.findIndex((l, i) => i > start && l === 'EOF');
  return lines.slice(start + 1, end).join('\n');
}

/** Every `${NAME` a compose file interpolates. */
const composeVars = (compose: string) => new Set([...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]!));

const cliCompose = heredoc(cli, /^\s*cat >"\$tmp" <<'EOF'$/);
const cliEnv = heredoc(cli, /^\s*cat >"\$tmp" <<EOF$/);

describe('the site serves the installer and the command', () => {
  it('copies both into the build output byte for byte', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bukmark-site-'));
    try {
      const hook = packagingFiles().hooks['astro:build:done'];
      await hook({ dir: pathToFileURL(`${out}/`), logger: { info() {} } });
      for (const [published, source] of Object.entries(PACKAGING_FILES)) {
        expect(readFileSync(join(out, published)).equals(readFileSync(join(root, source))), published).toBe(true);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('runs that copy on every astro build', () => {
    const names = (config.integrations ?? []).flat().map((i) => i && 'name' in i && i.name);
    expect(names).toContain('bukmark:packaging-files');
  });

  it('publishes them as install.sh and bukmark, which is what install.sh downloads', () => {
    expect(Object.keys(PACKAGING_FILES).sort()).toEqual(['bukmark', 'install.sh']);
    expect(installer).toContain(`base=\${BUKMARK_DOWNLOAD_BASE:-${config.site}}`);
    expect(installer).toContain('download "$base/bukmark" "$tmp"');
  });

  it('serves both as plain UTF-8 text with a short cache', () => {
    const headers = read('apps/site/public/_headers');
    for (const path of Object.keys(PACKAGING_FILES)) {
      const rule = new RegExp(`^/${path.replace('.', '\\.')}\\n((?:[ \\t]+.*\\n?)+)`, 'm').exec(headers)?.[1] ?? '';
      expect(rule, path).toMatch(/^\s+Content-Type: text\/plain; charset=utf-8$/m);
      const maxAge = Number(/^\s+Cache-Control: public, max-age=(\d+)$/m.exec(rule)?.[1]);
      expect(maxAge, path).toBeGreaterThan(0);
      expect(maxAge, path).toBeLessThanOrEqual(3600);
    }
  });

  it('calls main on the last line of each script, so a partial download runs nothing', () => {
    expect(installer.trimEnd().split('\n').at(-1)).toBe('main "$@"');
    expect(cli.trimEnd().split('\n').at(-1)).toBe('main "$@"');
    expect(cli).toMatch(/^BUKMARK_CLI_VERSION=\d+\.\d+\.\d+$/m);
  });
});

describe('the command runs the same server as docker-compose.yml', () => {
  const source = read('docker-compose.yml');

  it('uses the same database image and health check', () => {
    for (const line of [/^\s+image: (pgvector\/\S+)$/m, /^\s+test: (\[.*pg_isready.*\])$/m]) {
      expect(cliCompose).toContain(line.exec(source)![1]);
    }
  });

  it('passes the app every setting docker-compose.yml does, bar the two it leaves out on purpose', () => {
    // POSTGRES_PORT: the command gives the database no host port at all.
    // CORS_ORIGINS: only for a web dev server, which a from-source checkout runs.
    const leftOut = new Set(['POSTGRES_PORT', 'CORS_ORIGINS']);
    const cliVars = composeVars(cliCompose);
    expect([...composeVars(source)].filter((n) => !leftOut.has(n) && !cliVars.has(n))).toEqual([]);
  });

  it('gives the database no port on the host', () => {
    expect(cliCompose.match(/ports:/g)).toHaveLength(1);
    // This machine only unless setup --lan (docs: Settings, BUKMARK_LISTEN).
    expect(cliCompose).toContain('ports: ["${BUKMARK_LISTEN:-127.0.0.1}:${PORT:-3000}:3000"]');
  });

  it('runs the image the release workflow publishes', () => {
    const published = /^\s+IMAGE: (\S+)$/m.exec(read('.github/workflows/image.yml'))?.[1];
    expect(published).toBeDefined();
    expect(cli).toContain(`DEFAULT_IMAGE=${published}\n`);
    expect(cliCompose).toContain(`\${BUKMARK_IMAGE:-${published}}:\${BUKMARK_VERSION:-latest}`);
  });

  it('writes a .env naming only settings its compose file reads', () => {
    const cliVars = composeVars(cliCompose);
    const written = [...cliEnv.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!);
    expect(written.length).toBeGreaterThan(0);
    expect(written.filter((n) => !cliVars.has(n))).toEqual([]);
  });

  it("keeps the caller's environment from overriding .env, bar the image it runs", () => {
    const unset = cli.match(/^unset ([^\n]*(?:\\\n[^\n]*)*)/m)?.[1]?.replace(/\\\n/g, ' ').split(/\s+/) ?? [];
    const overridable = new Set(['BUKMARK_IMAGE', 'BUKMARK_VERSION']);
    expect([...composeVars(cliCompose)].filter((n) => !overridable.has(n) && !unset.includes(n))).toEqual([]);
  });
});

describe('links in the command and the installer', () => {
  it('point at docs pages and headings that exist', () => {
    const slug = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
    const broken: string[] = [];
    let count = 0;
    for (const script of [cli, installer]) {
      for (const m of script.matchAll(/https:\/\/bukmark\.it\/docs\/([a-z0-9-]+)\/(?:#([a-z0-9-]+))?/g)) {
        count++;
        let page: string;
        try {
          page = read(`apps/site/src/content/docs/docs/${m[1]}.md`);
        } catch {
          broken.push(m[0]);
          continue;
        }
        if (m[2] && !sections(page).some((h) => slug(h.title) === m[2])) broken.push(m[0]);
      }
    }
    expect(count).toBeGreaterThan(0);
    expect(broken).toEqual([]);
  });
});
