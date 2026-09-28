/** Whether the server can save this: it takes http and https links only. */
export function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value.trim());
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const OPENERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

const count = (text: string, char: string) => text.split(char).length - 1;

/**
 * Drops the punctuation that ends a sentence after a link, and closing
 * brackets the link did not open itself (so a Wikipedia "(film)" link keeps its own).
 */
function trimTrailing(candidate: string): string {
  let url = candidate;
  while (url) {
    const last = url.at(-1)!;
    const opener = OPENERS[last];
    const unbalanced = opener !== undefined && count(url, last) > count(url, opener);
    if (!unbalanced && !`.,;:!?'"…`.includes(last)) break;
    url = url.slice(0, -1);
  }
  return url;
}

/** The first http(s) link in free text, or ''. */
export function firstWebUrl(text: string): string {
  for (const [match] of text.matchAll(/https?:\/\/[^\s<>"]+/gi)) {
    const url = trimTrailing(match);
    if (isWebUrl(url)) return url;
  }
  return '';
}

export interface Capture {
  url: string;
  title: string;
}

/**
 * What /save starts from. Android's share sheet has no url field, so a share
 * target gets the link in `text` or, now and then, in `title`
 * (https://developer.chrome.com/docs/capabilities/web-apis/web-share-target).
 */
export function captureFromParams(params: URLSearchParams): Capture {
  const title = params.get('title')?.trim() ?? '';
  const url =
    params.get('url')?.trim() || firstWebUrl(params.get('text') ?? '') || firstWebUrl(title);
  return { url, title: title === url ? '' : title };
}
