// Desktop session commands and layouts are defined in Chromium's
// components/sessions/core/session_service_commands.cc.
const command = {
  tabWindow: 0, tabPosition: 2, pruneBack: 5, navigation: 6, selectedNavigation: 7,
  windowType: 9, pruneFront: 11, pinned: 12, tabClosed: 16, windowClosed: 17,
  prune: 24, tabGroup: 25, groupMetadata: 27, windowTitle: 31, marker: 255,
} as const;

// Bounds, selected tab, app IDs, workspace, split layout, and other state that
// does not change the window's tab list, order, groups, or selected navigation.
const ignoredCommands = new Set([1, 8, 10, 13, 14, 15, 18, 19, 20, 21, 22, 23, 28, 29, 30, 32, 33, 34, 35, 36, 37]);

export class ChromeSessionError extends Error {}

class Pickle {
  #offset = 4;

  constructor(private readonly data: Buffer) {
    if (data.length < 4 || data.readUInt32LE(0) !== data.length - 4) {
      throw new ChromeSessionError('Invalid Chrome Pickle header');
    }
  }

  #take(size: number): Buffer {
    const end = this.#offset + size;
    const paddedEnd = Math.ceil(end / 4) * 4;
    if (size < 0 || paddedEnd > this.data.length) throw new ChromeSessionError('Invalid Chrome Pickle field length');
    const bytes = this.data.subarray(this.#offset, end);
    this.#offset = paddedEnd;
    return bytes;
  }

  get hasMore(): boolean { return this.#offset < this.data.length; }
  int(): number { return this.#take(4).readInt32LE(); }
  token(): string { return token(this.#take(16)); }
  string(encoding: 'utf8' | 'utf16le' = 'utf8'): string {
    return this.#take(this.int() * (encoding === 'utf16le' ? 2 : 1)).toString(encoding);
  }
  skipString(): void { this.#take(this.int()); }
}

function token(bytes: Buffer): string {
  return bytes.readBigUInt64LE(0).toString(16).padStart(16, '0') + bytes.readBigUInt64LE(8).toString(16).padStart(16, '0');
}

interface Navigation { url: string | null; title: string | null }
interface TabState {
  id: number;
  windowId: number | null;
  position: number | null;
  groupId: string | null;
  pinned: boolean;
  selected: number;
  navigations: Map<number, Navigation>;
}
interface Group { id: string; name: string | null; color: number | null; collapsed: boolean | null }
interface WindowState { id: number; name: string | null; type: number | null }
interface Tab extends Navigation {
  id: number;
  position: number | null;
  groupId: string | null;
  pinned: boolean;
  navigation: 'selected' | 'fallback' | 'missing';
}
interface Window extends WindowState { tabs: Tab[]; groups: Group[] }

function pruneNavigations(tab: TabState, start: number, count: number): void {
  if (start < 0 || count <= 0) throw new ChromeSessionError('Invalid navigation removal');
  const end = start + count;
  if (tab.selected >= end) tab.selected -= count;
  else if (tab.selected >= start) tab.selected = start - 1;
  tab.navigations = new Map([...tab.navigations].flatMap(([index, navigation]) => {
    if (index >= start && index < end) return [];
    return [[index < end ? index : index - count, navigation]];
  }));
}

function currentTab(tab: TabState): Tab {
  const indices = [...tab.navigations.keys()].sort((a, b) => a - b);
  // Chrome picks the first saved index at or after the selected index, or the
  // last one when the selected page was omitted from the session file.
  const index = indices.find(index => index >= tab.selected) ?? indices.at(-1);
  const entry = index === undefined ? undefined : tab.navigations.get(index);
  return {
    id: tab.id, position: tab.position, groupId: tab.groupId, pinned: tab.pinned,
    title: entry?.title ?? null, url: entry?.url ?? null,
    navigation: !entry ? 'missing' : index === tab.selected ? 'selected' : 'fallback',
  };
}

export function readChromeSession(file: Buffer): { windows: Window[]; partialReason: string | null } {
  if (file.length < 8 || file.toString('ascii', 0, 4) !== 'SNSS') throw new ChromeSessionError('Invalid SNSS header');
  const version = file.readUInt32LE(4);
  if ([2, 4, 5].includes(version)) throw new ChromeSessionError(`Encrypted SNSS version ${version}`);
  if (version !== 3) throw new ChromeSessionError(`Unsupported SNSS version ${version}`);

  const tabs = new Map<number, TabState>();
  const windows = new Map<number, WindowState>();
  const groups = new Map<string, Group>();
  const closedWindows = new Set<number>();
  let hasMarker = false;
  let partialReason: string | null = null;

  function getTab(id: number): TabState {
    const existing = tabs.get(id);
    if (existing) return existing;
    const tab = { id, windowId: null, position: null, groupId: null, pinned: false, selected: -1, navigations: new Map() };
    tabs.set(id, tab);
    return tab;
  }

  function getWindow(id: number): WindowState {
    const existing = windows.get(id);
    if (existing) return existing;
    const window = { id, name: null, type: null };
    windows.set(id, window);
    return window;
  }

  function apply(id: number, data: Buffer): void {
    function fixedSize(...sizes: number[]): void {
      if (!sizes.includes(data.length)) throw new ChromeSessionError(`Invalid payload size for SNSS command ${id}`);
    }
    switch (id) {
      case command.marker:
        fixedSize(0);
        hasMarker = true;
        break;
      case command.tabWindow:
        fixedSize(8);
        getTab(data.readInt32LE(4)).windowId = data.readInt32LE(0);
        break;
      case command.tabPosition:
        fixedSize(8);
        getTab(data.readInt32LE(0)).position = data.readInt32LE(4);
        break;
      case command.selectedNavigation:
        fixedSize(8);
        getTab(data.readInt32LE(0)).selected = data.readInt32LE(4);
        break;
      case command.navigation: {
        const entry = new Pickle(data);
        const tabId = entry.int();
        const index = entry.int();
        const url = entry.string() || null;
        const title = entry.string('utf16le') || null;
        entry.skipString(); // Encoded page state can contain private form data.
        entry.int(); // Transition type.
        getTab(tabId).navigations.set(index, { url, title });
        break;
      }
      case command.pruneBack: {
        fixedSize(8);
        const tab = getTab(data.readInt32LE(0));
        const first = data.readInt32LE(4);
        for (const index of tab.navigations.keys()) if (index >= first) tab.navigations.delete(index);
        break;
      }
      case command.pruneFront:
      case command.prune:
        fixedSize(id === command.prune ? 12 : 8);
        pruneNavigations(getTab(data.readInt32LE(0)), id === command.prune ? data.readInt32LE(4) : 0, data.readInt32LE(data.length - 4));
        break;
      case command.windowType:
        fixedSize(8);
        getWindow(data.readInt32LE(0)).type = data.readInt32LE(4);
        break;
      case command.windowTitle: {
        const entry = new Pickle(data);
        const windowId = entry.int();
        getWindow(windowId).name = entry.string() || null;
        break;
      }
      case command.pinned:
        fixedSize(8);
        getTab(data.readInt32LE(0)).pinned = data[4] !== 0;
        break;
      case command.tabClosed:
        fixedSize(12, 16);
        tabs.delete(data.readInt32LE(0));
        break;
      case command.windowClosed:
        fixedSize(12, 16);
        closedWindows.add(data.readInt32LE(0));
        break;
      case command.tabGroup: {
        fixedSize(24, 32);
        const offset = data.length === 32 ? 8 : 4; // Native uint64 alignment.
        getTab(data.readInt32LE(0)).groupId = data[offset + 16] ? token(data.subarray(offset)) : null;
        break;
      }
      case command.groupMetadata: {
        const entry = new Pickle(data);
        const groupId = entry.token();
        const name = entry.string('utf16le');
        const color = entry.int();
        const collapsed = entry.hasMore ? entry.int() !== 0 : null;
        groups.set(groupId, { id: groupId, name, color, collapsed });
        break;
      }
      default:
        if (!ignoredCommands.has(id)) throw new ChromeSessionError(`Unknown SNSS command ${id}`);
    }
  }

  for (let offset = 8; offset < file.length;) {
    const size = offset + 2 <= file.length ? file.readUInt16LE(offset) : 0;
    const end = offset + 2 + size;
    if (!size || end > file.length) {
      partialReason = 'Incomplete SNSS command at end of file';
      break;
    }
    try {
      apply(file[offset + 2]!, file.subarray(offset + 3, end));
    } catch (error) {
      if (!(error instanceof ChromeSessionError)) throw error;
      partialReason = error.message;
      break;
    }
    offset = end;
  }
  if (!hasMarker) throw new ChromeSessionError(partialReason ?? 'Missing SNSS initial snapshot marker');

  const byWindow = new Map<number, Tab[]>();
  for (const tab of tabs.values()) {
    if (!tab.windowId || closedWindows.has(tab.windowId) || windows.get(tab.windowId)?.type == null) continue;
    const windowTabs = byWindow.get(tab.windowId) ?? [];
    windowTabs.push(currentTab(tab));
    byWindow.set(tab.windowId, windowTabs);
  }
  const restored = [...byWindow.entries()].sort(([a], [b]) => a - b).map(([id, windowTabs]) => {
    windowTabs.sort((a, b) => (a.position ?? -1) - (b.position ?? -1) || a.id - b.id);
    const groupIds = new Set(windowTabs.flatMap(tab => tab.groupId === null ? [] : [tab.groupId]));
    return {
      ...windows.get(id)!, tabs: windowTabs,
      groups: [...groupIds].map(id => groups.get(id) ?? { id, name: null, color: null, collapsed: null }),
    };
  });
  return { windows: restored, partialReason };
}
