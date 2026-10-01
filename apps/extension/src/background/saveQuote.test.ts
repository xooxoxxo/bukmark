import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../lib/auth';
import { SAVE_QUOTE_COMMAND } from '../lib/shortcut';
import {
  fakeChrome, installed, runCommand, settle, startBackground, stopBackground, stubFetch,
  type FakeChrome, type FakeEventTab, type FakeMenuClick, type FakeRequest, type FakeSeed,
} from '../test/chrome';

const SERVER = 'http://nas.lan:3000';
const MENU_ID = 'bukmark-save-quote';
const PAGE = { id: 7, url: 'https://example.com/article', title: 'An article' };
const BADGE = { saved: { text: '✓' }, failed: { text: '!' }, loggedOut: { text: '?' } };
const LOGGED_OUT = { title: 'Log in to bukmark first' };

function auth(): Auth {
  return { token: 'bkm_live', tokenId: 't1', server: SERVER, name: 'bukmark capture', createdAt: 1 };
}

const LOGGED_IN: FakeSeed = { local: { auth: auth() }, sync: { baseUrl: SERVER } };

let chrome: FakeChrome;
let requests: FakeRequest[];

async function start(seed: FakeSeed = LOGGED_IN): Promise<void> {
  chrome = fakeChrome(seed);
  vi.stubGlobal('chrome', chrome);
  await startBackground(chrome);
  await settle();
}

/** The page has this text selected: what the injected function returns there. */
function select(text: string): void {
  chrome.scripting.executeScript.mockResolvedValue([{ frameId: 0, result: { text, focused: true } }]);
}

/** Each frame of the page, with its selection and whether its document has focus. */
function frames(...list: Array<{ frameId: number; text: string; focused: boolean }>): void {
  chrome.scripting.executeScript.mockResolvedValue(list.map(({ frameId, text, focused }) => ({ frameId, result: { text, focused } })));
}

async function clickMenu(info: Partial<FakeMenuClick> = {}, tab: FakeEventTab | undefined = PAGE): Promise<void> {
  const click = { menuItemId: MENU_ID, pageUrl: tab?.url, ...info };
  for (const listener of chrome.contextMenus.onClicked.listeners) listener(click, tab);
  await settle();
}

async function pressShortcut(tab: FakeEventTab | undefined = PAGE): Promise<void> {
  runCommand(chrome, SAVE_QUOTE_COMMAND, tab);
  await settle();
}

const quoteRequests = () => requests.filter((r) => r.url.endsWith('/api/quotes'));

beforeEach(() => {
  vi.stubGlobal('setTimeout', vi.fn());
  requests = stubFetch(({ url }) =>
    url.endsWith('/api/quotes')
      ? { status: 201, body: { quote: { id: 'q1' }, link: { id: 'l1', created: true } } }
      : { body: {} },
  );
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('the quote menu item', () => {
  it('exists once the background has started, on selected text only', async () => {
    await start();
    expect([...chrome.contextMenus.data.values()]).toEqual([
      { id: MENU_ID, title: 'Save quote to bukmark', contexts: ['selection'] },
    ]);
  });

  it('is made again on install, while the start’s own registration is still running, never twice', async () => {
    chrome = fakeChrome(LOGGED_IN);
    vi.stubGlobal('chrome', chrome);
    // The browser installs: the script starts, then onInstalled fires at once.
    await startBackground(chrome);
    installed(chrome);
    await settle();
    expect(chrome.contextMenus.create).toHaveBeenCalledTimes(2);
    expect([...chrome.contextMenus.data.keys()]).toEqual([MENU_ID]);
    expect(chrome.contextMenus.errors).toEqual([]);
  });

  it('is made again when a stopped background starts, as a worker that lost its menus', async () => {
    await start();
    stopBackground(chrome);
    chrome.contextMenus.data.clear();
    await startBackground(chrome);
    await settle();
    expect([...chrome.contextMenus.data.keys()]).toEqual([MENU_ID]);
    expect(chrome.contextMenus.errors).toEqual([]);
  });

  it('warns, without failing the start, when the browser refuses the menu', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chrome = fakeChrome(LOGGED_IN);
    vi.stubGlobal('chrome', chrome);
    chrome.contextMenus.removeAll.mockRejectedValueOnce(new Error('menus unavailable'));
    await startBackground(chrome);
    await settle();
    expect(warn).toHaveBeenCalledWith('bukmark: could not make the quote menu item', expect.any(Error));
    // The next registration still runs.
    installed(chrome);
    await settle();
    expect([...chrome.contextMenus.data.keys()]).toEqual([MENU_ID]);
    warn.mockRestore();
  });

  it('warns when create reports an error through runtime.lastError', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await start();
    // The browser kept an item that removeAll did not clear.
    chrome.contextMenus.removeAll.mockResolvedValueOnce(undefined);
    installed(chrome);
    await settle();
    expect(warn).toHaveBeenCalledWith('bukmark: could not make the quote menu item', `Cannot create item with duplicate id ${MENU_ID}`);
    warn.mockRestore();
  });

  it('is left out where the browser has no menus (Firefox for Android, Safari on iOS), and the rest still starts', async () => {
    await start({ ...LOGGED_IN, without: ['contextMenus'] });
    expect(chrome.commands.onCommand.listeners).toHaveLength(1);
    select('Still saved from the keyboard.');
    await pressShortcut();
    expect(quoteRequests()).toHaveLength(1);
  });
});

describe('saving a quote from the menu', () => {
  it('reads the selection in the page, line breaks kept, and posts it with the tab’s address and title', async () => {
    await start();
    select('First line.\nSecond line.');
    await clickMenu({ selectionText: 'First line. Second line.' });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: PAGE.id, frameIds: [0] }, func: expect.any(Function) });
    expect(quoteRequests()).toHaveLength(1);
    expect(quoteRequests()[0]).toMatchObject({
      method: 'POST',
      url: `${SERVER}/api/quotes`,
      body: { url: PAGE.url, title: PAGE.title, text: 'First line.\nSecond line.' },
    });
    expect(quoteRequests()[0]!.headers.get('authorization')).toBe('Bearer bkm_live');
  });

  it('reads the selection in the frame that was right-clicked', async () => {
    await start();
    select('Inside the frame.\nSecond line.');
    await clickMenu({ frameId: 3, selectionText: 'Inside the frame. Second line.' });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: PAGE.id, frameIds: [3] }, func: expect.any(Function) });
    expect(quoteRequests().map((r) => (r.body as { text: string }).text)).toEqual(['Inside the frame.\nSecond line.']);
  });

  it('saves the menu’s text, not a stale selection the page returns that differs from it', async () => {
    await start();
    // A selection left in another document than the one right-clicked.
    select('An old selection\nin the top page.');
    await clickMenu({ selectionText: 'iframe text' });
    expect(quoteRequests().map((r) => (r.body as { text: string }).text)).toEqual(['iframe text']);
  });

  it('keeps the page’s text when the menu’s is a shortened copy of it', async () => {
    await start();
    select('A long passage,\nwith more after it.');
    await clickMenu({ selectionText: 'A long passage, with' });
    expect(quoteRequests().map((r) => (r.body as { text: string }).text)).toEqual(['A long passage,\nwith more after it.']);
  });

  it('injects a function that returns the page’s selection as text, and whether its document has focus', async () => {
    await start();
    await clickMenu({ selectionText: 'x' });
    const [{ func }] = chrome.scripting.executeScript.mock.calls[0]!;
    vi.stubGlobal('getSelection', () => ({ toString: () => 'One.\nTwo.' }));
    vi.stubGlobal('document', { hasFocus: () => true });
    expect(func()).toEqual({ text: 'One.\nTwo.', focused: true });
    vi.stubGlobal('getSelection', () => null);
    vi.stubGlobal('document', { hasFocus: () => false });
    expect(func()).toEqual({ text: '', focused: false });
  });

  it('counts a frame as focused only when the focus is not in a child frame', async () => {
    await start();
    await clickMenu({ selectionText: 'x' });
    const [{ func }] = chrome.scripting.executeScript.mock.calls[0]!;
    vi.stubGlobal('getSelection', () => ({ toString: () => 'Old selection in the top page.' }));
    // The reader is in an iframe: the top document has focus too, but on the frame.
    vi.stubGlobal('document', { hasFocus: () => true, activeElement: { tagName: 'IFRAME' } });
    expect(func()).toEqual({ text: 'Old selection in the top page.', focused: false });
    vi.stubGlobal('document', { hasFocus: () => true, activeElement: { tagName: 'BODY' } });
    expect(func()).toMatchObject({ focused: true });
    vi.stubGlobal('document', { hasFocus: () => true, activeElement: null });
    expect(func()).toMatchObject({ focused: true });
  });

  it('falls back to the menu’s selectionText where the page can’t be scripted', async () => {
    await start();
    chrome.scripting.executeScript.mockRejectedValue(new Error('Cannot access contents of the page.'));
    await clickMenu({ selectionText: 'From the menu.' });
    expect(quoteRequests().map((r) => r.body)).toEqual([{ url: PAGE.url, title: PAGE.title, text: 'From the menu.' }]);
  });

  it('falls back to selectionText where the build has no scripting API', async () => {
    await start({ ...LOGGED_IN, without: ['scripting'] });
    await clickMenu({ selectionText: 'From the menu.' });
    expect(quoteRequests().map((r) => (r.body as { text: string }).text)).toEqual(['From the menu.']);
  });

  it('falls back to selectionText when the page finds nothing selected (a selection in a frame)', async () => {
    await start();
    select('');
    await clickMenu({ selectionText: 'Inside an iframe.' });
    expect(quoteRequests().map((r) => (r.body as { text: string }).text)).toEqual(['Inside an iframe.']);
  });

  it('ignores clicks on other menu items', async () => {
    await start();
    select('Text.');
    await clickMenu({ menuItemId: 'something-else', selectionText: 'Text.' });
    expect(requests).toHaveLength(0);
  });

  it.each(['file:///Users/someone/notes.txt', 'chrome://settings/', 'about:blank'])(
    'sends nothing, and injects nothing, on %s',
    async (url) => {
      await start();
      select('Text.');
      await clickMenu({ selectionText: 'Text.', pageUrl: url }, { ...PAGE, url });
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
      expect(requests).toHaveLength(0);
      expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    },
  );

  it('leaves the title out when the tab has none', async () => {
    await start();
    select('Text.');
    await clickMenu({}, { id: 7, url: PAGE.url });
    expect(quoteRequests()[0]!.body).toEqual({ url: PAGE.url, text: 'Text.' });
  });
});

describe('saving a quote with the shortcut', () => {
  it('posts the page’s selection', async () => {
    await start();
    select('Selected.');
    await pressShortcut();
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: PAGE.id, allFrames: true }, func: expect.any(Function) });
    expect(quoteRequests().map((r) => r.body)).toEqual([{ url: PAGE.url, title: PAGE.title, text: 'Selected.' }]);
  });

  it('saves a selection made inside a frame, the top page having none', async () => {
    await start();
    frames({ frameId: 0, text: '', focused: false }, { frameId: 4, text: 'Inside the frame.\nTwo.', focused: false });
    await pressShortcut();
    expect(quoteRequests().map((r) => (r.body as { text: string }).text)).toEqual(['Inside the frame.\nTwo.']);
  });

  it('prefers the frame that has focus over another frame’s leftover selection', async () => {
    await start();
    frames(
      { frameId: 0, text: 'Old selection in the top page.', focused: false },
      { frameId: 2, text: '  ', focused: true },
      { frameId: 5, text: 'Where the reader is.', focused: true },
    );
    await pressShortcut();
    expect(quoteRequests().map((r) => (r.body as { text: string }).text)).toEqual(['Where the reader is.']);
  });

  it('uses the active tab when the browser passes none with the command', async () => {
    await start();
    chrome.tabs.query.mockResolvedValue([PAGE]);
    select('Selected.');
    await pressShortcut(undefined);
    expect(quoteRequests()).toHaveLength(1);
  });

  it.each([['nothing selected', ''], ['only whitespace selected', ' \n\t ']])(
    'does nothing with %s: no request, no badge',
    async (_what, text) => {
      await start();
      select(text);
      await pressShortcut();
      expect(requests).toHaveLength(0);
      expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    },
  );

  it('does nothing where the page can’t be scripted, having no other selection to go on', async () => {
    await start();
    chrome.scripting.executeScript.mockRejectedValue(new Error('Cannot access a chrome:// URL'));
    await pressShortcut();
    expect(requests).toHaveLength(0);
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
  });

  it('sends nothing for a page that is not on the web', async () => {
    await start();
    select('Text.');
    await pressShortcut({ ...PAGE, url: 'file:///tmp/a.html' });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it('leaves the link shortcut saving links', async () => {
    await start();
    chrome.tabs.query.mockResolvedValue([PAGE]);
    runCommand(chrome, 'save-current-tab', PAGE);
    await settle();
    expect(requests.map((r) => r.url)).toEqual([`${SERVER}/api/links`]);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});

describe('the badge after a quote, as after a silent link save', () => {
  it('flashes ✓ when saved (201 new, or 200 already there), restores the title and clears an old failure', async () => {
    await start({ ...LOGGED_IN, session: { lastSaveError: 'an old failure' } });
    select('Text.');
    await pressShortcut();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith(BADGE.saved);
    expect(chrome.action.setTitle).toHaveBeenCalledWith({ title: 'Save to bukmark' });
    expect(chrome.storage.session.data.lastSaveError).toBeUndefined();

    stubFetch(() => ({ status: 200, body: { quote: { id: 'q1' }, link: { id: 'l1', created: false } } }));
    chrome.action.setBadgeText.mockClear();
    await pressShortcut();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith(BADGE.saved);
  });

  it('flashes ! on a failure and keeps the reason for the next popup', async () => {
    await start();
    stubFetch(() => ({ status: 400, body: { error: 'text too long' } }));
    select('Text.');
    await clickMenu();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith(BADGE.failed);
    expect(chrome.storage.local.data.auth).toBeDefined();
    expect(chrome.storage.session.data.lastSaveError).toBe("Couldn't save that quote: text too long");
  });

  it('flashes ? when logged out, sending nothing, and leaves the login prompt for the popup', async () => {
    await start({});
    select('Text.');
    await clickMenu();
    expect(requests).toHaveLength(0);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith(BADGE.loggedOut);
    expect(chrome.action.setTitle).toHaveBeenCalledWith(LOGGED_OUT);
    expect(chrome.storage.session.data.lastAuthError).toBe('Log in first — quotes save nothing while you are logged out.');
  });

  it('on a 401: forgets the token and says to log in, as the link shortcut does', async () => {
    await start();
    stubFetch(() => ({ status: 401, body: { error: 'Not authenticated' } }));
    select('Text.');
    await pressShortcut();
    expect(chrome.storage.local.data.auth).toBeUndefined();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith(BADGE.loggedOut);
    expect(chrome.storage.session.data.lastAuthError).toBe('Your session ended — log in again.');
  });
});
