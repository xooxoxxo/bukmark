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

  it('puts the ! badge only on the keyboard shortcut, the one path that sets it', () => {
    const bullets = section(extension, 'Usage').split(/\n- /).filter((b) => b.includes('`!`'));
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain('Shift+S');
    expect(extension.split('`!`')).toHaveLength(2);
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
