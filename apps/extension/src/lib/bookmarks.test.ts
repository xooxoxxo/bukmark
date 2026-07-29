import { describe, expect, it } from 'vitest';
import { chunk, flattenBookmarks, type BookmarkNode } from './bookmarks';

// Mirrors chrome.bookmarks.getTree(): a single unnamed root whose children are
// the named top-level folders.
const TREE: BookmarkNode[] = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: 'Bookmarks Bar',
        children: [
          { id: '3', title: 'Rust', url: 'https://rust-lang.org' },
          {
            id: '4',
            title: 'Dev',
            children: [
              { id: '5', title: 'Fastify', url: 'https://fastify.dev' },
              { id: '6', title: 'Empty Folder', children: [] },
            ],
          },
        ],
      },
      { id: '2', title: 'Other Bookmarks', children: [] },
    ],
  },
];

describe('flattenBookmarks', () => {
  it('returns one entry per bookmark, ignoring folders', () => {
    expect(flattenBookmarks(TREE)).toHaveLength(2);
  });

  it('joins ancestor folder names into folderPath and skips the unnamed root', () => {
    const flat = flattenBookmarks(TREE);
    expect(flat.find((b) => b.url === 'https://rust-lang.org')!.folderPath).toBe('Bookmarks Bar');
    expect(flat.find((b) => b.url === 'https://fastify.dev')!.folderPath).toBe('Bookmarks Bar/Dev');
  });

  it('keeps the bookmark title', () => {
    expect(flattenBookmarks(TREE)[0]!.title).toBe('Rust');
  });

  it('drops non-http entries such as chrome:// pages and bookmarklets', () => {
    const flat = flattenBookmarks([
      { id: '1', title: 'Root', children: [
        { id: '2', title: 'Settings', url: 'chrome://settings' },
        { id: '3', title: 'Bookmarklet', url: 'javascript:void(0)' },
        { id: '4', title: 'Real', url: 'https://real.com' },
      ] },
    ]);
    expect(flat.map((b) => b.url)).toEqual(['https://real.com']);
  });

  it('handles an empty tree', () => {
    expect(flattenBookmarks([])).toEqual([]);
  });

  it('gives a top-level bookmark an empty folderPath', () => {
    const flat = flattenBookmarks([{ id: '0', title: '', children: [{ id: '1', title: 'Loose', url: 'https://loose.com' }] }]);
    expect(flat[0]!.folderPath).toBe('');
  });
});

describe('chunk', () => {
  it('splits into batches of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns a single batch when everything fits', () => {
    expect(chunk([1, 2], 200)).toEqual([[1, 2]]);
  });

  it('returns nothing for an empty list', () => {
    expect(chunk([], 10)).toEqual([]);
  });
});
