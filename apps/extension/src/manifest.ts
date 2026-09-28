/**
 * manifest.json for each browser build. The JavaScript is the same for every
 * target; vite.config.ts writes the manifest that differs.
 */
import { SAVE_COMMAND } from './lib/shortcut';

export type Target = 'chrome' | 'firefox' | 'safari';

export const TARGETS: readonly Target[] = ['chrome', 'firefox', 'safari'];

/**
 * Permanent. Firefox names the login redirect host after the SHA-1 of this ID,
 * so changing it would break logging in to every existing server.
 */
export const FIREFOX_ADDON_ID = 'capture@bukmark.it';

/**
 * Cmd/Ctrl+Shift+S, the old default, is Firefox's screenshot key and Edge's
 * Web capture, and a browser's own shortcut wins. Alt+Shift+K appears in none
 * of the published lists (checked 2026-09-28):
 * - Chrome, https://support.google.com/chrome/answer/157179 — Alt+Shift+A, I, N, T.
 * - ChromeOS, https://support.google.com/chromebook/answer/183101 — Alt+Shift+A, B,
 *   L, M, N, S, T (S opens the status area, which rules out Alt+Shift+S).
 * - Edge, https://support.microsoft.com/en-us/microsoft-edge/keyboard-shortcuts-in-microsoft-edge-50d3edab-30d9-c7e4-21ce-37fe2713cfad
 *   — Alt+Shift+B, I, T.
 * - Firefox, https://support.mozilla.org/en-US/kb/keyboard-shortcuts-perform-firefox-tasks-quickly
 *   — Alt+Shift only with Enter; Control+Shift only with Tab.
 * - Safari, https://support.apple.com/guide/safari/keyboard-and-other-shortcuts-cpsh003/mac
 *   — Control only with Tab, Shift-Tab and Command-1/2.
 * - macOS, https://support.apple.com/en-us/102650 — Control-K, without Shift.
 * A Mac gets Control+Shift+K because Option+Shift+letter types a character
 * there (Í, Ś, …) that the shortcut would swallow. Firefox on Windows and Linux
 * gives a page's accesskeys Alt+Shift (pref ui.key.contentAccess = 5), so a page
 * with accesskey="k" can take the key.
 */
export const SAVE_SHORTCUT = { default: 'Alt+Shift+K', mac: 'MacCtrl+Shift+K' } as const;

type Background =
  | { service_worker: string; type: 'module' }
  | { scripts: string[]; type: 'module'; persistent?: false };

interface BrowserSpecificSettings {
  gecko?: {
    id: string;
    strict_min_version: string;
    data_collection_permissions: { required: string[]; optional?: string[] };
  };
  gecko_android?: { strict_min_version: string };
  safari?: { strict_min_version: string };
}

export interface Manifest {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  host_permissions: string[];
  optional_host_permissions: string[];
  action: { default_popup: string; default_title: string };
  options_page: string;
  background: Background;
  commands: Record<string, { suggested_key: { default: string; mac: string }; description: string }>;
  browser_specific_settings?: BrowserSpecificSettings;
}

export function isTarget(value: string): value is Target {
  return (TARGETS as readonly string[]).includes(value);
}

const PERMISSIONS = ['activeTab', 'tabs', 'bookmarks', 'storage', 'identity'];

export function manifestFor(target: Target): Manifest {
  const manifest: Manifest = {
    manifest_version: 3,
    name: 'bukmark capture',
    version: '0.2.0',
    description: 'Save the current tab to bukmark, and import your existing browser bookmarks.',
    permissions: [...PERMISSIONS],
    // Every port on localhost, the default server's among them: no host
    // pattern may carry a port (see lib/permissions.ts).
    host_permissions: ['http://localhost/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_popup: 'popup.html', default_title: 'Save to bukmark' },
    options_page: 'options.html',
    background: { service_worker: 'background.js', type: 'module' },
    commands: {
      [SAVE_COMMAND]: {
        suggested_key: { ...SAVE_SHORTCUT },
        description: 'Save the current tab to bukmark without opening the popup',
      },
    },
  };

  if (target === 'firefox') {
    return {
      ...manifest,
      // Firefox has no extension service workers (bug 1573659).
      background: { scripts: ['background.js'], type: 'module' },
      browser_specific_settings: {
        gecko: {
          id: FIREFOX_ADDON_ID,
          strict_min_version: '140.0',
          // The server is the person's own, but Mozilla counts anything sent
          // outside the browser. Bookmarks go only on Import, asked for then.
          data_collection_permissions: {
            required: ['browsingActivity', 'websiteContent'],
            optional: ['bookmarksInfo'],
          },
        },
        gecko_android: { strict_min_version: '142.0' },
      },
    };
  }

  if (target === 'safari') {
    return {
      ...manifest,
      description: 'Save the current tab to bukmark.',
      // Safari has no identity or bookmarks API.
      permissions: PERMISSIONS.filter((p) => p !== 'identity' && p !== 'bookmarks'),
      // A non-persistent event page: iOS requires one, and has been seen
      // stopping extension service workers.
      background: { scripts: ['background.js'], type: 'module', persistent: false },
      browser_specific_settings: { safari: { strict_min_version: '16.4' } },
    };
  }

  return manifest;
}
