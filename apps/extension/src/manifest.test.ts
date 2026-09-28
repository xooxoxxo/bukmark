import { existsSync } from 'node:fs';
import type { ConfigEnv, Plugin, UserConfig } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import viteConfig from '../vite.config';
import { DEFAULT_BASE_URL } from './lib/settings';
import { SAVE_COMMAND } from './lib/shortcut';
import { FIREFOX_ADDON_ID, SAVE_SHORTCUT, TARGETS, manifestFor, type Target } from './manifest';
import { firefoxRedirectURL } from './test/chrome';
import { matchesEverywhere, validEverywhere } from './test/matchPattern';

const packageFile = (path: string) => new URL(`../${path}`, import.meta.url);

describe('manifestFor', () => {
  it('keeps Chrome’s build as it was: a module service worker and every permission', () => {
    const m = manifestFor('chrome');
    expect(m.manifest_version).toBe(3);
    expect(m.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(m.permissions).toEqual(['activeTab', 'tabs', 'bookmarks', 'storage', 'identity']);
    expect(m.host_permissions).toEqual(['http://localhost/*']);
    expect(m.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
    expect(m.browser_specific_settings).toBeUndefined();
  });

  it('gives Firefox a module event page, its permanent ID and its data-collection declaration', () => {
    const m = manifestFor('firefox');
    expect(m.background).toEqual({ scripts: ['background.js'], type: 'module' });
    expect(m.permissions).toEqual(manifestFor('chrome').permissions);
    expect(m.browser_specific_settings).toEqual({
      gecko: {
        id: 'capture@bukmark.it',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['browsingActivity', 'websiteContent'],
          optional: ['bookmarksInfo'],
        },
      },
      gecko_android: { strict_min_version: '142.0' },
    });
  });

  it('gives Safari a non-persistent event page, without the APIs it lacks', () => {
    const m = manifestFor('safari');
    expect(m.background).toEqual({ scripts: ['background.js'], type: 'module', persistent: false });
    expect(m.permissions).toEqual(['activeTab', 'tabs', 'storage']);
    expect(m.description).not.toMatch(/bookmarks/);
    expect(m.browser_specific_settings).toEqual({ safari: { strict_min_version: '16.4' } });
  });

  it.each(TARGETS)('gives %s only host patterns every browser honours, the default server’s among them', (target) => {
    const m = manifestFor(target);
    for (const pattern of [...m.host_permissions, ...m.optional_host_permissions]) {
      expect(validEverywhere(pattern), pattern).toBe(true);
    }
    // Reachable from install, with no prompt.
    expect(m.host_permissions.some((p) => matchesEverywhere(p, `${DEFAULT_BASE_URL}/api/auth/status`))).toBe(true);
    // Any other server can be asked for at runtime, whatever its port.
    for (const server of ['http://nas.lan:3000/', 'https://bukmark.example.com:8443/', 'http://[::1]:8080/']) {
      expect(m.optional_host_permissions.some((p) => matchesEverywhere(p, server)), server).toBe(true);
    }
  });

  it.each(TARGETS)('points %s at pages and a background the build emits', (target) => {
    const m = manifestFor(target);
    for (const page of [m.action.default_popup, m.options_page]) expect(existsSync(packageFile(page))).toBe(true);
    const background = 'service_worker' in m.background ? [m.background.service_worker] : m.background.scripts;
    expect(background).toEqual(['background.js']);
  });

  it.each(TARGETS)('suggests the same shortcut to %s for the command the background listens to', (target) => {
    expect(Object.keys(manifestFor(target).commands)).toEqual([SAVE_COMMAND]);
    expect(manifestFor(target).commands[SAVE_COMMAND]!.suggested_key).toEqual({
      default: 'Alt+Shift+K',
      mac: 'MacCtrl+Shift+K',
    });
  });

  it('keeps off the keys the browsers publish for themselves', () => {
    // Firefox Screenshots and Edge Web capture; Alt+Shift in the Chrome,
    // ChromeOS and Edge lists (see SAVE_SHORTCUT for the sources).
    const taken = ['Ctrl+Shift+S', 'Command+Shift+S', ...'ABILMNST'.split('').map((k) => `Alt+Shift+${k}`)];
    expect(taken).not.toContain(SAVE_SHORTCUT.default);
    // On a Mac, Option+Shift+letter types a character: use Control.
    expect(SAVE_SHORTCUT.mac).toMatch(/^MacCtrl\+Shift\+[A-Z]$/);
  });

  it('never ships a copy of the old static manifest into every build', () => {
    expect(existsSync(packageFile('public/manifest.json'))).toBe(false);
  });
});

describe('the Firefox add-on ID', () => {
  it('hashes to the redirect host bukmark servers are told to expect', () => {
    expect(FIREFOX_ADDON_ID).toBe('capture@bukmark.it');
    expect(new URL(firefoxRedirectURL('bukmark')).hostname)
      .toBe('79d9f60576061d67a8a6a23ee099801cbdd1ceef.extensions.allizom.org');
  });
});

describe('vite.config', () => {
  const configFor = (mode: string) =>
    (viteConfig as (env: ConfigEnv) => UserConfig)({ mode, command: 'build' });

  it.each(TARGETS)('builds %s into its own folder', (target) => {
    expect(configFor(target).build?.outDir).toBe(`dist/${target}`);
  });

  it('refuses a build without a known target', () => {
    expect(() => configFor('production')).toThrow('Unknown target "production": build with --mode chrome, firefox or safari.');
  });

  it.each(TARGETS)('writes the %s manifest into the bundle', (target: Target) => {
    const [plugin] = configFor(target).plugins as Plugin[];
    const emitFile = vi.fn();
    (plugin!.generateBundle as (this: unknown) => void).call({ emitFile });
    expect(emitFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'asset', fileName: 'manifest.json' }));
    expect(JSON.parse(emitFile.mock.calls[0]![0].source as string)).toEqual(manifestFor(target));
  });
});
