/** Subset of chrome.bookmarks.BookmarkTreeNode that we actually rely on. */
export interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
}

export interface FlatBookmark {
  url: string;
  title: string;
  /** Ancestor folder names joined with "/", e.g. "Bookmarks Bar/Dev". */
  folderPath: string;
}

/**
 * Flatten a browser bookmark tree.
 *
 * Folders are NOT mapped to hubs — the path travels along as a hint only, so
 * an old and probably stale organisation does not get imported wholesale.
 * Non-http entries (chrome:// pages, javascript: bookmarklets) are dropped
 * here rather than sent for the server to reject, so the import summary
 * reports real problems instead of routine noise.
 */
export function flattenBookmarks(nodes: BookmarkNode[]): FlatBookmark[] {
  const out: FlatBookmark[] = [];

  function walk(node: BookmarkNode, path: string[]): void {
    if (node.url !== undefined) {
      if (/^https?:\/\//i.test(node.url)) {
        out.push({ url: node.url, title: node.title ?? '', folderPath: path.join('/') });
      }
      return;
    }
    // The tree root has an empty title; including it would prefix every path.
    const next = node.title ? [...path, node.title] : path;
    for (const child of node.children ?? []) walk(child, next);
  }

  for (const node of nodes) walk(node, []);
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
