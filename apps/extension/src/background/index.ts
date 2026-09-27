import type { LoginRequest } from '../lib/login';
import { handleLogin, saveActiveTab } from './handlers';

chrome.commands.onCommand.addListener((command) => {
  if (command === 'save-current-tab') void saveActiveTab();
});

chrome.runtime.onMessage.addListener((message: Partial<LoginRequest> | undefined, _sender, sendResponse) => {
  if (message?.type !== 'login' || typeof message.baseUrl !== 'string') return;
  void handleLogin(message.baseUrl).then(sendResponse);
  // Keeps sendResponse usable after this listener has returned.
  return true;
});
