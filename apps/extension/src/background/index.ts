import { SAVE_COMMAND } from '../lib/shortcut';
import { handleMessage, listenForTabLogins, saveActiveTab, welcome } from './handlers';

// A fresh install opens the setup steps, so the extension is ready before the
// first save instead of failing it. Updates and browser updates open nothing.
chrome.runtime.onInstalled.addListener((details) => void welcome(details));

// Firefox for Android has no commands API; without the guard this line would
// throw and the listeners below would never register.
chrome.commands?.onCommand.addListener((command) => {
  if (command === SAVE_COMMAND) void saveActiveTab();
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
