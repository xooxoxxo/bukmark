import type { QuoteDto } from '../api/types';

/**
 * A page's address as a reader would cite it: host and path, without the
 * scheme, a leading `www.`, the query or the fragment. A site root is the bare
 * host.
 */
export function sourceAddress(url: string): string {
  let host: string;
  let path: string;
  try {
    const parsed = new URL(url);
    host = parsed.host;
    path = parsed.pathname === '/' ? '' : parsed.pathname;
  } catch {
    // Not parseable: strip what can be stripped and keep the rest as saved.
    const bare = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    const slash = bare.indexOf('/');
    host = slash === -1 ? bare : bare.slice(0, slash);
    path = slash === -1 ? '' : bare.slice(slash).replace(/[?#].*$/, '');
    if (path === '/') path = '';
  }
  return host.replace(/^www\./i, '') + path;
}

/**
 * A quote as Copy puts it on the clipboard:
 *
 *     "The quoted passage."
 *     — Page title, example.com/article
 *
 * The dash line is the address alone when the page had no title.
 */
export function copyText(quote: Pick<QuoteDto, 'text' | 'sourceTitle' | 'sourceUrl'>): string {
  const title = quote.sourceTitle.trim();
  const address = sourceAddress(quote.sourceUrl);
  return `"${quote.text}"\n— ${title ? `${title}, ${address}` : address}`;
}
