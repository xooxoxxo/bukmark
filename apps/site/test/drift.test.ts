import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../astro.config.mjs';
import { PACKAGING_FILES } from '../src/packaging.mjs';
import { docPages, read, root, section } from './source';

/** Every `NAME=` assignment inside a fenced code block (markdown). */
function documentedEnvVars(markdown: string): Set<string> {
  const names = new Set<string>();
  for (const block of markdown.matchAll(/```[\s\S]*?```/g)) {
    for (const m of block[0].matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)) names.add(m[1]);
  }
  return names;
}

/** Every non-empty line inside the fenced code blocks of `markdown`, trimmed. */
function fencedLines(markdown: string): string[] {
  return [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
    .flatMap((m) => m[1]!.split('\n'))
    .map((l) => l.trim())
    .filter(Boolean);
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

  it('gives the README only install commands the docs give, word for word', () => {
    const lines = fencedLines(read('README.md'));
    expect(lines).toContain('docker compose up -d');
    expect(lines.filter((l) => !install.includes(l))).toEqual([]);
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

  it('shows one install command on the landing page: the first way in that works today', () => {
    const landing = read('apps/site/src/pages/index.astro');
    expect(landing).toContain('const CHANNEL = CHANNELS.find((c) => c.live)!;');
    expect(landing).toContain("data-copy={CHANNEL.lines.join('\\n')}");
    expect(landing).not.toMatch(/role="tab"/);
  });

  it('offers on the landing page only install commands the install guide documents', () => {
    const landing = read('apps/site/src/pages/index.astro');
    const lines = [...landing.matchAll(/lines: \[([^\]]*)\]/g)].flatMap((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((q) => q[1]!));
    expect(lines).toContain('docker compose up -d');
    expect(lines.filter((l) => !install.includes(l))).toEqual([]);
  });
});

const cli = read('packaging/bin/bukmark');
const installer = read('packaging/install.sh');
const formula = read('packaging/homebrew/bukmark.rb');

/** Options such as `--port` and `-f` in a piece of a command line. */
const optionsIn = (text: string) => [...text.matchAll(/(?<![\w-])--?[a-z][a-z-]*/g)].map((m) => m[0]);

/** The commands `bukmark help` lists, each with the options it lists for it. */
function helpCommands(): Map<string, Set<string>> {
  const usage = /^usage\(\) \{\n\s*cat <<EOF\n([\s\S]*?)\nEOF$/m.exec(cli)?.[1] ?? '';
  const commands = new Map<string, Set<string>>();
  let last: Set<string> | undefined;
  for (const line of usage.slice(usage.indexOf('\nCommands:\n') + 11).split('\n')) {
    if (!line.trim()) break;
    const command = /^  ([a-z]+)((?: \S+)*)\s{2,}/.exec(line);
    const option = /^    (--?[a-z][a-z-]*)\s/.exec(line);
    if (command) commands.set(command[1]!, (last = new Set(optionsIn(command[2]!))));
    else if (option && last) last.add(option[1]!);
  }
  return commands;
}

/**
 * Every `bukmark <command> [options]` the markdown shows as code, inline or
 * fenced, plus the setup options it passes through `install.sh | sh -s --`.
 */
function documentedCommands(markdown: string): { command: string; options: string[]; text: string }[] {
  const code = [
    ...fencedLines(markdown),
    ...[...markdown.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!),
  ].map((text) => text.replace(/(?:^|\s)#.*$/, ''));
  const found: { command: string; options: string[]; text: string }[] = [];
  for (const text of code) {
    for (const m of text.matchAll(/(?<![\w./~-])bukmark ([a-z]+)([^|&;]*)/g)) {
      found.push({ command: m[1]!, options: optionsIn(m[2]!), text: m[0] });
    }
    for (const m of text.matchAll(/install\.sh \| sh -s -- ([^|&;]*)/g)) {
      found.push({ command: 'setup', options: optionsIn(m[1]!), text: m[0] });
    }
  }
  return found;
}

describe('install docs match the bukmark command, its installer and the formula', () => {
  const install = read('apps/site/src/content/docs/docs/install.md');
  const readme = read('README.md');
  const commandDocs = section(install, 'The bukmark command');
  const help = helpCommands();

  it('reads the command list from bukmark help', () => {
    expect([...help.keys()]).toEqual(expect.arrayContaining(['setup', 'update', 'uninstall', 'help']));
    expect([...help.get('setup')!].sort()).toEqual(['--lan', '--local', '--port']);
    expect([...help.get('uninstall')!].sort()).toEqual(['--delete-data', '--yes']);
  });

  it('shows only commands and options bukmark help lists', () => {
    const shown = [...documentedCommands(install), ...documentedCommands(readme)];
    expect(shown.length).toBeGreaterThan(10);
    const unknown = shown.filter(({ command, options }) => !help.has(command) || options.some((o) => !help.get(command)!.has(o)));
    expect(unknown.map((c) => c.text)).toEqual([]);
  });

  it('lists every command and option bukmark help lists, and the command runs each', () => {
    const main = /^main\(\) \{\n([\s\S]*?)^\}/m.exec(cli)?.[1] ?? '';
    for (const [command, options] of help) {
      expect(commandDocs, command).toContain('| `bukmark ' + command);
      for (const option of options) expect(commandDocs, option).toContain(option);
      expect(main, command).toMatch(new RegExp(`^\\s+${command}(?: \\|[^)]*)?\\)`, 'm'));
    }
  });

  it('gives the exit codes bukmark status has', () => {
    const status = /^cmd_status\(\) \{\n([\s\S]*?)^\}/m.exec(cli)?.[1] ?? '';
    const codes = new Set(['0', ...[...status.matchAll(/\bexit (\d+)/g)].map((m) => m[1]!)]);
    const row = commandDocs.split('\n').find((l) => l.startsWith('| `bukmark status`')) ?? '';
    const documented = new Set([...row.matchAll(/\b(\d+) when\b/g)].map((m) => m[1]!));
    expect([...documented].sort()).toEqual([...codes].sort());
  });

  it('runs the installer from the address the site serves it at', () => {
    expect(Object.keys(PACKAGING_FILES)).toContain('install.sh');
    const curl = `curl -fsSL ${config.site}/install.sh | sh`;
    for (const [file, text] of [['install.md', install], ['README.md', readme], ['install.sh', installer]]) {
      expect(text, file).toContain(curl);
    }
    // The installer hands the options after `sh -s --` to bukmark setup.
    expect(installer).toContain('"$target" setup "$@"');
    // Any other bukmark.it address outside the docs and the share images
    // (src/pages/og) is a file the site publishes.
    const served = [...(install + readme).matchAll(/https:\/\/bukmark\.it\/([^\s)`'"<>]+)/g)]
      .map((m) => m[1]!)
      .filter((p) => !p.startsWith('docs/') && !/^og\/[a-z0-9/-]+\.png$/.test(p));
    expect(served).toEqual(expect.arrayContaining(['install.sh', 'bukmark']));
    expect(served.filter((p) => !(p in PACKAGING_FILES))).toEqual([]);
  });

  it('installs with Homebrew from the tap and repository the formula is written for', () => {
    const full = /brew install ([a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+)/.exec(install)?.[1];
    expect(full).toBeDefined();
    const [user, tap, name] = full!.split('/') as [string, string, string];
    // `brew install user/tap/name` reads Formula/name.rb from github.com/user/homebrew-tap.
    expect(formula).toContain(`${user}/homebrew-${tap}`);
    expect(formula).toMatch(new RegExp(`^class ${name[0]!.toUpperCase()}${name.slice(1)} < Formula$`, 'm'));
    expect(existsSync(join(root, `packaging/homebrew/${name}.rb`))).toBe(true);
    expect(/bin\.install "([^"]+)"/.exec(formula)?.[1]).toBe('packaging/bin/bukmark');
    // Every brew command in the docs, the README, the tap's README and the
    // formula names the same formula and the same tap.
    const texts = [install, readme, read('packaging/homebrew/TAP_README.md'), formula].join('\n');
    const formulas = new Set([...texts.matchAll(/brew (?:install|trust --formula) ([a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+)/g)].map((m) => m[1]));
    expect([...formulas]).toEqual([full]);
    const taps = new Set([...texts.matchAll(/brew tap ([a-z0-9-]+\/[a-z0-9-]+)(?![\w/-])/g)].map((m) => m[1]));
    expect([...taps]).toEqual([`${user}/${tap}`]);
    // The formula downloads the repository the docs clone.
    const repo = /git clone https:\/\/github\.com\/(\S+?)\.git/.exec(install)?.[1];
    expect(repo).toBeDefined();
    expect(formula).toContain(`url "https://github.com/${repo}/archive/refs/tags/v`);
  });

  it('names the folders and files the command and the installer use', () => {
    const data = section(install, 'Where your data lives');
    expect(cli).toContain('DIR=${BUKMARK_HOME:-$HOME/.bukmark}\n');
    expect(data).toContain('`~/.bukmark`');
    expect(data).toContain('`BUKMARK_HOME`');
    for (const [variable, file] of [['COMPOSE_YML', 'compose.yml'], ['OVERRIDE_YML', 'compose.override.yml'], ['ENV_FILE', '.env']]) {
      expect(cli).toContain(`${variable}=$DIR/${file}\n`);
      expect(data, file).toContain('`' + file + '`');
    }
    expect(cli).toContain('-f "$COMPOSE_YML" -f "$OVERRIDE_YML"');
    expect(cli).toMatch(/^PROJECT=bukmark-cli$/m);
    expect(cli).toContain('${PROJECT}_pgdata');
    expect(data).toContain('`bukmark-cli_pgdata`');
    const script = section(install, 'Install script');
    expect(installer).toContain('bin_dir=${BUKMARK_BIN_DIR:-$HOME/.local/bin}\n');
    expect(script).toContain('`~/.local/bin`');
    expect(script).toContain('`BUKMARK_BIN_DIR`');
  });

  it('installs into your home folder without sudo, as the docs say', () => {
    expect(section(install, 'Install script')).toContain('never uses sudo');
    for (const [file, script] of [['install.sh', installer], ['bukmark', cli]]) {
      // sudo appears only in messages that tell a person what they could run.
      const runs = script.split('\n').filter((l) => /\bsudo\b/.test(l) && !/^\s*#/.test(l) && !/\b(?:die|warn|say) "/.test(l));
      expect(runs, file).toEqual([]);
    }
  });

  it('names only variables that exist, and says which settings differ from a checkout', () => {
    const scriptVars = new Set([...(cli + installer).matchAll(/\$\{?(BUKMARK_[A-Z0-9_]+)/g)].map((m) => m[1]!));
    const example = declaredEnvVars(read('.env.example'));
    const mentioned = [...(section(install, 'Install') + commandDocs).matchAll(/\bBUKMARK_[A-Z0-9_]+/g)].map((m) => m[0]);
    expect(mentioned.filter((n) => !scriptVars.has(n) && !example.has(n))).toEqual([]);
    for (const name of ['BUKMARK_HOME', 'BUKMARK_PORT', 'BUKMARK_VERSION', 'BUKMARK_BIN_DIR']) {
      expect(scriptVars.has(name), name).toBe(true);
      expect(install, name).toContain('`' + name + '`');
    }
    // What .env.example has and the command's .env lacks, and the other way round.
    const written = declaredEnvVars(/cat >"\$tmp" <<EOF\n([\s\S]*?)\nEOF$/m.exec(cli)?.[1] ?? '');
    expect(written.has('POSTGRES_PASSWORD')).toBe(true);
    const differ = [...[...example].filter((n) => !written.has(n)), ...[...written].filter((n) => !example.has(n))];
    expect(differ.length).toBeGreaterThan(0);
    const settings = section(install, 'Settings');
    expect(differ.filter((n) => !settings.includes('`' + n + '`'))).toEqual([]);
  });

  it('shows command users how to publish the app on loopback without editing compose.yml', () => {
    const proxy = section(install, 'Behind a reverse proxy');
    expect(proxy).toContain('~/.bukmark/compose.override.yml');
    expect(proxy).toContain('ports: !override ["127.0.0.1:${PORT:-3000}:3000"]');
    expect(proxy).toContain('`bukmark restart`');
  });
});
