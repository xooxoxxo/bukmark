import { describe, expect, it, vi } from 'vitest';
import { bookmarklet } from './bookmarklet';
import { captureFromParams } from './capture';

const ORIGIN = 'https://bukmark.example:8443';

/** Runs a bookmarklet the way a browser does: percent-decoded, inside the page. */
function click(href: string, page: { url: string; title: string }) {
  expect(href.startsWith('javascript:')).toBe(true);
  const open = vi.fn(() => null);
  const code = decodeURIComponent(href.slice('javascript:'.length));
  const result: unknown = new Function('window', 'location', 'document', `return ${code}`)(
    { open },
    { href: page.url },
    { title: page.title },
  );
  return { open, result };
}

describe('bookmarklet', () => {
  const page = {
    url: 'https://news.example/story?id=7&utm_source=x#comments',
    title: 'Rock & "Roll" — 100% ü',
  };

  it("opens this server's /save for the page it is clicked on, in a window of its own", () => {
    const { open, result } = click(bookmarklet(ORIGIN), page);

    expect(open).toHaveBeenCalledTimes(1);
    const [target, name, features] = open.mock.calls[0] as unknown as [string, string, string];
    const opened = new URL(target);
    expect(opened.origin).toBe(ORIGIN);
    expect(opened.pathname).toBe('/save');
    expect(captureFromParams(opened.searchParams)).toEqual(page);
    expect(name).toBe('_blank');
    expect(features.split(',')).toContain('noopener');
    // A javascript: URL that evaluates to a string replaces the page with it.
    expect(result).toBeUndefined();
  });

  it('holds nothing but code and the server origin', () => {
    const href = bookmarklet(ORIGIN);
    expect(href).not.toMatch(/bkm_|token|authorization|cookie/i);
    expect(href.match(/https?:\/\/[^'"]+/g)).toEqual([`${ORIGIN}/save?url=`]);
  });
});
