/**
 * manifest.json for each browser build. The JavaScript is the same for every
 * target; vite.config.ts writes the manifest that differs.
 */
import { SAVE_COMMAND, SAVE_QUOTE_COMMAND } from './lib/shortcut';

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

/**
 * Saving the selection as a quote. Q is in none of the lists above either, and
 * the same reasoning gives a Mac Control+Shift+Q. Chrome's quit key is
 * Ctrl+Shift+Q on Windows and Linux, which the Alt default keeps clear of.
 * Chrome takes at most four suggested keys; the extension suggests two.
 */
export const SAVE_QUOTE_SHORTCUT = { default: 'Alt+Shift+Q', mac: 'MacCtrl+Shift+Q' } as const;

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
  optional_permissions?: string[];
  host_permissions: string[];
  optional_host_permissions: string[];
  icons: Record<string, string>;
  action: { default_popup: string; default_title: string; default_icon: Record<string, string> };
  options_page: string;
  background: Background;
  commands: Record<string, { suggested_key: { default: string; mac: string }; description: string }>;
  browser_specific_settings?: BrowserSpecificSettings;
}

export function isTarget(value: string): value is Target {
  return (TARGETS as readonly string[]).includes(value);
}

// No `tabs`: activeTab gives the popup and the shortcut the current tab's
// address, and the host access granted for the user's server shows the
// addresses of a tab login's pages. Without it, installing warns of nothing
// like "Read your browsing history", and no other tab's address is ever seen.
// `alarms` runs bookmark sync's pull every few minutes; it warns of nothing.
// `contextMenus` adds "Save quote to bukmark" to a selection's right-click menu,
// and `scripting` reads that selection, line breaks kept, in the tab activeTab
// was granted for by the click or the shortcut. Neither warns at install, and
// with no host permission for web pages, scripting reaches no other tab.
const PERMISSIONS = ['activeTab', 'storage', 'identity', 'alarms', 'contextMenus', 'scripting'];
// Asked for on the Import click or when sync is turned on (lib/permissions.ts), not at install.
const OPTIONAL_PERMISSIONS = ['bookmarks'];

/** Drawn with the web app's icons by `pnpm --filter @bukmark/web icons`, into public/icons. */
export const ICONS: Record<string, string> = Object.fromEntries(
  [16, 32, 48, 128].map((size) => [String(size), `icons/icon-${size}.png`]),
);

export function manifestFor(target: Target): Manifest {
  const manifest: Manifest = {
    manifest_version: 3,
    name: 'bukmark capture',
    version: '0.3.0',
    description: "Save the current tab to your own bukmark server, and import or sync your browser's bookmarks.",
    permissions: [...PERMISSIONS],
    optional_permissions: [...OPTIONAL_PERMISSIONS],
    // Every port on localhost, the default server's among them: no host
    // pattern may carry a port (see lib/permissions.ts).
    host_permissions: ['http://localhost/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    icons: ICONS,
    action: {
      default_popup: 'popup.html',
      default_title: 'Save to bukmark',
      default_icon: { '16': ICONS['16']!, '32': ICONS['32']! },
    },
    options_page: 'options.html',
    background: { service_worker: 'background.js', type: 'module' },
    commands: {
      [SAVE_COMMAND]: {
        suggested_key: { ...SAVE_SHORTCUT },
        description: 'Save the current tab to bukmark without opening the popup',
      },
      [SAVE_QUOTE_COMMAND]: {
        suggested_key: { ...SAVE_QUOTE_SHORTCUT },
        description: 'Save the selected text as a quote',
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
          // outside the browser. Bookmarks go on Import and while bookmark sync
          // is on; the Import click and the sync toggle ask for this first.
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
      // Safari has no identity or bookmarks API, so no sync and no `alarms` for it.
      // No identity API, so every Safari login runs in a tab; `tabs` stays
      // until a Safari run shows the host access alone lets it see that tab.
      // Menus since Safari 14 and scripting since 15.4, both below the 16.4
      // minimum (MDN browser-compat-data). Safari on iOS has no menus.
      permissions: ['activeTab', 'tabs', 'storage', 'contextMenus', 'scripting'],
      optional_permissions: undefined,
      // A non-persistent event page: iOS requires one, and has been seen
      // stopping extension service workers.
      background: { scripts: ['background.js'], type: 'module', persistent: false },
      browser_specific_settings: { safari: { strict_min_version: '16.4' } },
    };
  }

  return manifest;
}
