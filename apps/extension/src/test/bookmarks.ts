import { vi } from 'vitest';

/** A node as the bookmarks API hands it out. Folders carry `children` only from getTree and getSubTree. */
export interface BookmarkTreeNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  dateAdded?: number;
  /** Chrome 134+: which of its root folders this is. */
  folderType?: 'bookmarks-bar' | 'other' | 'mobile' | 'managed';
  /** Chrome 134+: whether the browser's own sync carries this node to the account. */
  syncing?: boolean;
  children?: BookmarkTreeNode[];
}

interface Stored {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  dateAdded: number;
  folderType?: BookmarkTreeNode['folderType'];
  /** Child ids in order; undefined for a bookmark. */
  children?: string[];
}

export type Flavour = 'chrome' | 'firefox';

type CreatedListener = (id: string, node: BookmarkTreeNode) => void;
type ChangedListener = (id: string, changeInfo: { title: string; url?: string }) => void;
type MovedListener = (id: string, moveInfo: { parentId: string; index: number; oldParentId: string; oldIndex: number }) => void;
type RemovedListener = (id: string, removeInfo: { parentId: string; index: number; node: BookmarkTreeNode }) => void;

/**
 * The roots each browser starts with. Chrome numbers its nodes and marks its
 * root folders with folderType; Firefox uses fixed 12-character GUIDs, with the
 * menu first and "Other Bookmarks" (unfiled_____) third.
 */
const ROOTS: Record<Flavour, { root: string; folders: Array<Pick<Stored, 'id' | 'title' | 'folderType'>> }> = {
  chrome: {
    root: '0',
    folders: [
      { id: '1', title: 'Bookmarks bar', folderType: 'bookmarks-bar' },
      { id: '2', title: 'Other bookmarks', folderType: 'other' },
      { id: '3', title: 'Mobile bookmarks', folderType: 'mobile' },
    ],
  },
  firefox: {
    root: 'root________',
    folders: [
      { id: 'menu________', title: 'Bookmarks Menu' },
      { id: 'toolbar_____', title: 'Bookmarks Toolbar' },
      { id: 'unfiled_____', title: 'Other Bookmarks' },
      { id: 'mobile______', title: 'Mobile Bookmarks' },
    ],
  },
};

/**
 * An in-memory bookmark tree that behaves like the browser's: ids the browser
 * picks, parents and indexes, root folders that cannot be changed, and the four
 * events, delivered after the call as the browser delivers them. Chrome's
 * onRemoved for a folder is one event whose node carries the whole subtree;
 * Firefox's carries no children. A change that changes nothing fires nothing.
 */
export class BookmarkTree {
  readonly rootId: string;
  readonly nodes = new Map<string, Stored>();
  readonly onCreated: CreatedListener[] = [];
  readonly onChanged: ChangedListener[] = [];
  readonly onMoved: MovedListener[] = [];
  readonly onRemoved: RemovedListener[] = [];
  private lastId = 100;
  private clock = 1_700_000_000_000;
  /** While set, events wait in `held` instead of being delivered: a worker that is not running yet. */
  holding = false;
  /**
   * Chrome 134+ marks every node with `syncing`: true where Chrome Sync carries
   * the bookmarks. Unset, as in older Chrome, the field is left out; Firefox
   * never has it.
   */
  syncing: boolean | undefined = undefined;
  private held: Array<() => void> = [];

  constructor(readonly flavour: Flavour = 'chrome') {
    const { root, folders } = ROOTS[flavour];
    this.rootId = root;
    this.nodes.set(root, { id: root, title: '', dateAdded: this.clock, children: folders.map((f) => f.id) });
    for (const f of folders) this.nodes.set(f.id, { ...f, parentId: root, dateAdded: this.clock, children: [] });
  }

  /** Where the browser puts a bookmark created without a parent. */
  get otherId(): string {
    return this.flavour === 'chrome' ? '2' : 'unfiled_____';
  }

  private newId(): string {
    const n = ++this.lastId;
    return this.flavour === 'chrome' ? String(n) : `fake${n}`.padEnd(12, '_');
  }

  private node(id: string): Stored {
    const node = this.nodes.get(id);
    // Chrome's wording; Firefox says much the same.
    if (!node) throw new Error("Can't find bookmark for id.");
    return node;
  }

  private isRootFolder(id: string): boolean {
    return id === this.rootId || this.nodes.get(id)?.parentId === this.rootId;
  }

  private indexOf(node: Stored): number {
    return node.parentId === undefined ? 0 : this.node(node.parentId).children!.indexOf(node.id);
  }

  /** The node as the API returns it; `deep` adds the whole subtree. */
  view(id: string, deep = false): BookmarkTreeNode {
    const node = this.node(id);
    const out: BookmarkTreeNode = { id: node.id, title: node.title, dateAdded: node.dateAdded };
    if (node.parentId !== undefined) {
      out.parentId = node.parentId;
      out.index = this.indexOf(node);
    }
    if (node.url !== undefined) out.url = node.url;
    if (node.folderType && this.flavour === 'chrome') out.folderType = node.folderType;
    if (this.syncing !== undefined && this.flavour === 'chrome') out.syncing = this.syncing;
    if (deep && node.children) out.children = node.children.map((c) => this.view(c, true));
    return out;
  }

  private emit<L extends (...args: never[]) => void>(listeners: L[], ...args: Parameters<L>): void {
    // The listeners are read at delivery: a restarted background gets what was held.
    const deliver = (): void => { for (const listener of [...listeners]) listener(...args); };
    if (this.holding) this.held.push(deliver);
    else queueMicrotask(deliver);
  }

  /** Holds events back until release(), as they wait while a worker starts. */
  hold(): void {
    this.holding = true;
  }

  release(): void {
    this.holding = false;
    for (const deliver of this.held.splice(0)) queueMicrotask(deliver);
  }

  /** Loses the held events, as when browser sync changes the tree with no background there to hear it. */
  drop(): void {
    this.holding = false;
    this.held.length = 0;
  }

  create(details: { parentId?: string; index?: number; title?: string; url?: string }): BookmarkTreeNode {
    const parentId = details.parentId ?? this.otherId;
    const parent = this.node(parentId);
    if (!parent.children) throw new Error("Can't add a bookmark to a bookmark.");
    if (parentId === this.rootId) throw new Error("Can't modify the root bookmark folders.");
    const node: Stored = { id: this.newId(), parentId, title: details.title ?? '', dateAdded: ++this.clock };
    if (details.url !== undefined) {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(details.url)) throw new Error('Invalid URL.');
      node.url = details.url;
    } else {
      node.children = [];
    }
    this.nodes.set(node.id, node);
    const index = details.index ?? parent.children.length;
    parent.children.splice(index, 0, node.id);
    const view = this.view(node.id);
    this.emit(this.onCreated, node.id, view);
    return view;
  }

  update(id: string, changes: { title?: string; url?: string }): BookmarkTreeNode {
    const node = this.node(id);
    if (this.isRootFolder(id)) throw new Error("Can't modify the root bookmark folders.");
    if (changes.url !== undefined && node.url === undefined) throw new Error("Can't set URL of a bookmark folder.");
    let changed = false;
    if (changes.title !== undefined && changes.title !== node.title) {
      node.title = changes.title;
      changed = true;
    }
    if (changes.url !== undefined && changes.url !== node.url) {
      node.url = changes.url;
      changed = true;
    }
    if (changed) {
      const info: { title: string; url?: string } = { title: node.title };
      if (node.url !== undefined) info.url = node.url;
      this.emit(this.onChanged, id, info);
    }
    return this.view(id);
  }

  move(id: string, destination: { parentId?: string; index?: number }): BookmarkTreeNode {
    const node = this.node(id);
    if (this.isRootFolder(id)) throw new Error("Can't modify the root bookmark folders.");
    const parentId = destination.parentId ?? node.parentId!;
    const parent = this.node(parentId);
    if (!parent.children) throw new Error("Can't move a bookmark into a bookmark.");
    if (parentId === this.rootId) throw new Error("Can't modify the root bookmark folders.");
    for (let p: Stored | undefined = parent; p; p = p.parentId ? this.nodes.get(p.parentId) : undefined) {
      if (p.id === id) throw new Error("Can't move a folder into itself.");
    }
    const oldParentId = node.parentId!;
    const oldIndex = this.indexOf(node);
    const index = Math.min(destination.index ?? parent.children.length, parent.children.length);
    if (oldParentId === parentId && (index === oldIndex || index === oldIndex + 1)) return this.view(id);
    const siblings = this.node(oldParentId).children!;
    siblings.splice(oldIndex, 1);
    const at = oldParentId === parentId && index > oldIndex ? index - 1 : index;
    parent.children.splice(at, 0, id);
    node.parentId = parentId;
    this.emit(this.onMoved, id, { parentId, index: at, oldParentId, oldIndex });
    return this.view(id);
  }

  remove(id: string, recursive = false): void {
    const node = this.node(id);
    if (this.isRootFolder(id)) throw new Error("Can't modify the root bookmark folders.");
    if (!recursive && node.children && node.children.length > 0) {
      throw new Error("Can't remove non-empty folder (use recursive to force).");
    }
    const view = this.view(id, true);
    const parentId = node.parentId!;
    const index = this.indexOf(node);
    this.node(parentId).children!.splice(index, 1);
    const drop = (n: Stored): void => {
      this.nodes.delete(n.id);
      for (const c of n.children ?? []) drop(this.node(c));
    };
    drop(node);
    // One event for the whole folder in both browsers; only Chrome says what was in it.
    if (this.flavour === 'firefox') delete view.children;
    this.emit(this.onRemoved, id, { parentId, index, node: view });
  }

  // ---- For tests: finding things by path, and seeing the tree at a glance.

  /** The child of `parentId` with this title, if any. */
  child(parentId: string, title: string): BookmarkTreeNode | undefined {
    const id = this.node(parentId).children!.find((c) => this.nodes.get(c)?.title === title);
    return id === undefined ? undefined : this.view(id, true);
  }

  /** A folder or bookmark by the titles of its folders from "Other bookmarks" down. */
  at(...titles: string[]): BookmarkTreeNode | undefined {
    let id: string | undefined = this.otherId;
    for (const title of titles) {
      id = id === undefined ? undefined : this.child(id, title)?.id;
    }
    return id === undefined ? undefined : this.view(id, true);
  }

  /**
   * A folder's contents as plain data: each subfolder's name maps to its own
   * outline, each bookmark to its URL, as "title → url" lines.
   */
  outline(id: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const lines: string[] = [];
    for (const c of this.node(id).children ?? []) {
      const child = this.node(c);
      if (child.children) out[child.title] = this.outline(c);
      else lines.push(`${child.title} → ${child.url}`);
    }
    if (lines.length > 0) out['*'] = lines;
    return out;
  }
}

type SyncOp =
  | { kind: 'create'; id: string; node: BookmarkTreeNode }
  | { kind: 'change'; id: string; info: { title: string; url?: string } }
  | { kind: 'move'; id: string; info: { parentId: string; index: number } }
  | { kind: 'remove'; id: string };

/**
 * The browser's own sync (Chrome Sync, Firefox Sync) between two profiles.
 * What happens to one tree, by the person or by an extension, is done to the
 * other when deliver() is called, as sync does a moment later, and fires the
 * same events there, where an extension can't tell it from the person. Node
 * ids differ between the two, as they do between devices.
 */
export class BrowserSync {
  /** For each side, its ids to the other side's. */
  private readonly ids: [Map<string, string>, Map<string, string>] = [new Map(), new Map()];
  private readonly pending: [SyncOp[], SyncOp[]] = [[], []];
  /** Events sync itself caused, per side, not to be sent back. */
  private readonly own: [Map<string, number>, Map<string, number>] = [new Map(), new Map()];

  constructor(readonly trees: [BookmarkTree, BookmarkTree]) {
    // The root folders are the same everywhere.
    for (const id of trees[0].nodes.keys()) {
      this.ids[0].set(id, id);
      this.ids[1].set(id, id);
    }
    trees.forEach((tree, side) => {
      const note = (op: SyncOp): void => {
        const n = this.own[side]!.get(op.id) ?? 0;
        if (n > 0) this.own[side]!.set(op.id, n - 1);
        else this.pending[side]!.push(op);
      };
      tree.onCreated.push((id, node) => note({ kind: 'create', id, node }));
      tree.onChanged.push((id, info) => note({ kind: 'change', id, info }));
      tree.onMoved.push((id, info) => note({ kind: 'move', id, info }));
      tree.onRemoved.push((id) => note({ kind: 'remove', id }));
    });
  }

  /** Brings what changed on side `from` since the last delivery to the other side. */
  deliver(from: 0 | 1): void {
    const to = from === 0 ? 1 : 0;
    const tree = this.trees[to];
    const there = (id: string | undefined): string | undefined => {
      const mapped = id === undefined ? undefined : this.ids[from].get(id);
      return mapped !== undefined && tree.nodes.has(mapped) ? mapped : undefined;
    };
    const expect = (id: string): void => { this.own[to].set(id, (this.own[to].get(id) ?? 0) + 1); };
    for (const op of this.pending[from].splice(0)) {
      if (op.kind === 'create') {
        const parentId = there(op.node.parentId);
        if (parentId === undefined) continue;
        const made = tree.create({ parentId, title: op.node.title, url: op.node.url });
        this.ids[from].set(op.id, made.id);
        this.ids[to].set(made.id, op.id);
        expect(made.id);
        continue;
      }
      const id = there(op.id);
      if (id === undefined) continue;
      if (op.kind === 'change') {
        const before = tree.view(id);
        const after = tree.update(id, op.info.url === undefined ? { title: op.info.title } : op.info);
        if (before.title !== after.title || before.url !== after.url) expect(id);
      } else if (op.kind === 'move') {
        const parentId = there(op.info.parentId);
        if (parentId === undefined) continue;
        const before = tree.view(id);
        const after = tree.move(id, { parentId, index: op.info.index });
        if (before.parentId !== after.parentId || before.index !== after.index) expect(id);
      } else {
        tree.remove(id, true);
        expect(id);
      }
    }
  }
}

/** The chrome.bookmarks namespace over a tree: vi.fn calls, promise-based like MV3's. */
export function bookmarksApi(tree: BookmarkTree) {
  const listeners = <L>(list: L[]) => ({
    listeners: list,
    addListener: vi.fn((listener: L) => { list.push(listener); }),
    removeListener: vi.fn((listener: L) => {
      const at = list.indexOf(listener);
      if (at >= 0) list.splice(at, 1);
    }),
    hasListener: vi.fn((listener: L) => list.includes(listener)),
  });
  return {
    /** The tree itself, for arranging, acting as the person, and asserting. */
    tree,
    getTree: vi.fn(async (): Promise<unknown[]> => [tree.view(tree.rootId, true)]),
    getSubTree: vi.fn(async (id: string): Promise<BookmarkTreeNode[]> => [tree.view(id, true)]),
    getChildren: vi.fn(async (id: string): Promise<BookmarkTreeNode[]> => {
      const children = tree.view(id, true).children;
      if (!children) throw new Error("Can't find bookmark for id.");
      return children.map(({ children: _, ...node }) => node);
    }),
    get: vi.fn(async (ids: string | string[]): Promise<BookmarkTreeNode[]> => [ids].flat().map((id) => tree.view(id))),
    create: vi.fn(async (details: { parentId?: string; index?: number; title?: string; url?: string }) => tree.create(details)),
    update: vi.fn(async (id: string, changes: { title?: string; url?: string }) => tree.update(id, changes)),
    move: vi.fn(async (id: string, destination: { parentId?: string; index?: number }) => tree.move(id, destination)),
    remove: vi.fn(async (id: string) => { tree.remove(id); }),
    removeTree: vi.fn(async (id: string) => { tree.remove(id, true); }),
    onCreated: listeners(tree.onCreated),
    onChanged: listeners(tree.onChanged),
    onMoved: listeners(tree.onMoved),
    onRemoved: listeners(tree.onRemoved),
  };
}
