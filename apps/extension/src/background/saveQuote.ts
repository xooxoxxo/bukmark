import { saveQuote } from '../lib/api';
import { isWebPage } from '../lib/settings';
import { saveSilently } from './handlers';

export const QUOTE_MENU_ID = 'bukmark-save-quote';
const QUOTE_MENU_TITLE = 'Save quote to bukmark';
const LOGGED_OUT_MESSAGE = 'Log in first — quotes save nothing while you are logged out.';
const FAILED_MESSAGE = "Couldn't save that quote";
const MENU_WARNING = 'bukmark: could not make the quote menu item';

interface QuoteTab {
  id?: number;
  url?: string;
  title?: string;
}

/**
 * Runs in the page, not here: the selection as the reader sees it, line breaks
 * kept. The menu's selectionText collapses them to spaces. Self-contained,
 * since the browser sends only its source to the page.
 */
const readSelection = (): string => getSelection()?.toString() ?? '';

// Registrations run one after another, so a removeAll never lands between
// another's removeAll and create, which would make the id twice.
let menuRegistered: Promise<void> = Promise.resolve();

/**
 * Makes the right-click item, replacing any the browser kept. Called on
 * install and every time the background starts: a worker or event page can
 * come back without its menus. Firefox for Android and Safari on iOS have no
 * menus, and skip it.
 */
export function registerQuoteMenu(): Promise<void> {
  const menus = chrome.contextMenus;
  if (!menus) return menuRegistered;
  menuRegistered = menuRegistered
    .then(async () => {
      await menus.removeAll();
      await new Promise<void>((resolve) => {
        menus.create({ id: QUOTE_MENU_ID, title: QUOTE_MENU_TITLE, contexts: ['selection'] }, () => {
          // Read here, so the browser doesn't also report it as unchecked.
          const error = chrome.runtime.lastError;
          if (error) console.warn(MENU_WARNING, error.message);
          resolve();
        });
      });
    })
    // Kept going: a failed registration must not stop the next one.
    .catch((err: unknown) => { console.warn(MENU_WARNING, err); });
  return menuRegistered;
}

/**
 * The tab's selection, read in the page: in one frame when given, else the top
 * one. Null where it can't be: a browser page, a store page, a frame from
 * another site, a build without scripting. Runs only in the tab the click or
 * the shortcut granted activeTab for.
 */
async function pageSelection(tabId: number | undefined, frameId?: number): Promise<string | null> {
  if (tabId === undefined) return null;
  const target = frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] };
  try {
    const [frame] = await chrome.scripting.executeScript({ target, func: readSelection });
    return typeof frame?.result === 'string' ? frame.result : null;
  } catch {
    return null;
  }
}

const hasText = (text: string | null | undefined): text is string => !!text && text.trim() !== '';

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The page's copy when it is the text the menu was opened on, for its line
 * breaks; else the menu's. The page can hold a different selection, say one
 * left in the top document while the click was in a frame, and saving that
 * would save the wrong words. A menu copy that is the start of the page's is
 * the same selection, shortened by a browser that caps selectionText.
 */
function menuText(scripted: string | null, selectionText: string | undefined): string | undefined {
  if (!hasText(scripted)) return selectionText;
  if (selectionText === undefined) return scripted;
  const [page, menu] = [collapse(scripted), collapse(selectionText)];
  return menu !== '' && page.startsWith(menu) ? scripted : selectionText;
}

function send(url: string, title: string | undefined, text: string): Promise<void> {
  return saveSilently({
    send: (auth) => saveQuote(auth, { url, title, text }),
    loggedOut: LOGGED_OUT_MESSAGE,
    failed: FAILED_MESSAGE,
  });
}

/** The right-click item. The selection is read in the page, else taken from the menu. */
export async function onQuoteMenuClicked(info: chrome.contextMenus.OnClickData, tab?: QuoteTab): Promise<void> {
  if (info.menuItemId !== QUOTE_MENU_ID) return;
  const url = tab?.url ?? info.pageUrl;
  if (!url || !isWebPage(url)) return;
  const text = menuText(await pageSelection(tab?.id, info.frameId ?? 0), info.selectionText);
  if (!hasText(text)) return;
  await send(url, tab?.title, text);
}

/** The shortcut. With nothing selected, or a page that can't be read, it does nothing at all. */
export async function saveQuoteFromShortcut(tab?: QuoteTab): Promise<void> {
  // Chrome and Firefox pass the tab with a command; a browser that doesn't gets the active one.
  const active = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!active?.url || !isWebPage(active.url)) return;
  const text = await pageSelection(active.id);
  if (!hasText(text)) return;
  await send(active.url, active.title, text);
}
