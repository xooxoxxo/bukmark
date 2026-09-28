/** The command the keyboard shortcut runs (manifest `commands`). */
export const SAVE_COMMAND = 'save-current-tab';

/** chrome.storage.session key: why the last keyboard save failed, for the next popup to show. */
export const LAST_SAVE_ERROR = 'lastSaveError';

/**
 * The key the browser actually assigned to saving without the popup: '' when
 * none is (the suggested key was taken, or the person cleared it), null when
 * the browser has no extension shortcuts at all (Firefox for Android).
 */
export async function assignedShortcut(): Promise<string | null> {
  if (!chrome.commands) return null;
  const commands = await chrome.commands.getAll().catch(() => []);
  const shortcut = commands.find((c) => c.name === SAVE_COMMAND)?.shortcut ?? '';
  // Firefox and Safari report the manifest's spelling of the Control key.
  return shortcut.replace(/MacCtrl/g, 'Ctrl');
}

type ShortcutSettings = typeof chrome.commands & { openShortcutSettings?: () => Promise<void> };

function firefoxShortcutSettings(): (() => Promise<void>) | null {
  const open = (chrome.commands as ShortcutSettings | undefined)?.openShortcutSettings;
  return typeof open === 'function' ? open : null;
}

/**
 * Firefox opens its own shortcut page; Chromium browsers open
 * chrome://extensions/shortcuts from tabs.create. Safari offers neither.
 */
export function canOpenShortcutSettings(): boolean {
  return firefoxShortcutSettings() !== null || chrome.runtime.getURL('').startsWith('chrome-extension:');
}

export async function openShortcutSettings(): Promise<void> {
  const firefox = firefoxShortcutSettings();
  if (firefox) return firefox.call(chrome.commands);
  await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}
