import { describe, expect, it, vi } from 'vitest';
import { BookmarkTree } from './bookmarks';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// The fake stands in for the browser in every sync test: these hold it to
// what Chrome and Firefox do.
describe('the fake bookmark tree', () => {
  it('starts with each browser’s root folders, which cannot be changed', () => {
    const chrome = new BookmarkTree('chrome');
    expect(chrome.view('0', true).children!.map((c) => [c.id, c.title, c.folderType])).toEqual([
      ['1', 'Bookmarks bar', 'bookmarks-bar'], ['2', 'Other bookmarks', 'other'], ['3', 'Mobile bookmarks', 'mobile'],
    ]);
    expect(() => chrome.update('2', { title: 'x' })).toThrow("Can't modify the root bookmark folders.");
    expect(() => chrome.remove('1', true)).toThrow("Can't modify the root bookmark folders.");
    const firefox = new BookmarkTree('firefox');
    expect(firefox.view('root________', true).children!.map((c) => c.id))
      .toEqual(['menu________', 'toolbar_____', 'unfiled_____', 'mobile______']);
  });

  it('fires one onRemoved for a folder: Chrome’s node carries its contents, Firefox’s does not', async () => {
    for (const flavour of ['chrome', 'firefox'] as const) {
      const tree = new BookmarkTree(flavour);
      const listener = vi.fn();
      tree.onRemoved.push(listener);
      const folder = tree.create({ title: 'f' });
      tree.create({ parentId: folder.id, title: 'a', url: 'https://a.com/' });
      expect(() => tree.remove(folder.id)).toThrow("Can't remove non-empty folder (use recursive to force).");
      tree.remove(folder.id, true);
      await settle();
      expect(listener).toHaveBeenCalledTimes(1);
      const [, info] = listener.mock.calls[0]!;
      expect(info).toMatchObject({ parentId: tree.otherId, index: 0 });
      expect(info.node.children?.map((c: { title: string }) => c.title)).toEqual(flavour === 'chrome' ? ['a'] : undefined);
    }
  });

  it('fires nothing for a change that changes nothing, and delivers events after the call', async () => {
    const tree = new BookmarkTree();
    const changed = vi.fn();
    const moved = vi.fn();
    tree.onChanged.push(changed);
    tree.onMoved.push(moved);
    const node = tree.create({ title: 'a', url: 'https://a.com/' });
    tree.update(node.id, { title: 'a' });
    tree.move(node.id, { parentId: tree.otherId });
    await settle();
    expect(changed).not.toHaveBeenCalled();
    expect(moved).not.toHaveBeenCalled();

    tree.update(node.id, { title: 'b' });
    expect(changed).not.toHaveBeenCalled();
    await settle();
    expect(changed).toHaveBeenCalledWith(node.id, { title: 'b', url: 'https://a.com/' });
    tree.move(node.id, { parentId: '1' });
    await settle();
    expect(moved).toHaveBeenCalledWith(node.id, { parentId: '1', index: 0, oldParentId: '2', oldIndex: 0 });
  });
});
