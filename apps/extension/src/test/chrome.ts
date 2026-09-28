import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { SAVE_COMMAND } from '../lib/shortcut';
import { manifestFor, type Target } from '../manifest';

type Data = Record<string, unknown>;
type AreaName = 'local' | 'sync' | 'session';
type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type ChangeListener = (changes: Changes, area: AreaName) => void;

export const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
export const REDIRECT_URI = `https://${EXTENSION_ID}.chromiumapp.org/bukmark`;

/** What a current bukmark server answers GET /api/auth/status with. */
export const STATUS = { setupComplete: true, authenticated: false, redirectKinds: ['chromium', 'firefox', 'tab'] };

/**
 * Firefox's identity.getRedirectURL, derived the way Firefox derives it
 * (toolkit/components/extensions/child/ext-identity.js): the lowercase hex SHA-1
 * of the add-on ID — the one the Firefox build's manifest carries — on the
 * extensions.webextensions.identity.redirectDomain pref, which defaults to
 * extensions.allizom.org (modules/libpref/init/all.js).
 */
export function firefoxRedirectURL(path = ''): string {
  const id = manifestFor('firefox').browser_specific_settings?.gecko?.id ?? '';
  const url = new URL(`https://${createHash('sha1').update(id).digest('hex')}.extensions.allizom.org/`);
  url.pathname = path;
  return url.href;
}

/** Where the server's Allow button sends the window: the code, and the state it was given. */
export function approve(authorizeUrl: string, code = 'the-code'): string {
  const params = new URL(authorizeUrl).searchParams;
  return `${params.get('redirect_uri')}?code=${code}&state=${params.get('state')}`;
}

function storageArea(name: AreaName, data: Data, listeners: ChangeListener[]) {
  const emit = (changes: Changes): void => {
    if (Object.keys(changes).length === 0) return;
    // Chrome delivers onChanged as a separate event, after the write.
    queueMicrotask(() => { for (const listener of listeners) listener(changes, name); });
  };
  return {
    /** The stored values, for arranging and asserting state directly. */
    data,
    get: vi.fn(async (keys?: string | string[] | Data | null): Promise<Data> => {
      if (keys == null) return structuredClone(data);
      if (typeof keys === 'string' || Array.isArray(keys)) {
        return Object.fromEntries(
          [keys].flat().filter((k) => k in data).map((k) => [k, structuredClone(data[k])]),
        );
      }
      return Object.fromEntries(
        Object.entries(keys).map(([k, fallback]) => [k, k in data ? structuredClone(data[k]) : fallback]),
      );
    }),
    set: vi.fn(async (items: Data): Promise<void> => {
      const changes: Changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: v };
        data[k] = structuredClone(v);
      }
      emit(changes);
    }),
    remove: vi.fn(async (keys: string | string[]): Promise<void> => {
      const changes: Changes = {};
      for (const k of [keys].flat()) {
        if (!(k in data)) continue;
        changes[k] = { oldValue: data[k] };
        delete data[k];
      }
      emit(changes);
    }),
  };
}

/**
 * An API some browsers lack: Opera sync and getRedirectURL, Safari identity and
 * bookmarks, Firefox for Android commands and windows (Safari on iOS: windows.create).
 */
export type MissingApi = 'identity' | 'getRedirectURL' | 'bookmarks' | 'commands' | 'sync' | 'windows';

export interface FakeTab {
  id: number;
  windowId: number;
  url: string;
}

type TabUpdatedListener = (tabId: number, changeInfo: { url?: string; status?: string }, tab: FakeTab) => void;
type TabRemovedListener = (tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void;

export interface FakeSeed {
  local?: Data;
  sync?: Data;
  session?: Data;
  /** The browser imitated: its build's manifest, extension URLs and redirect URL, and Firefox's own APIs. */
  browser?: Target;
  /** Defaults to what the browser lacks: identity and bookmarks for Safari, nothing otherwise. */
  without?: MissingApi[];
}

const SCHEMES: Record<Target, string> = {
  chrome: 'chrome-extension',
  firefox: 'moz-extension',
  safari: 'safari-web-extension',
};

/**
 * An in-memory `chrome` covering the calls the extension makes. Storage behaves
 * like the real areas (defaults, copies, onChanged); everything else is a vi.fn
 * with a happy-path default that a test can override. Missing APIs are really
 * missing at runtime, while the type keeps them for arranging the others.
 */
export function fakeChrome(seed: FakeSeed = {}) {
  const browser = seed.browser ?? 'chrome';
  const without = new Set<MissingApi>(seed.without ?? (browser === 'safari' ? ['identity', 'bookmarks'] : []));
  const listeners: ChangeListener[] = [];
  const openTabs = new Map<number, FakeTab>();
  let lastId = 10;
  const onUpdated: TabUpdatedListener[] = [];
  const onRemoved: TabRemovedListener[] = [];
  const openTab = (url: string, windowId: number): FakeTab => {
    const tab = { id: ++lastId, windowId, url };
    openTabs.set(tab.id, tab);
    return { ...tab };
  };
  const chrome = {
    storage: {
      local: storageArea('local', { ...seed.local }, listeners),
      sync: storageArea('sync', { ...seed.sync }, listeners),
      session: storageArea('session', { ...seed.session }, listeners),
      onChanged: { addListener: vi.fn((listener: ChangeListener) => { listeners.push(listener); }) },
    },
    permissions: {
      contains: vi.fn(async (_p: { origins?: string[] }) => true),
      request: vi.fn(async (_p: { origins?: string[]; data_collection?: string[] }) => true),
    },
    runtime: {
      id: EXTENSION_ID,
      sendMessage: vi.fn(async (_message: unknown): Promise<unknown> => ({ ok: true })),
      openOptionsPage: vi.fn(async () => {}),
      getPlatformInfo: vi.fn(async () => ({ os: 'mac', arch: 'arm' })),
      getManifest: vi.fn(() => manifestFor(browser)),
      getURL: vi.fn((path: string) => `${SCHEMES[browser]}://${EXTENSION_ID}/${path}`),
      /** Firefox only. */
      getBrowserInfo: vi.fn(async () => ({ name: 'Firefox', vendor: 'Mozilla', version: '143.0', buildID: '20260915000000' })),
      onMessage: {
        addListener: vi.fn((_listener: (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown) => {}),
      },
    },
    identity: {
      getRedirectURL: vi.fn((path = '') =>
        browser === 'firefox' ? firefoxRedirectURL(path) : REDIRECT_URI.replace(/bukmark$/, path)),
      launchWebAuthFlow: vi.fn(
        async (details: { url: string; interactive?: boolean }): Promise<string | undefined> => approve(details.url),
      ),
    },
    action: {
      setBadgeText: vi.fn(async (_d: { text: string }) => {}),
      setBadgeBackgroundColor: vi.fn(async (_d: { color: string }) => {}),
      setTitle: vi.fn(async (_d: { title: string }) => {}),
    },
    tabs: {
      /** The open tabs by id, for arranging and asserting state directly. Only tabs the extension opened or a test added. */
      data: openTabs,
      query: vi.fn(async (_q: object): Promise<Array<{ url?: string; title?: string }>> => [
        { url: 'https://example.com/article', title: 'An article' },
      ]),
      create: vi.fn(async ({ url }: { url: string }): Promise<FakeTab | undefined> => openTab(url, 1)),
      get: vi.fn(async (tabId: number): Promise<FakeTab> => {
        const tab = openTabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}.`);
        return { ...tab };
      }),
      /** Like the browser's: the tab goes, and onRemoved follows. */
      remove: vi.fn(async (tabId: number): Promise<void> => {
        const tab = openTabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}.`);
        openTabs.delete(tabId);
        queueMicrotask(() => {
          for (const listener of onRemoved) listener(tabId, { windowId: tab.windowId, isWindowClosing: false });
        });
      }),
      onUpdated: { listeners: onUpdated, addListener: vi.fn((listener: TabUpdatedListener) => { onUpdated.push(listener); }) },
      onRemoved: { listeners: onRemoved, addListener: vi.fn((listener: TabRemovedListener) => { onRemoved.push(listener); }) },
    },
    windows: {
      create: vi.fn(async ({ url }: { url: string; type?: string; width?: number; height?: number }) => {
        const windowId = ++lastId;
        return { id: windowId, type: 'popup', tabs: [openTab(url, windowId)] } as { id: number; type: string; tabs?: FakeTab[] } | undefined;
      }),
    },
    bookmarks: { getTree: vi.fn(async (): Promise<unknown[]> => []) },
    commands: {
      onCommand: { addListener: vi.fn((_listener: (command: string) => void) => {}) },
      getAll: vi.fn(async () => [
        { name: SAVE_COMMAND, description: 'Save the current tab', shortcut: 'Alt+Shift+K' },
      ]),
      /** Firefox only. */
      openShortcutSettings: vi.fn(async () => {}),
    },
  };

  const loose = chrome as Record<string, unknown> & typeof chrome;
  if (browser !== 'firefox') {
    delete (loose.runtime as Partial<typeof chrome.runtime>).getBrowserInfo;
    delete (loose.commands as Partial<typeof chrome.commands>).openShortcutSettings;
  }
  if (without.has('getRedirectURL')) delete (loose.identity as Partial<typeof chrome.identity>).getRedirectURL;
  if (without.has('sync')) delete (loose.storage as Partial<typeof chrome.storage>).sync;
  for (const api of ['identity', 'bookmarks', 'commands', 'windows'] as const) {
    if (without.has(api)) delete loose[api];
  }
  return chrome;
}

export type FakeChrome = ReturnType<typeof fakeChrome>;

/**
 * The page in a tab moves on, as a link, a form or the server's redirect moves
 * it: the tab's URL changes and onUpdated fires, as the browser's does.
 */
export function navigate(chrome: FakeChrome, tabId: number, url: string): void {
  const tab = chrome.tabs.data.get(tabId);
  if (!tab) throw new Error(`No tab with id: ${tabId}.`);
  tab.url = url;
  updateTab(chrome, tabId, { url });
}

/** onUpdated fires for a tab with this change, and the tab as it now is. */
export function updateTab(chrome: FakeChrome, tabId: number, changeInfo: { url?: string; status?: string }): void {
  const tab = chrome.tabs.data.get(tabId);
  if (!tab) throw new Error(`No tab with id: ${tabId}.`);
  queueMicrotask(() => {
    for (const listener of chrome.tabs.onUpdated.listeners) listener(tabId, changeInfo, { ...tab });
  });
}

/**
 * Starts the background script against the fake, as the browser does on
 * install or wake-up, and routes the pages' runtime.sendMessage to it.
 */
export async function startBackground(chrome: FakeChrome): Promise<void> {
  vi.resetModules();
  await import('../background/index');
  const listener = chrome.runtime.onMessage.addListener.mock.calls.at(-1)![0];
  chrome.runtime.sendMessage.mockImplementation((message: unknown) => new Promise((resolve) => {
    if (listener(message, {}, resolve) !== true) resolve(undefined);
  }));
}

/**
 * The browser unloads the background, as Chrome does to a worker idle for 30 s
 * and Safari and Firefox to an idle event page: the listeners it added go with
 * it. The next event starts it again (startBackground) before it is delivered.
 */
export function stopBackground(chrome: FakeChrome): void {
  chrome.tabs.onUpdated.listeners.length = 0;
  chrome.tabs.onRemoved.listeners.length = 0;
}

/** The person closes a tab. */
export function closeTab(chrome: FakeChrome, tabId: number): void {
  const tab = chrome.tabs.data.get(tabId);
  if (!tab) throw new Error(`No tab with id: ${tabId}.`);
  chrome.tabs.data.delete(tabId);
  queueMicrotask(() => {
    for (const listener of chrome.tabs.onRemoved.listeners) listener(tabId, { windowId: tab.windowId, isWindowClosing: true });
  });
}

export interface FakeRequest {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
  signal: AbortSignal | null | undefined;
}

type Reply = { status?: number; body?: unknown } | Error;

/**
 * Replaces fetch with `route`, answering with real Response objects. A route
 * returning an Error makes fetch reject, as a network failure does.
 */
export function stubFetch(route: (req: FakeRequest) => Reply | Promise<Reply>): FakeRequest[] {
  const requests: FakeRequest[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const req: FakeRequest = {
      method: init.method ?? 'GET',
      url: String(input),
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      signal: init.signal,
    };
    requests.push(req);
    const reply = await route(req);
    if (reply instanceof Error) throw reply;
    const body = reply.body === undefined ? null : JSON.stringify(reply.body);
    return new Response(body, { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  }));
  return requests;
}

/** Lets every pending promise chain run to completion. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Lets the pages and the background finish: every reply asked of the
 * background so far, then what the pages do with them. A login hashes its PKCE
 * verifier on Node's thread pool, which settle() alone may not wait out.
 */
export async function replied(chrome: FakeChrome): Promise<void> {
  await settle();
  await Promise.all(chrome.runtime.sendMessage.mock.results.map((result) => result.value));
  await settle();
}
