import { changesSettings } from '../lib/settings';
import { SAVE_COMMAND, SAVE_QUOTE_COMMAND } from '../lib/shortcut';
import { SYNC_ALARM, checkSyncLogin, ensureSyncAlarm, listenForBookmarks, pullIfEnabled } from '../lib/sync';
import { handleMessage, listenForTabLogins, saveActiveTab, welcome } from './handlers';
import { onQuoteMenuClicked, registerQuoteMenu, saveQuoteFromShortcut } from './saveQuote';

// The right-click item for saving a quote: made on install, and again each
// time this script starts, since a stopped worker or event page can come back
// without it. Firefox for Android and Safari on iOS have no menus.
chrome.runtime.onInstalled.addListener(() => void registerQuoteMenu());
void registerQuoteMenu();
chrome.contextMenus?.onClicked.addListener((info, tab) => void onQuoteMenuClicked(info, tab));

// A fresh install opens the setup steps, so the extension is ready before the
// first save instead of failing it. Updates and browser updates open nothing.
chrome.runtime.onInstalled.addListener((details) => void welcome(details));

// Firefox for Android has no commands API; without the guard this line would
// throw and the listeners below would never register.
chrome.commands?.onCommand.addListener((command, tab) => {
  if (command === SAVE_COMMAND) void saveActiveTab();
  if (command === SAVE_QUOTE_COMMAND) void saveQuoteFromShortcut(tab);
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const reply = handleMessage(message);
  if (!reply) return;
  void reply.then(sendResponse);
  // Keeps sendResponse usable after this listener has returned.
  return true;
});

// Registered while this script starts, in every browser, so that a login tab's
// events wake a background the browser unloaded mid-login: Chrome stops a
// worker idle for 30 s, Safari and Firefox an idle event page, while the person
// is still typing their password. Any browser can log in in a tab — those
// without an identity window always, the others when theirs turns out not to
// work — and a listener added only then would be gone after a restart.
listenForTabLogins();

// Bookmark sync. The bookmark events are registered here for the same reason:
// an edit in the bukmark folder has to wake the background to be pushed. They
// exist only once the bookmarks permission is granted; turning sync on
// registers them then (lib/sync.ts).
listenForBookmarks();
// Safari's build has no alarms: it has no bookmarks to sync.
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void pullIfEnabled();
});
chrome.runtime.onStartup.addListener(() => void pullIfEnabled());
// Logging out, into another server, or pointing the extension at one turns sync off.
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'local' && 'auth' in changes) || changesSettings(changes, area)) void checkSyncLogin();
});
void ensureSyncAlarm();
