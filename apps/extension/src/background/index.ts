import { saveLink } from '../lib/api';
import { loadSettings } from '../lib/settings';

const BADGE_MS = 1500;

async function flashBadge(text: string, color: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => { void chrome.action.setBadgeText({ text: '' }); }, BADGE_MS);
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'save-current-tab') return;
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    try {
      const { baseUrl } = await loadSettings();
      // No note on this path: a capture without a note beats no capture. Use
      // the popup when the reason is worth recording.
      await saveLink(baseUrl, { url: tab.url, title: tab.title ?? '' });
      await flashBadge('✓', '#2d7d46');
    } catch {
      await flashBadge('!', '#c0392b');
    }
  })();
});
