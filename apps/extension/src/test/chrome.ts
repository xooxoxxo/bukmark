import { vi } from 'vitest';

type Data = Record<string, unknown>;
type AreaName = 'local' | 'sync' | 'session';
type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type ChangeListener = (changes: Changes, area: AreaName) => void;

export const REDIRECT_URI = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/bukmark';

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
 * An in-memory `chrome` covering the calls the extension makes. Storage behaves
 * like the real areas (defaults, copies, onChanged); everything else is a vi.fn
 * with a happy-path default that a test can override.
 */
export function fakeChrome(seed: { local?: Data; sync?: Data; session?: Data } = {}) {
  const listeners: ChangeListener[] = [];
  return {
    storage: {
      local: storageArea('local', { ...seed.local }, listeners),
      sync: storageArea('sync', { ...seed.sync }, listeners),
      session: storageArea('session', { ...seed.session }, listeners),
      onChanged: { addListener: vi.fn((listener: ChangeListener) => { listeners.push(listener); }) },
    },
    permissions: {
      contains: vi.fn(async (_p: { origins?: string[] }) => true),
      request: vi.fn(async (_p: { origins?: string[] }) => true),
    },
    runtime: {
      sendMessage: vi.fn(async (_message: unknown): Promise<unknown> => ({ ok: true })),
      openOptionsPage: vi.fn(async () => {}),
      getPlatformInfo: vi.fn(async () => ({ os: 'mac', arch: 'arm' })),
      onMessage: {
        addListener: vi.fn((_listener: (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown) => {}),
      },
    },
    identity: {
      getRedirectURL: vi.fn((path = '') => REDIRECT_URI.replace(/bukmark$/, path)),
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
      query: vi.fn(async (_q: object): Promise<Array<{ url?: string; title?: string }>> => [
        { url: 'https://example.com/article', title: 'An article' },
      ]),
    },
    bookmarks: { getTree: vi.fn(async (): Promise<unknown[]> => []) },
    commands: { onCommand: { addListener: vi.fn((_listener: (command: string) => void) => {}) } },
  };
}

export type FakeChrome = ReturnType<typeof fakeChrome>;

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
