/**
 * Two-way sync between one bookmark folder and the logged-in server.
 *
 * The folder is "bukmark", in the browser's Other bookmarks: one subfolder per
 * hub, and Unsorted for links in none. Nothing outside it is read or changed.
 * The server wins on a pull; a change the person makes in the folder is pushed
 * at once, or queued while the server can't be reached. Deleting in the browser
 * archives on the server, never deletes.
 *
 * Everything runs in the background, one task at a time: pulls, pushes, and
 * the bookmark events that start pushes.
 */
import {
  HttpError,
  createHub,
  linkChanges,
  listAllHubs,
  saveLink,
  unassignHub,
  updateHub,
  updateLink,
  type ChangesPage,
  type Credentials,
  type Hub,
  type LinkChange,
} from './api';
import { AuthRequiredError, authFor, type Auth } from './auth';
import { asksToShareBookmarks } from './permissions';
import { isWebPage, loadSettings } from './settings';

/** chrome.storage.local key: the sync state. */
export const SYNC_KEY = 'sync';
/** The folder sync keeps, in the browser's Other bookmarks. */
export const SYNC_FOLDER = 'bukmark';
/** The subfolder for links in no hub; the HTML export uses the same name. */
export const UNSORTED = 'Unsorted';
/**
 * Added to the folder name of a hub called Unsorted, which would otherwise
 * look like the folder for links in no hub; also to "Unsorted (hub)" and so
 * on, so that every hub has a folder name of its own. The export does the same.
 */
const HUB_SUFFIX = ' (hub)';
export const SYNC_ALARM = 'bukmark-sync';
export const SYNC_PERIOD_MINUTES = 5;

const PAGE_SIZE = 500;
const MAX_PAGES = 10_000;
const REQUEST_TIMEOUT_MS = 20_000;
/**
 * How long a write made by a pull waits for its own event. The event is
 * handled after the pull that made it, so this covers the longest pull.
 */
const ECHO_TTL_MS = 10 * 60_000;
/** chrome.storage.session keys of expected events start with this. */
const ECHO_PREFIX = 'syncEcho:';
/** Answers worth trying again later: the server, or a proxy in front of it, is down or busy. */
const RETRY_STATUSES = new Set([408, 429, 502, 503, 504]);

/** A change made in the browser, waiting to be sent. */
export type PendingChange =
  | { kind: 'save'; bookmarkId: string; url: string; title: string; hub: string | null }
  | { kind: 'title'; linkId: string; title: string }
  /** Only the hubs named change: the server may have filed the link elsewhere since the last pull. */
  | { kind: 'hubs'; linkId: string; addHubs: string[]; removeHubs: string[] }
  | { kind: 'archive'; linkId: string }
  | { kind: 'createHub'; name: string }
  | { kind: 'renameHub'; from: string; to: string }
  /** `archived` is set once this change has archived the hub, for a retry of what is left. */
  | { kind: 'archiveHub'; name: string; linkIds: string[]; archived?: boolean };

export interface SyncedLink {
  url: string;
  title: string;
  /** One bookmark per folder the link is in. */
  bookmarkIds: string[];
}

export interface SyncState {
  enabled: boolean;
  /**
   * The server synced with, kept while sync is off. Another login, or none,
   * turns sync off; turning it on for another server sets this folder aside.
   */
  server: string;
  rootId: string | null;
  /** Hub name to folder id. The folder's name is hubFolderTitle(hub). */
  hubFolders: Record<string, string>;
  /** Known by id, not name: a hub may be called Unsorted too. */
  unsortedId: string | null;
  /**
   * More folders with the name of a hub, or of Unsorted (null), by folder id.
   * The browser's own sync brings them when another browser syncing the same
   * folder made the same folder: they hold the same hub's bookmarks.
   */
  twinFolders: Record<string, string | null>;
  links: Record<string, SyncedLink>;
  /** The changes feed's `since` for the next pull; null pulls everything. */
  cursor: string | null;
  queue: PendingChange[];
  /** A pull of everything is due or under way; it runs to the end before the cursor is kept. */
  full: boolean;
  /** Epoch ms of the last pull that finished. */
  lastSync: number | null;
  /** What went wrong last, for the settings page; cleared by a pull that works. */
  error: string | null;
  /** Chrome says its own sync carries the folder to other browsers, where bukmark may sync it too. */
  browserSynced: boolean;
}

export interface SyncRequest {
  type: 'sync';
  action: 'enable' | 'disable' | 'pull';
}

export type SyncReply = { ok: true } | { ok: false; error: string };

type Node = chrome.bookmarks.BookmarkTreeNode & { folderType?: string; syncing?: boolean; type?: string };

const isBookmark = (node: Node): node is Node & { url: string } => typeof node.url === 'string' && node.type !== 'separator';
const isFolder = (node: Node): boolean => node.url === undefined && node.type !== 'separator';

// ---------------------------------------------------------------- state

function freshState(server: string, rootId: string | null = null): SyncState {
  return {
    enabled: false,
    server,
    rootId,
    hubFolders: {},
    unsortedId: null,
    twinFolders: {},
    links: {},
    cursor: null,
    queue: [],
    full: true,
    lastSync: null,
    error: null,
    browserSynced: false,
  };
}

export async function loadSyncState(): Promise<SyncState | null> {
  const { [SYNC_KEY]: stored } = await chrome.storage.local.get(SYNC_KEY);
  if (!stored || typeof stored !== 'object') return null;
  return { ...freshState(''), ...(stored as Partial<SyncState>) };
}

async function saveState(state: SyncState): Promise<void> {
  await chrome.storage.local.set({ [SYNC_KEY]: state });
}

/** The links sync keeps a bookmark for: what the settings page counts. */
export function syncedLinkCount(state: SyncState): number {
  return Object.values(state.links).filter((l) => l.bookmarkIds.length > 0).length;
}

// Changes run one at a time: a pull's writes and the events they cause must
// not interleave with pushes, and every task rewrites the stored state.
let turn: Promise<unknown> = Promise.resolve();

function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const run = turn.then(task);
  turn = run.catch(() => {});
  return run;
}

const timeout = (): RequestInit => ({ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

/** The login sync may use: the configured server's, and the one sync was turned on with. */
async function syncAuth(state: SyncState): Promise<Auth | null> {
  const { baseUrl } = await loadSettings();
  const auth = await authFor(baseUrl);
  return auth && auth.server === state.server ? auth : null;
}

/** Stops syncing and leaves the folder as it is. Pending changes go: they belong to this login. */
async function turnOff(state: SyncState, error: string | null = null): Promise<void> {
  state.enabled = false;
  state.queue = [];
  state.error = error;
  await saveState(state);
  await chrome.alarms?.clear(SYNC_ALARM);
}

/** Why a request failed, worded for the settings page. */
function describe(err: unknown, server: string): string {
  const { host } = new URL(server);
  if (err instanceof HttpError) return `Sync failed: ${err.message}`;
  if (err instanceof Error && err.name !== 'TypeError' && err.name !== 'TimeoutError' && err.name !== 'AbortError') {
    return `Sync failed: ${err.message}`;
  }
  return `Couldn't reach ${host} — sync will try again in a few minutes.`;
}

/** True when the server was not reached, or asked to be tried later: the change stays queued. */
function worthRetrying(err: unknown): boolean {
  return err instanceof HttpError ? RETRY_STATUSES.has(err.status) : !(err instanceof AuthRequiredError);
}

// ---------------------------------------------------------------- addresses

// The tracking parameters packages/shared/src/normalize.ts strips; sync.test.ts
// checks the two agree. That module hashes with node:crypto, so it can't ship here.
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'twclid', 'igshid',
  'mc_cid', 'mc_eid', 'ref', '_hsenc', '_hsmi', 'mkt_tok',
]);

/**
 * An address as the server stores it, without the fragment: two bookmarks
 * that give the same answer are the same link. The server normalizes what it
 * is sent; this only decides whether a bookmark already matches a link.
 */
export function comparableUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw;
  }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...u.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (TRACKING_PARAMS.has(k) || k.startsWith('utm_')) u.searchParams.delete(key);
  }
  if (u.pathname === '') u.pathname = '/';
  const url = u.toString();
  return url.endsWith('?') ? url.slice(0, -1) : url;
}

const sameAddress = (a: string, b: string): boolean => comparableUrl(a) === comparableUrl(b);

// ---------------------------------------------------------------- folder names

/** "Unsorted", once any number of " (hub)" endings are taken off. */
function isUnsortedName(title: string): boolean {
  let base = title;
  while (base.endsWith(HUB_SUFFIX)) base = base.slice(0, -HUB_SUFFIX.length);
  return base === UNSORTED;
}

/** The name of a hub's folder: the hub's own, unless it would read as Unsorted. */
export function hubFolderTitle(hub: string): string {
  return isUnsortedName(hub) ? hub + HUB_SUFFIX : hub;
}

/** The hub a folder name stands for, or null for "Unsorted" itself. The inverse of hubFolderTitle. */
export function hubOfTitle(title: string): string | null {
  if (title === UNSORTED) return null;
  return isUnsortedName(title) ? title.slice(0, -HUB_SUFFIX.length) : title;
}

// ---------------------------------------------------------------- echoes

// A pull's own writes fire the same events as the person's edits. Before each
// write the pull notes the event it expects, in storage.session so that a
// worker restarted mid-pull still knows them, and the event is skipped once.
// Every write changes one thing, so each makes exactly one event in every
// browser (Chrome fires onChanged per field changed).
type EchoKind = 'created' | 'changed' | 'moved' | 'removed';

interface Echo {
  n: number;
  until: number;
}

const echoKey = (kind: EchoKind, id: string): string => `${ECHO_PREFIX}${kind}:${id}`;
/** A create's event, before the browser has given the new node its id. */
const createKey = (parentId: string, title: string, url: string | undefined): string =>
  `${ECHO_PREFIX}create:${JSON.stringify([parentId, title, url ?? null])}`;

const live = (echo: unknown): echo is Echo =>
  typeof echo === 'object' && echo !== null && (echo as Echo).until > Date.now() && (echo as Echo).n > 0;

async function expectEcho(key: string): Promise<void> {
  const { [key]: echo } = await chrome.storage.session.get(key);
  await chrome.storage.session.set({ [key]: { n: (live(echo) ? echo.n : 0) + 1, until: Date.now() + ECHO_TTL_MS } });
}

/** True, once per expected event, when this event is a pull's own. */
async function takeEcho(key: string): Promise<boolean> {
  const { [key]: echo } = await chrome.storage.session.get(key);
  if (echo === undefined) return false;
  if (!live(echo)) {
    await chrome.storage.session.remove(key);
    return false;
  }
  if (echo.n > 1) await chrome.storage.session.set({ [key]: { ...echo, n: echo.n - 1 } });
  else await chrome.storage.session.remove(key);
  return true;
}

async function pruneEchoes(): Promise<void> {
  const all = await chrome.storage.session.get(null);
  const stale = Object.entries(all).filter(([k, v]) => k.startsWith(ECHO_PREFIX) && !live(v)).map(([k]) => k);
  if (stale.length > 0) await chrome.storage.session.remove(stale);
}

/** Runs one write, expecting its event; the expectation goes if the write fails. */
async function write<T>(key: string, run: () => Promise<T>): Promise<T> {
  await expectEcho(key);
  try {
    return await run();
  } catch (err) {
    await takeEcho(key);
    throw err;
  }
}

async function createNode(details: { parentId: string; title: string; url?: string; index?: number }): Promise<Node> {
  const signature = createKey(details.parentId, details.title, details.url);
  const node = (await write(signature, () => chrome.bookmarks.create(details))) as Node;
  // Still unclaimed, as the event waits for this pull to end: expect it by id.
  if (await takeEcho(signature)) await expectEcho(echoKey('created', node.id));
  return node;
}

// ---------------------------------------------------------------- the folder

/** Other bookmarks: Firefox's unfiled_____, else Chrome's root folder of type "other" (id 2). */
async function otherBookmarksId(): Promise<string> {
  const [firefox] = await chrome.bookmarks.get('unfiled_____').catch(() => [] as Node[]);
  if (firefox) return firefox.id;
  const tops = (await chrome.bookmarks.getChildren('0').catch(async () => {
    const [root] = await chrome.bookmarks.getTree();
    return root?.children ?? [];
  })) as Node[];
  // Chrome with account bookmarks has two: the one kept on this device is not "syncing".
  const other = tops.find((n) => n.folderType === 'other' && !n.syncing)
    ?? tops.find((n) => n.folderType === 'other')
    ?? tops.find((n) => n.id === '2')
    ?? tops[1]
    ?? tops[0];
  if (!other) throw new Error('No bookmark folder to sync into.');
  return other.id;
}

async function getNode(id: string): Promise<Node | null> {
  const [node] = await chrome.bookmarks.get(id).catch(() => [] as Node[]);
  return (node as Node | undefined) ?? null;
}

/** The hub a folder holds: a name, null for Unsorted and the bukmark folder itself, undefined outside sync. */
function hubOfFolder(state: SyncState, folderId: string | undefined): string | null | undefined {
  if (folderId === undefined) return undefined;
  if (folderId === state.rootId || folderId === state.unsortedId) return null;
  const entry = Object.entries(state.hubFolders).find(([, id]) => id === folderId);
  if (entry) return entry[0];
  return Object.hasOwn(state.twinFolders, folderId) ? state.twinFolders[folderId] : undefined;
}

/** Every folder of a hub, or of Unsorted (null): its own first. */
function foldersOf(state: SyncState, hub: string | null): string[] {
  const own = hub === null ? state.unsortedId : state.hubFolders[hub];
  const twins = Object.keys(state.twinFolders).filter((id) => state.twinFolders[id] === hub);
  return own ? [own, ...twins] : twins;
}

/**
 * Takes a folder out of the state, gone or moved out. Where its hub, or
 * Unsorted, has another folder, that one takes over. Returns whether the hub
 * still has a folder.
 */
function forgetFolder(state: SyncState, folderId: string): boolean {
  const hub = hubOfFolder(state, folderId);
  if (hub === undefined) return false;
  if (Object.hasOwn(state.twinFolders, folderId)) {
    delete state.twinFolders[folderId];
    return foldersOf(state, hub).length > 0;
  }
  if (hub === null) state.unsortedId = null;
  else delete state.hubFolders[hub];
  const heir = foldersOf(state, hub)[0];
  if (heir === undefined) return false;
  delete state.twinFolders[heir];
  if (hub === null) state.unsortedId = heir;
  else state.hubFolders[hub] = heir;
  return true;
}

/**
 * Other folders of a hub renamed away from its own folder stay folders of the
 * old name: the first of them becomes that name's own.
 */
function promoteOrphans(state: SyncState): void {
  for (const [id, hub] of Object.entries(state.twinFolders)) {
    if (hub === null ? state.unsortedId : state.hubFolders[hub]) continue;
    delete state.twinFolders[id];
    if (hub === null) state.unsortedId = id;
    else state.hubFolders[hub] = id;
  }
}

const inside = (state: SyncState, folderId: string | undefined): boolean => hubOfFolder(state, folderId) !== undefined;

/**
 * Whether Chrome's own sync carries the folder (Chrome 134+ marks synced
 * nodes with `syncing`). Another browser on the same account then gets every
 * change a pull makes, and if bukmark sync runs there too, takes them for the
 * person's. Firefox has no such mark: there Firefox Sync can't be seen.
 */
async function carriedByBrowser(root: Node | undefined): Promise<boolean> {
  if (!root) return false;
  if (root.syncing === true) return true;
  const parent = root.parentId ? await getNode(root.parentId) : null;
  return parent?.syncing === true;
}

/**
 * The folder as a pull found it: every bookmark directly in it or in one of its
 * subfolders (deeper ones are not synced), and those no link holds yet.
 */
class FolderView {
  readonly nodes = new Map<string, Node>();
  /** Bookmarks no link or queued save holds, by comparable address. */
  readonly strays = new Map<string, Node[]>();
  /** Folders this pull took bookmarks out of: removed at the end if left empty. */
  readonly emptied = new Set<string>();

  constructor(readonly state: SyncState) {}

  /** Finds or makes the folder, maps its subfolders to hubs, and reads what is in them. */
  static async open(state: SyncState): Promise<FolderView> {
    const view = new FolderView(state);
    const root = state.rootId ? await getNode(state.rootId) : null;
    if (!root || !isFolder(root)) {
      const otherId = await otherBookmarksId();
      const children = (await chrome.bookmarks.getChildren(otherId)) as Node[];
      const found = children.find((n) => isFolder(n) && n.title === SYNC_FOLDER);
      state.rootId = found?.id ?? (await createNode({ parentId: otherId, title: SYNC_FOLDER })).id;
    }
    const [tree] = (await chrome.bookmarks.getSubTree(state.rootId!)) as Node[];
    state.browserSynced = await carriedByBrowser(tree);
    const top = tree?.children ?? [];
    const folders = top.filter(isFolder);
    const ids = new Set(folders.map((f) => f.id));

    // Mappings to folders that are gone, or no longer directly in the folder,
    // go; so do those of other folders of a hub renamed meanwhile, which are
    // taken up again below by their new names.
    const titles = new Map(folders.map((f) => [f.id, f.title]));
    for (const [id, hub] of Object.entries(state.twinFolders)) {
      if (!ids.has(id) || hubOfTitle(titles.get(id)!) !== hub) forgetFolder(state, id);
    }
    for (const id of [...Object.values(state.hubFolders), state.unsortedId]) if (id && !ids.has(id)) forgetFolder(state, id);
    const mapped = new Set([...Object.values(state.hubFolders), state.unsortedId, ...Object.keys(state.twinFolders)]);
    // A folder no hub owns yet is taken up by its name: after sync was off, or
    // a folder the person made while the worker was not listening. A second
    // one of a name is another folder of the same hub.
    for (const folder of folders) {
      if (mapped.has(folder.id)) continue;
      const hub = hubOfTitle(folder.title);
      if (hub === null) {
        if (!state.unsortedId) state.unsortedId = folder.id;
        else state.twinFolders[folder.id] = null;
      } else if (hub.trim() !== '') {
        if (!state.hubFolders[hub]) state.hubFolders[hub] = folder.id;
        else state.twinFolders[folder.id] = hub;
      }
    }
    // A hub folder renamed while no event reached the extension: the hub is
    // renamed too, unless the new name is taken, when the folder gets its
    // hub's name back.
    for (const [name, id] of Object.entries(state.hubFolders)) {
      const title = folders.find((f) => f.id === id)!.title;
      if (title === hubFolderTitle(name)) continue;
      const renamed = hubOfTitle(title);
      if (renamed !== null && renamed.trim() !== '' && !state.hubFolders[renamed]) {
        delete state.hubFolders[name];
        state.hubFolders[renamed] = id;
        state.queue.push({ kind: 'renameHub', from: name, to: renamed });
      } else {
        await write(echoKey('changed', id), () => chrome.bookmarks.update(id, { title: hubFolderTitle(name) })).catch(() => {});
      }
    }
    promoteOrphans(state);
    // Unsorted is not a hub, so its name can't change: renamed, it is named back.
    const unsorted = folders.find((f) => f.id === state.unsortedId);
    if (unsorted && unsorted.title !== UNSORTED) {
      await write(echoKey('changed', unsorted.id), () => chrome.bookmarks.update(unsorted.id, { title: UNSORTED })).catch(() => {});
    }

    const held = new Set(Object.values(state.links).flatMap((l) => l.bookmarkIds));
    for (const change of state.queue) if (change.kind === 'save') held.add(change.bookmarkId);
    const add = (node: Node): void => {
      view.nodes.set(node.id, node);
      if (!held.has(node.id) && isWebPage(node.url!)) view.stray(node);
    };
    for (const node of top) if (isBookmark(node)) add(node);
    for (const folder of folders) {
      if (!inside(state, folder.id)) continue;
      for (const node of folder.children ?? []) if (isBookmark(node)) add(node);
    }
    return view;
  }

  private stray(node: Node): void {
    const key = comparableUrl(node.url!);
    const list = this.strays.get(key);
    if (list) list.push(node);
    else this.strays.set(key, [node]);
  }

  /** Untracked bookmarks of this address: the live list, so taking one out claims it. */
  straysFor(url: string): Node[] {
    const key = comparableUrl(url);
    let list = this.strays.get(key);
    if (!list) {
      list = [];
      this.strays.set(key, list);
    }
    return list;
  }

  /** The folder for a hub, or for Unsorted (null), made if missing. Hub folders go before Unsorted. */
  async folderFor(hub: string | null): Promise<string> {
    const { state } = this;
    if (hub === null) {
      if (!state.unsortedId) state.unsortedId = (await createNode({ parentId: state.rootId!, title: UNSORTED })).id;
      return state.unsortedId;
    }
    const known = state.hubFolders[hub];
    if (known) return known;
    const unsorted = state.unsortedId ? await getNode(state.unsortedId) : null;
    const details: { parentId: string; title: string; index?: number } = { parentId: state.rootId!, title: hubFolderTitle(hub) };
    if (unsorted?.index !== undefined) details.index = unsorted.index;
    const folder = await createNode(details);
    state.hubFolders[hub] = folder.id;
    return folder.id;
  }

  /** Puts a bookmark in the folder and gives it the link's title and address, changing only what differs. */
  async fit(node: Node, folderId: string, link: LinkChange): Promise<string> {
    if (node.parentId !== folderId) {
      await write(echoKey('moved', node.id), () => chrome.bookmarks.move(node.id, { parentId: folderId }));
      if (node.parentId) this.emptied.add(node.parentId);
      node.parentId = folderId;
    }
    if (node.title !== link.title) {
      await write(echoKey('changed', node.id), () => chrome.bookmarks.update(node.id, { title: link.title }));
      node.title = link.title;
    }
    if (!sameAddress(node.url!, link.url)) {
      await write(echoKey('changed', node.id), () => chrome.bookmarks.update(node.id, { url: link.url }));
      node.url = link.url;
    }
    return node.id;
  }

  async create(folderId: string, link: LinkChange): Promise<string> {
    const node = await createNode({ parentId: folderId, title: link.title, url: link.url });
    this.nodes.set(node.id, node);
    return node.id;
  }

  async remove(node: Node): Promise<void> {
    this.nodes.delete(node.id);
    for (const list of this.strays.values()) {
      const at = list.indexOf(node);
      if (at >= 0) list.splice(at, 1);
    }
    if (node.parentId) this.emptied.add(node.parentId);
    // Gone already, taken out by the person meanwhile: nothing left to do.
    await write(echoKey('removed', node.id), () => chrome.bookmarks.remove(node.id)).catch(() => {});
  }

  /**
   * Removes the folders this pull emptied: Unsorted, and those of hubs the
   * server no longer has, archived or renamed. A hub that is left with no
   * links keeps its folders. Where the browser's own sync carries the folder
   * to another browser syncing it too, that browser would take the removal
   * for the person deleting the folder, and archive the hub.
   */
  async removeEmptied(auth: Credentials): Promise<void> {
    const { state } = this;
    // Hub names still in use on the server, asked once, only when a hub folder
    // was emptied. Unanswered, every hub folder stays until a later pull.
    let live: Set<string> | null | undefined;
    for (const folderId of this.emptied) {
      const hub = hubOfFolder(state, folderId);
      if (hub === undefined || folderId === state.rootId) continue;
      const children = await chrome.bookmarks.getChildren(folderId).catch(() => null);
      if (!children || children.length > 0) continue;
      if (hub !== null) {
        if (live === undefined) {
          live = await listAllHubs(auth, timeout()).then(
            (hubs) => new Set(hubs.filter((h) => h.status !== 'archived').map((h) => h.name)),
            () => null,
          );
        }
        if (live === null || live.has(hub)) continue;
      }
      await write(echoKey('removed', folderId), () => chrome.bookmarks.remove(folderId)).catch(() => {});
      forgetFolder(state, folderId);
    }
  }
}

/** Takes a link's bookmarks out, and any stray bookmark of its address. */
async function dropLink(view: FolderView, id: string, url?: string): Promise<void> {
  const link = view.state.links[id];
  for (const bookmarkId of link?.bookmarkIds ?? []) {
    const node = view.nodes.get(bookmarkId);
    if (node) await view.remove(node);
  }
  const address = url ?? link?.url;
  if (address) for (const node of [...view.straysFor(address)]) await view.remove(node);
  delete view.state.links[id];
}

/**
 * Makes the folder show one link as the server has it: a bookmark in each of
 * its hubs' folders, or in Unsorted.
 *
 * Every bookmark of the link's address belongs to it, and a second one in the
 * same folder is kept. Where the browser's own sync carries the folder to
 * another browser that syncs it too, both make a bookmark for a new link and
 * each gets the other's; were each to remove the extra one, both copies would
 * go, and the other browser would take that for the person deleting them and
 * archive the link.
 *
 * A bookmark in a folder the link has left is moved to one it is in, or,
 * when each of those already had one, removed: those are the same nodes in
 * every browser, so the removals agree and a copy is left everywhere.
 */
async function applyLink(view: FolderView, link: LinkChange): Promise<void> {
  if (link.status !== 'active') {
    await dropLink(view, link.id, link.url);
    return;
  }
  const { state } = view;
  const hubs = [...new Set(link.hubs.filter((h) => h.trim() !== ''))];
  const wanted = hubs.length > 0 ? hubs : [null];
  const folders: string[] = [];
  for (const hub of wanted) folders.push(await view.folderFor(hub));
  // A hub's bookmarks may be in any folder of it.
  const homes = wanted.map((hub) => foldersOf(state, hub));
  const home = new Set(homes.flat());

  const mine = (state.links[link.id]?.bookmarkIds ?? [])
    .map((id) => view.nodes.get(id))
    .filter((n): n is Node => n !== undefined);
  // Untracked bookmarks of the address are claimed, all of them.
  const nodes = [...mine, ...view.straysFor(link.url).splice(0)];
  const placed = nodes.filter((n) => home.has(n.parentId!));
  const spare = nodes.filter((n) => !home.has(n.parentId!));
  const kept: string[] = [];
  for (const node of placed) kept.push(await view.fit(node, node.parentId!, link));
  // A hub with none gets one moved from elsewhere, or a new one.
  let movedTo: string | undefined;
  for (const [i, folderId] of folders.entries()) {
    if (placed.some((n) => homes[i]!.includes(n.parentId!))) continue;
    const node = spare.shift();
    if (node) movedTo ??= folderId;
    kept.push(node ? await view.fit(node, folderId, link) : await view.create(folderId, link));
  }
  // The rest follow the first one moved; if none had to move, they go.
  for (const node of spare) {
    if (movedTo) kept.push(await view.fit(node, movedTo, link));
    else await view.remove(node);
  }
  state.links[link.id] = { url: link.url, title: link.title, bookmarkIds: kept };
}

// ---------------------------------------------------------------- pushing

/** Sends one change. The link a save makes is recorded against its bookmark. */
async function send(state: SyncState, auth: Credentials, change: PendingChange): Promise<void> {
  const hubNamed = async (name: string): Promise<Hub | undefined> =>
    (await listAllHubs(auth, timeout())).find((h) => h.name === name);
  switch (change.kind) {
    case 'save': {
      const { link } = await saveLink(auth, { url: change.url, title: change.title, hub: change.hub ?? undefined }, timeout());
      const known = state.links[link.id];
      const bookmarkIds = [...new Set([...(known?.bookmarkIds ?? []), change.bookmarkId])];
      state.links[link.id] = { url: link.url, title: link.title, bookmarkIds };
      return;
    }
    case 'title':
      await updateLink(auth, change.linkId, { title: change.title }, timeout());
      return;
    case 'hubs': {
      // Empty lists are left out, and a change with neither, as one queued
      // by an older version holding the whole set, sends nothing.
      const patch: { addHubs?: string[]; removeHubs?: string[] } = {};
      if (change.addHubs?.length) patch.addHubs = change.addHubs;
      if (change.removeHubs?.length) patch.removeHubs = change.removeHubs;
      if (patch.addHubs || patch.removeHubs) await updateLink(auth, change.linkId, patch, timeout());
      return;
    }
    case 'archive':
      await updateLink(auth, change.linkId, { status: 'archived' }, timeout());
      return;
    case 'createHub': {
      if (await createHub(auth, change.name, timeout())) return;
      // The name is taken: by an archived hub, a folder made again brings it back.
      const hub = await hubNamed(change.name);
      if (hub?.status === 'archived') await updateHub(auth, hub.id, { status: 'active' }, timeout());
      return;
    }
    case 'renameHub': {
      const hub = await hubNamed(change.from);
      if (hub) await updateHub(auth, hub.id, { name: change.to }, timeout());
      else await createHub(auth, change.to, timeout());
      return;
    }
    case 'archiveHub': {
      const hub = await hubNamed(change.name);
      if (!hub) return;
      if (!change.archived) {
        // Archived already, its links keep it, as they do when the server
        // archives a hub: the folder went in a pull, here or in another browser
        // whose removal the browser's own sync brought.
        if (hub.status === 'archived') return;
        await updateHub(auth, hub.id, { status: 'archived' }, timeout());
        // Kept at once: if taking the hub off its links fails, the retry finds
        // the hub archived, and must still know this change archived it.
        change.archived = true;
        await saveState(state);
      } else if (hub.status !== 'archived') {
        // Brought back in the web app before the retry: its links stay.
        return;
      }
      if (change.linkIds.length > 0) await unassignHub(auth, hub.id, change.linkIds, timeout());
      return;
    }
  }
}

/**
 * Sends the queue in order. False when the server could not be reached: the
 * rest waits for the next try. A change the server refuses is dropped, and the
 * next pull is a full one, which puts the folder back as the server has it.
 */
async function flush(state: SyncState, auth: Credentials): Promise<boolean> {
  while (state.queue.length > 0) {
    try {
      await send(state, auth, state.queue[0]!);
    } catch (err) {
      if (err instanceof AuthRequiredError) throw err;
      if (worthRetrying(err)) {
        state.error = describe(err, state.server);
        await saveState(state);
        return false;
      }
      state.error = describe(err, state.server);
      state.full = true;
    }
    state.queue.shift();
    await saveState(state);
  }
  return true;
}

// ---------------------------------------------------------------- pulling

/** The server could not be reached with the queue: the error is already in the state. */
class Unreached extends Error {}

/** The server has no changes feed: one older than bookmark sync. */
class NoFeed extends Error {}

/** A page of the feed. Only the feed answers a pull with 404: a push's 404 stays in flush. */
async function feedPage(auth: Auth, since: string | null): Promise<ChangesPage> {
  try {
    return await linkChanges(auth, since, PAGE_SIZE, timeout());
  } catch (err) {
    throw err instanceof HttpError && err.status === 404 ? new NoFeed() : err;
  }
}

/** Pending changes first, so a pull never undoes them; then the server's changes, page by page. */
async function runPull(state: SyncState, auth: Auth): Promise<void> {
  if (!(await flush(state, auth))) throw new Unreached();
  await pruneEchoes();
  const full = state.full || state.cursor === null;
  let since = full ? null : state.cursor;
  // The first page comes before the folder is looked for or made, so that a
  // server without the feed leaves no empty folder behind.
  let changes = await feedPage(auth, since);
  const view = await FolderView.open(state);
  state.full = full;
  await saveState(state);

  const seen = new Set<string>();
  for (let page = 1; ; page++) {
    for (const link of changes.items) {
      seen.add(link.id);
      await applyLink(view, link);
    }
    for (const { id } of changes.deleted) await dropLink(view, id);
    const next = changes.cursor ?? since;
    // A page that does not move the cursor would come back forever.
    const stuck = next === since;
    since = next;
    // A pull of everything keeps no cursor until it ends: cut short, it starts over.
    if (!full) {
      state.cursor = since;
      await saveState(state);
    }
    if (!changes.more || stuck || page >= MAX_PAGES) break;
    changes = await feedPage(auth, since);
  }

  if (full) {
    // Links the server no longer has at all.
    for (const id of Object.keys(state.links)) if (!seen.has(id)) await dropLink(view, id);
    state.cursor = since;
    state.full = false;
  }
  // Bookmarks in the folder the server has never seen: added while sync was
  // off, kept from before, or made while no event reached the extension. They
  // are sent as if just made.
  for (const node of [...view.strays.values()].flat()) {
    state.queue.push({
      kind: 'save', bookmarkId: node.id, url: node.url!, title: node.title, hub: hubOfFolder(state, node.parentId) ?? null,
    });
  }
  await view.removeEmptied(auth);
  state.lastSync = Date.now();
  // Cleared here, so that what the last sends ran into still shows.
  state.error = null;
  await saveState(state);
  await flush(state, auth);
}

/**
 * Whether sync may use the bookmarks API. Chrome keeps chrome.bookmarks in a
 * running worker after the permission is taken back, and only refuses its
 * calls, so the permission itself is asked. Firefox also asks, with bookmarks,
 * whether they may be sent to the server (bookmarksInfo), and about:addons can
 * take that back alone. Unanswered, the API's presence decides.
 */
async function bookmarksAllowed(): Promise<boolean> {
  if (!chrome.bookmarks) return false;
  const wanted: { permissions: string[]; data_collection?: string[] } = { permissions: ['bookmarks'] };
  if (asksToShareBookmarks()) wanted.data_collection = ['bookmarksInfo'];
  return chrome.permissions.contains(wanted as chrome.permissions.Permissions).catch(() => true);
}

const BOOKMARKS_GONE = 'Sync is off: the browser no longer lets bukmark use your bookmarks.';

/** A pull, for Sync now, the alarm, the browser starting and a save. */
async function pullTask(): Promise<SyncReply> {
  const state = await loadSyncState();
  if (!state?.enabled) return { ok: false, error: 'Sync is off.' };
  if (!(await bookmarksAllowed())) {
    await turnOff(state, BOOKMARKS_GONE);
    return { ok: false, error: state.error! };
  }
  const auth = await syncAuth(state);
  if (!auth) {
    await turnOff(state);
    return { ok: false, error: 'Log in to sync.' };
  }
  try {
    await runPull(state, auth);
    return state.error ? { ok: false, error: state.error } : { ok: true };
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      await turnOff(state, 'Your session ended — log in again.');
      return { ok: false, error: state.error! };
    }
    if (err instanceof NoFeed) {
      // Off, rather than on and failing: pushes would reach a server that
      // can't file a moved bookmark, and nothing would come back.
      await turnOff(state, `Update your bukmark server — ${new URL(state.server).host} can't sync bookmarks yet.`);
      return { ok: false, error: state.error! };
    }
    if (!(err instanceof Unreached)) state.error = describe(err, state.server);
    await saveState(state);
    return { ok: false, error: state.error! };
  }
}

export function pullNow(): Promise<SyncReply> {
  return inTurn(pullTask);
}

/**
 * For the alarm, the browser starting, and a save from the popup or the
 * shortcut. Never rejects: what went wrong is kept for the settings page.
 */
export async function pullIfEnabled(): Promise<void> {
  try {
    if ((await loadSyncState())?.enabled) await pullNow();
  } catch {
    // Storage itself failed; the next alarm tries again.
  }
}

/**
 * Renames the folder another server was synced with to "bukmark (its host)",
 * which no pull looks for: it and its bookmarks are left as they are from then
 * on. False only when it is there and could not be renamed.
 */
async function setAside(old: SyncState): Promise<boolean> {
  const folder = await getNode(old.rootId!);
  if (!folder || !isFolder(folder)) return true;
  let host = old.server;
  try {
    host = new URL(old.server).host;
  } catch {
    // Named after the address as stored.
  }
  const title = `${SYNC_FOLDER} (${host})`;
  return write(echoKey('changed', folder.id), () => chrome.bookmarks.update(folder.id, { title }))
    .then(() => true, () => false);
}

/**
 * Turns sync on for the current login and fills the folder. The page asks for
 * the bookmarks permission first, in the click (allowBookmarkImport).
 */
export function enableSync(): Promise<SyncReply> {
  return inTurn(async () => {
    if (!(await bookmarksAllowed())) return { ok: false, error: 'Not turned on — access to your bookmarks was declined.' };
    const { baseUrl } = await loadSettings();
    const auth = await authFor(baseUrl);
    if (!auth) return { ok: false, error: 'Log in to sync.' };
    const stored = await loadSyncState();
    let state: SyncState;
    if (stored?.server === auth.server) {
      // Bookmarks already matched to this server's links stay matched.
      state = stored;
    } else {
      // The folder holds another server's links: filled from it, they would
      // all be sent here. It is set aside, and this server gets a new one.
      if (stored?.server && stored.rootId && !(await setAside(stored))) {
        return { ok: false, error: `Not turned on — rename the ${SYNC_FOLDER} folder in your bookmarks, then try again.` };
      }
      state = freshState(auth.server);
    }
    Object.assign(state, { enabled: true, cursor: null, full: true, queue: [], error: null });
    await saveState(state);
    // The first pull comes after a minute, not five. Bookmark listeners added
    // now, in a background that started without the permission, may not wake
    // it once it is unloaded (seen in Firefox 156): the alarm starts it again
    // soon, and a background that starts with the permission listens for good.
    await chrome.alarms.create(SYNC_ALARM, { delayInMinutes: 1, periodInMinutes: SYNC_PERIOD_MINUTES });
    listenForBookmarks();
    return pullTask();
  });
}

export function disableSync(): Promise<SyncReply> {
  return inTurn(async () => {
    const state = await loadSyncState();
    if (state) await turnOff(state);
    return { ok: true };
  });
}

/** Logging out, or into another server, turns sync off. For storage.onChanged in the background. */
export function checkSyncLogin(): Promise<void> {
  return inTurn(async () => {
    const state = await loadSyncState();
    if (state?.enabled && !(await syncAuth(state))) await turnOff(state);
  }).catch(() => {});
}

/** The pull alarm, set again where the browser dropped it (Firefox forgets alarms on restart). */
export async function ensureSyncAlarm(): Promise<void> {
  try {
    if (!chrome.alarms || !(await loadSyncState())?.enabled) return;
    if (!(await chrome.alarms.get(SYNC_ALARM))) {
      await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
    }
  } catch {
    // Checked again the next time the background starts.
  }
}

/** The background's reply to a page's sync message, or undefined for another message. */
export function handleSyncMessage(message: unknown): Promise<SyncReply> | undefined {
  const m = message as Partial<SyncRequest> | undefined;
  if (m?.type !== 'sync') return undefined;
  if (m.action === 'enable') return enableSync();
  if (m.action === 'disable') return disableSync();
  if (m.action === 'pull') return pullNow();
  return undefined;
}

/** From a page: asks the background for a pull, when sync is on. Never fails the caller. */
export async function requestSyncPull(): Promise<void> {
  try {
    if (!(await loadSyncState())?.enabled) return;
    const message: SyncRequest = { type: 'sync', action: 'pull' };
    await chrome.runtime.sendMessage(message);
  } catch {
    // The save worked; the next alarm pulls.
  }
}

// ---------------------------------------------------------------- the person's changes

/** Sync's state and login, when on. */
async function active(): Promise<{ state: SyncState; auth: Auth } | null> {
  const state = await loadSyncState();
  if (!state?.enabled || !state.rootId) return null;
  // Events keep coming in Firefox after the consent to send bookmarks is taken back.
  if (!(await bookmarksAllowed())) {
    await turnOff(state, BOOKMARKS_GONE);
    return null;
  }
  const auth = await syncAuth(state);
  if (!auth) {
    await turnOff(state);
    return null;
  }
  return { state, auth };
}

function linkOf(state: SyncState, bookmarkId: string): string | undefined {
  return Object.entries(state.links).find(([, l]) => l.bookmarkIds.includes(bookmarkId))?.[0];
}

function queuedSave(state: SyncState, bookmarkId: string): Extract<PendingChange, { kind: 'save' }> | undefined {
  return state.queue.find((c): c is Extract<PendingChange, { kind: 'save' }> => c.kind === 'save' && c.bookmarkId === bookmarkId);
}

function dropQueuedSave(state: SyncState, bookmarkId: string): void {
  state.queue = state.queue.filter((c) => !(c.kind === 'save' && c.bookmarkId === bookmarkId));
}

/** Every bookmark directly in the folder or in one of its synced subfolders, where it is now. */
async function bookmarksInside(state: SyncState): Promise<Array<Node & { url: string }>> {
  const found: Array<Node & { url: string }> = [];
  const [tree] = (await chrome.bookmarks.getSubTree(state.rootId!).catch(() => [])) as Node[];
  for (const node of tree?.children ?? []) {
    if (isBookmark(node)) found.push(node);
    else if (inside(state, node.id)) for (const child of node.children ?? []) if (isBookmark(child)) found.push(child);
  }
  return found;
}

/** The link's bookmarks in the folder now, any of its address that no link holds yet included. */
async function copiesOf(state: SyncState, link: SyncedLink): Promise<Node[]> {
  const copies = (await bookmarksInside(state)).filter((n) => link.bookmarkIds.includes(n.id) || sameAddress(n.url, link.url));
  link.bookmarkIds = copies.map((n) => n.id);
  return copies;
}

/**
 * A bookmark of a link left a folder of `hub`: deleted, moved out of the
 * bukmark folder, or given another address (S4). The link leaves the hub only
 * when no copy is left in a folder of it, and is archived only when none is
 * left anywhere: a duplicate, or a copy the browser's own sync brought, still
 * stands for it.
 */
async function detach(
  state: SyncState,
  linkId: string,
  bookmarkId: string | null,
  hub: string | null | undefined,
): Promise<void> {
  const link = state.links[linkId]!;
  link.bookmarkIds = link.bookmarkIds.filter((id) => id !== bookmarkId);
  const left = (await copiesOf(state, link)).filter((n) => n.id !== bookmarkId);
  link.bookmarkIds = left.map((n) => n.id);
  if (left.length === 0) {
    delete state.links[linkId];
    state.queue.push({ kind: 'archive', linkId });
    return;
  }
  if (typeof hub === 'string' && !left.some((n) => hubOfFolder(state, n.parentId) === hub)) {
    state.queue.push({ kind: 'hubs', linkId, addHubs: [], removeHubs: [hub] });
  }
}

/** Queues a bookmark to be sent as a link, once: a bookmark already held or queued is not sent twice. */
function queueSave(state: SyncState, node: Node & { url: string }): void {
  if (!isWebPage(node.url) || linkOf(state, node.id)) return;
  const change = { url: node.url, title: node.title, hub: hubOfFolder(state, node.parentId) ?? null };
  const queued = queuedSave(state, node.id);
  if (queued) Object.assign(queued, change);
  else state.queue.push({ kind: 'save', bookmarkId: node.id, ...change });
}

/**
 * A folder made directly in the bukmark folder is a new hub, unless the name is
 * taken. One moved in, or named after being made, may hold bookmarks already.
 */
async function folderArrived(state: SyncState, folder: Node, withContents: boolean): Promise<void> {
  const name = hubOfTitle(folder.title);
  if (name === null) {
    if (!state.unsortedId) state.unsortedId = folder.id;
    else state.twinFolders[folder.id] = null;
  } else if (name.trim() === '') {
    return;
  } else if (state.hubFolders[name]) {
    // A second folder of a hub, as the browser's own sync brings one that
    // another browser made: another folder of the same hub.
    state.twinFolders[folder.id] = name;
  } else {
    state.hubFolders[name] = folder.id;
    state.queue.push({ kind: 'createHub', name });
  }
  if (!withContents) return;
  const children = (await chrome.bookmarks.getChildren(folder.id).catch(() => [])) as Node[];
  for (const node of children) if (isBookmark(node)) queueSave(state, node);
}

/**
 * A hub folder was deleted or moved out (S4): the hub is archived and taken
 * off its links, which stay. Where the hub has another folder, it stays, and
 * the bookmarks count as deleted one by one. Unsorted is no hub: like the
 * whole bukmark folder, it going changes nothing on the server, and the next
 * pull, a full one, makes it again with its links.
 */
async function folderLeft(state: SyncState, folderId: string): Promise<void> {
  const hub = hubOfFolder(state, folderId);
  if (hub === undefined) return;
  let stays = forgetFolder(state, folderId);
  if (hub !== null && !stays) {
    // Another folder of this hub may be in the tree without the extension
    // having seen it arrive (browser sync can add one while no event reaches
    // this background). It still holds the hub, so nothing is archived.
    const siblings = ((await chrome.bookmarks.getChildren(state.rootId!).catch(() => [])) as Node[]).filter(
      (n) => isFolder(n) && n.id !== folderId && hubOfTitle(n.title) === hub,
    );
    if (siblings.length > 0) {
      for (const twin of siblings) await folderArrived(state, twin, true);
      stays = true;
    }
  }
  const present = new Set((await bookmarksInside(state)).map((n) => n.id));
  state.queue = state.queue.filter((c) => c.kind !== 'save' || present.has(c.bookmarkId));
  const affected = Object.keys(state.links).filter((id) => state.links[id]!.bookmarkIds.some((b) => !present.has(b)));
  if (hub === null) {
    for (const id of affected) state.links[id]!.bookmarkIds = state.links[id]!.bookmarkIds.filter((b) => present.has(b));
    state.full = true;
  } else if (stays) {
    for (const id of affected) await detach(state, id, null, hub);
  } else {
    for (const id of affected) state.links[id]!.bookmarkIds = state.links[id]!.bookmarkIds.filter((b) => present.has(b));
    state.queue.push({ kind: 'archiveHub', name: hub, linkIds: affected });
  }
}

async function onCreated(id: string, node: Node): Promise<void> {
  if (await takeEcho(echoKey('created', id))) return;
  if (node.parentId && (await takeEcho(createKey(node.parentId, node.title, node.url)))) return;
  const on = await active();
  if (!on) return;
  const { state } = on;
  if (!inside(state, node.parentId)) return;
  if (isBookmark(node)) queueSave(state, node);
  else if (isFolder(node) && node.parentId === state.rootId) await folderArrived(state, node, false);
  else return;
  await pushed(on);
}

async function onChanged(id: string, info: { title: string; url?: string }): Promise<void> {
  if (await takeEcho(echoKey('changed', id))) return;
  const on = await active();
  if (!on) return;
  const { state } = on;
  // Unsorted renamed changes nothing on the server: the next pull names it back.
  if (id === state.rootId || id === state.unsortedId) return;
  if (Object.hasOwn(state.twinFolders, id)) {
    // Another folder of a hub, renamed: a folder of its new name from now on.
    const hub = state.twinFolders[id];
    const node = await getNode(id);
    if (!node || hubOfTitle(node.title) === hub) return;
    forgetFolder(state, id);
    await folderArrived(state, node, true);
    await pushed(on);
    return;
  }
  const hub = hubOfFolder(state, id);
  if (typeof hub === 'string') {
    // "Unsorted", or a name another hub folder has, would merge two folders:
    // the next pull names it back.
    const renamed = hubOfTitle(info.title);
    if (renamed === null || renamed === hub || renamed.trim() === '' || state.hubFolders[renamed]) return;
    delete state.hubFolders[hub];
    state.hubFolders[renamed] = id;
    promoteOrphans(state);
    state.queue.push({ kind: 'renameHub', from: hub, to: renamed });
    await pushed(on);
    return;
  }
  const node = await getNode(id);
  if (!node || !inside(state, node.parentId)) return;
  if (!isBookmark(node)) {
    // A folder the person named after making it, or renamed from a taken name.
    if (node.parentId === state.rootId) await folderArrived(state, node, true);
    await pushed(on);
    return;
  }
  const linkId = linkOf(state, id);
  const link = linkId ? state.links[linkId] : undefined;
  if (linkId && link) {
    if (!sameAddress(node.url, link.url)) {
      // Another address is another link: the old one is let go as if deleted.
      await detach(state, linkId, id, hubOfFolder(state, node.parentId));
      queueSave(state, node);
    } else if (node.title !== link.title) {
      link.title = node.title;
      state.queue.push({ kind: 'title', linkId, title: node.title });
    }
  } else {
    const queued = queuedSave(state, id);
    if (queued && isWebPage(node.url)) Object.assign(queued, { url: node.url, title: node.title });
    else if (queued) dropQueuedSave(state, id);
    else queueSave(state, node);
  }
  await pushed(on);
}

async function onMoved(id: string, info: { parentId: string; oldParentId: string }): Promise<void> {
  if (await takeEcho(echoKey('moved', id))) return;
  const on = await active();
  if (!on) return;
  const { state } = on;
  const wasIn = inside(state, info.oldParentId);
  const isIn = inside(state, info.parentId);
  if (!wasIn && !isIn) return;
  // Put elsewhere in the same folder: nothing sync keeps has changed. Sending
  // the link's hubs as this browser knows them would take off any hub the
  // server added since the last pull.
  if (info.parentId === info.oldParentId) return;
  const node = await getNode(id);
  if (!node) return;
  if (isFolder(node)) {
    if (info.oldParentId === state.rootId && info.parentId !== state.rootId) await folderLeft(state, id);
    else if (info.parentId === state.rootId && info.oldParentId !== state.rootId) await folderArrived(state, node, true);
    else return;
  } else if (isBookmark(node)) {
    const linkId = linkOf(state, id);
    if (wasIn && !isIn) {
      if (linkId) await detach(state, linkId, id, hubOfFolder(state, info.oldParentId));
      else dropQueuedSave(state, id);
    } else if (linkId) {
      // Into the new folder's hub, and out of the old one's unless another
      // copy is still in a folder of it. Unsorted and the bukmark folder itself
      // are no hub; two folders of the same hub are one.
      const copies = await copiesOf(state, state.links[linkId]!);
      const from = hubOfFolder(state, info.oldParentId);
      const to = hubOfFolder(state, info.parentId);
      const still = typeof from === 'string' && copies.some((n) => hubOfFolder(state, n.parentId) === from);
      const removeHubs = typeof from === 'string' && from !== to && !still ? [from] : [];
      const addHubs = typeof to === 'string' && to !== from ? [to] : [];
      if (removeHubs.length > 0 || addHubs.length > 0) state.queue.push({ kind: 'hubs', linkId, addHubs, removeHubs });
    } else {
      const queued = queuedSave(state, id);
      if (queued) queued.hub = hubOfFolder(state, info.parentId) ?? null;
      else queueSave(state, node);
    }
  } else {
    return;
  }
  await pushed(on);
}

async function onRemoved(id: string, info: { parentId: string; node: Node }): Promise<void> {
  if (await takeEcho(echoKey('removed', id))) return;
  const on = await active();
  if (!on) return;
  const { state } = on;
  if (id === state.rootId) {
    // The whole folder: nothing changes on the server. The next pull makes it again.
    Object.assign(state, { rootId: null, hubFolders: {}, unsortedId: null, twinFolders: {}, links: {}, cursor: null, full: true });
    state.queue = state.queue.filter((c) => c.kind !== 'save');
  } else if (hubOfFolder(state, id) !== undefined) {
    await folderLeft(state, id);
  } else if (inside(state, info.parentId) && !isFolder(info.node)) {
    const linkId = linkOf(state, id);
    if (linkId) await detach(state, linkId, id, hubOfFolder(state, info.parentId));
    else dropQueuedSave(state, id);
  } else {
    return;
  }
  await pushed(on);
}

/** Keeps what the event changed, then sends it at once. */
async function pushed({ state, auth }: { state: SyncState; auth: Auth }): Promise<void> {
  await saveState(state);
  try {
    await flush(state, auth);
  } catch (err) {
    if (err instanceof AuthRequiredError) await turnOff(state, 'Your session ended — log in again.');
  }
}

let listening = false;

/**
 * The four bookmark events. For the background to call as it starts, so that
 * an edit wakes it, and again once sync is turned on: the API exists only
 * after the bookmarks permission is granted.
 */
export function listenForBookmarks(): void {
  if (listening || !chrome.bookmarks) return;
  listening = true;
  const run = (task: () => Promise<void>): void => {
    void inTurn(task).catch(() => {});
  };
  chrome.bookmarks.onCreated.addListener((id, node) => run(() => onCreated(id, node as Node)));
  chrome.bookmarks.onChanged.addListener((id, info) => run(() => onChanged(id, info)));
  chrome.bookmarks.onMoved.addListener((id, info) => run(() => onMoved(id, info)));
  chrome.bookmarks.onRemoved.addListener((id, info) => run(() => onRemoved(id, info as { parentId: string; node: Node })));
}
