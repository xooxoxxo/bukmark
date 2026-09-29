import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docPages, read, root, section, sourceFiles } from './source';

const webUi = sourceFiles('apps/web/src', ['.tsx']).map(read).join('\n');
const extensionUi = [
  ...readdirSync(join(root, 'apps/extension')).filter((f) => f.endsWith('.html')).map((f) => read(`apps/extension/${f}`)),
  ...sourceFiles('apps/extension/src', ['.ts']).map(read),
].join('\n');
const authorizePage = read('apps/server/src/auth/authorizePage.ts');
const extension = read('apps/site/src/content/docs/docs/extension.md');

/** What each button says: `<button>` markup, or `textContent` set on a button element. */
function buttonTexts(src: string): string[] {
  return [
    ...[...src.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]!),
    ...[...src.matchAll(/\w*[Bb]utton\w*\.textContent\s*=\s*(['"`])(.*?)\1/g)].map((m) => m[2]!),
  ];
}

describe('docs name only buttons and menus that exist', () => {
  it('every button the docs say to click is a real button', () => {
    const buttons = buttonTexts([webUi, extensionUi, authorizePage].join('\n'));
    const missing = docPages().flatMap(({ file, body }) =>
      [...body.matchAll(/\b(?:[Cc]lick|then|or)\s+\*\*([^*]+)\*\*/g)]
        .map((m) => m[1]!)
        .filter((label) => !buttons.some((text) => text.includes(label)))
        .map((label) => `${file}: ${label}`),
    );
    expect(missing).toEqual([]);
  });

  it('every Settings or Options menu path exists', () => {
    // "Settings" is the web app's menu button; "Options" is Chrome's name for
    // the extension's options page, so only what follows it is ours.
    const menus: Record<string, { ui: string; labels: (path: string[]) => string[] }> = {
      Settings: { ui: webUi, labels: (path) => path },
      Options: { ui: extensionUi, labels: (path) => path.slice(1) },
    };
    const missing: string[] = [];
    for (const { file, body } of docPages()) {
      for (const m of body.matchAll(/\*\*([^*]*→[^*]*)\*\*/g)) {
        const path = m[1]!.replace(/\s+/g, ' ').split(' → ');
        const menu = menus[path[0]!];
        if (!menu || menu.labels(path).some((label) => !menu.ui.includes(label))) missing.push(`${file}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('extension docs describe the flows the extension implements', () => {
  it('quotes the Allow page the way the server renders it for the extension', () => {
    expect(read('apps/extension/src/lib/auth.ts')).toContain("'bukmark capture'");
    const heading = /"bukmark capture ([^"]+)"/.exec(extension)?.[1]?.replace(/\s+/g, ' ');
    expect(heading).toBeDefined();
    expect(authorizePage).toContain(heading);
  });

  it('logs in from the Server field, with a password prompt when the browser has no session', () => {
    const popup = read('apps/extension/popup.html');
    expect(popup.indexOf('id="serverInput"')).toBeLessThan(popup.indexOf('id="loginButton"'));
    const login = section(extension, 'Logging in');
    expect(login.indexOf('**Server**')).toBeLessThan(login.indexOf('**Log in**'));
    expect(login).toMatch(/not signed in to the web app[\s\S]*password/);
  });

  it('puts the ! and ? badges only on saves without the popup: the link shortcut and quotes', () => {
    const handlers = read('apps/extension/src/background/handlers.ts');
    const badge = (name: string) => new RegExp(`const ${name} = \\{ text: '([^']+)'`).exec(handlers)?.[1];
    const [failed, loggedOut] = [badge('FAILED'), badge('LOGGED_OUT')];
    expect([failed, loggedOut]).toEqual(['!', '?']);
    // Both are set only by a save without the popup, which the link shortcut
    // and the quote menu and shortcut share.
    const silentPath = handlers.slice(handlers.indexOf('export async function saveSilently'), handlers.indexOf('async function report'));
    expect(silentPath).toContain('flashBadge(FAILED)');
    expect(silentPath).toContain('flagLoggedOut(');
    expect(handlers.split('flagLoggedOut(').length - 1).toBe(3); // its definition and two calls, both above
    expect(silentPath.slice(silentPath.indexOf('export async function saveActiveTab'))).toContain('saveSilently(');
    expect(read('apps/extension/src/background/saveQuote.ts')).toContain('saveSilently(');

    const bullets = section(extension, 'Usage').split(/\n- /).filter((b) => b.includes('`!`'));
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain('`?`');
    expect(extension.split('`!`')).toHaveLength(2);
    expect(extension.split('`?`')).toHaveLength(2);
    // The quote bullet points at those badges instead of repeating them.
    const quote = section(extension, 'Usage').split(/\n- /).find((b) => b.includes('**Save quote to bukmark**'));
    expect(quote).toMatch(/same badges/);
  });

  it('names the default shortcuts the manifest suggests, for Macs and everything else', () => {
    const manifest = read('apps/extension/src/manifest.ts');
    const keys = (name: string) => {
      const m = new RegExp(`${name} = \\{ default: '([^']+)', mac: '([^']+)' \\}`).exec(manifest);
      expect(m, name).not.toBeNull();
      // Chrome, Firefox and Safari all read MacCtrl as the Control key.
      return [m![1]!, m![2]!.replace('MacCtrl', 'Control')] as const;
    };
    const usage = section(extension, 'Usage').split(/\n- /);
    const [key, mac] = keys('SAVE_SHORTCUT');
    const bullet = usage.find((b) => b.includes('`!`'));
    expect(bullet).toContain(`**\`${key}\`**`);
    expect(bullet).toContain(`**\`${mac}\`**`);
    const [quoteKey, quoteMac] = keys('SAVE_QUOTE_SHORTCUT');
    const quote = usage.find((b) => b.includes('**Save quote to bukmark**'));
    expect(quote).toContain(`**\`${quoteKey}\`**`);
    expect(quote).toContain(`**\`${quoteMac}\`**`);
    // Every key combination the docs show anywhere is one of these.
    const known = [key, mac, quoteKey, quoteMac];
    const shown = docPages().flatMap(({ body }) => [...body.matchAll(/`((?:Alt|Control|Ctrl|Cmd|Option)\+[^`]+)`/g)].map((x) => x[1]!));
    const others = shown.filter((k) => !known.includes(k) && !/^Option\+Shift$/.test(k));
    expect(others).toEqual([]);
    expect(read('apps/site/src/pages/index.astro')).toContain(key);
  });

  it('names the quote menu item the extension makes', () => {
    const title = /QUOTE_MENU_TITLE = '([^']+)'/.exec(read('apps/extension/src/background/saveQuote.ts'))?.[1];
    expect(title).toBe('Save quote to bukmark');
    expect(section(extension, 'Usage')).toContain(`**${title}**`);
  });

  it('tells you to revoke the token in the web app when logout cannot reach the server', () => {
    const logout = section(extension, 'Logging out');
    expect(logout).toMatch(/can't be reached/);
    expect(logout).toContain('**Settings → Access tokens**');
  });

  it('quotes the message the popup shows after a revoked token', () => {
    const message = /form with\s+"([^"]+)"/.exec(section(extension, 'Token revocation'))?.[1];
    expect(message).toBeDefined();
    expect(extensionUi).toContain(message);
  });
});

describe('extension docs match the builds and the login the extension ships', () => {
  const manifest = read('apps/extension/src/manifest.ts');
  const targets = /TARGETS: readonly Target\[\] = \[([^\]]+)\]/.exec(manifest)![1]!.match(/[a-z]+/g)!;

  it('loads each browser from the folder the build writes for it', () => {
    expect(targets).toEqual(['chrome', 'firefox', 'safari']);
    expect(read('apps/extension/vite.config.ts')).toContain('outDir: `dist/${mode}`');
    const scripts = JSON.parse(read('apps/extension/package.json')).scripts as Record<string, string>;
    const load = section(extension, 'Load Into Your Browser');
    for (const t of targets) {
      expect(scripts.build).toContain(`--mode ${t}`);
      expect(load).toContain(`\`apps/extension/dist/${t}\``);
    }
    // The flat dist/ of single-target builds is gone; nothing may point at it.
    const flat = docPages().filter(({ body }) => /select\s+`apps\/extension\/dist\/?`/.test(body));
    expect(flat.map((p) => p.file)).toEqual([]);
  });

  it('gives the minimum browser versions the manifests require', () => {
    const load = section(extension, 'Load Into Your Browser');
    const gecko = /gecko: \{[\s\S]*?strict_min_version: '(\d+)\.0'/.exec(manifest)?.[1];
    const safari = /safari: \{ strict_min_version: '([\d.]+)' \}/.exec(manifest)?.[1];
    expect(load).toContain(`Firefox ${gecko} or later`);
    expect(load).toContain(`runs on Safari ${safari} and later`);
  });

  it('quotes only messages the extension or the server can show', () => {
    const shown = [extensionUi, authorizePage].join('\n');
    const flat = shown.replace(/\s+/g, ' ');
    // The fixed text after each `${…}` hole in a template literal, tags stripped.
    const afterHoles = [...shown.matchAll(/\$\{[^}]*\}([^`$]*)/g)].map((m) =>
      m[1]!.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '),
    );
    const canShow = (text: string) =>
      flat.includes(text) ||
      // "<a literal the code has> + <text that follows a hole>", as `${outcome} — you can close this tab` renders.
      [...text].some((_, k) => k > 0 && flat.includes(text.slice(0, k).trim()) &&
        text.slice(k).length >= 12 && afterHoles.some((seg) => seg.startsWith(text.slice(k))));
    const quotes = [...section(extension, 'Logging in').matchAll(/"([^"]+)"/g)]
      .map((m) => m[1]!.replace(/\s+/g, ' '))
      .filter((q) => !q.includes('…'));
    expect(quotes.length).toBeGreaterThan(5);
    expect(quotes.filter((q) => !canShow(q))).toEqual([]);
  });

  it('describes every kind of login page the server can show', () => {
    const which = section(extension, 'Which window opens').replace(/\s+/g, ' ');
    const kinds = [...authorizePage.matchAll(/case '(\w+)': return [`']([^`'$(]+)/g)].map((m) => [m[1]!, m[2]!.trim()]);
    expect(kinds.map(([k]) => k)).toEqual(['chromium', 'firefox', 'tab']);
    for (const [, phrase] of kinds) expect(which).toContain(`"${phrase.replace(/ —.*$/, '')}"`);
  });

  it('offers the access-token login on both extension pages', () => {
    for (const page of ['popup.html', 'options.html']) {
      expect(buttonTexts(read(`apps/extension/${page}`))).toContain('Use an access token instead');
    }
    expect(section(extension, 'Use an access token instead')).toContain('**Use an access token instead**');
  });
});
