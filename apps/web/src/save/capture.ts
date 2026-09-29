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

/** Two addresses for the same page: scheme, `www.`, a trailing slash and the fragment aside. */
function samePage(a: string, b: string): boolean {
  const key = (value: string) => {
    const u = new URL(value);
    const path = u.pathname.replace(/\/$/, '');
    return `${u.hostname.replace(/^www\./, '')}${path}${u.search}`;
  };
  try {
    return key(a) === key(b);
  } catch {
    return false;
  }
}

/** Quote marks around the whole text, as Chrome wraps a shared selection. */
const WRAPPED = /^(["“«])([\s\S]*)(["”»])$/;

/**
 * The passage a share carried, or '' when it carried none. Chrome on Android
 * sends a selection in `text` with the page's link at its end: with `url`
 * empty, that link is a text-fragment link (`#:~:text=`) and the selection is
 * wrapped in quote marks. The link and the marks are not part of the passage.
 *
 * With `url` given, any other text is a passage. With `url` empty, most apps
 * share "Headline https://…" the same way, so the text counts as a passage
 * only when one of Chrome's selection signs is there. Text that is only a
 * link, or only the page's title, is a plain link share. A passage needs a
 * page it came from.
 */
export function quoteFromParams(params: URLSearchParams, capture: Capture): string {
  if (!isWebUrl(capture.url)) return '';
  const urlGiven = Boolean(params.get('url')?.trim());
  let text = (params.get('text') ?? '').trim();
  let fragment = false;
  const trailing = /\s*(https?:\/\/\S+)$/i.exec(text);
  if (trailing) {
    const link = trimTrailing(trailing[1]!);
    if (samePage(link, capture.url)) {
      fragment = link.includes('#:~:text=');
      text = text.slice(0, trailing.index).trim();
    }
  }
  const wrapped = WRAPPED.exec(text);
  if (!urlGiven && !fragment && !wrapped) return '';
  if (wrapped && !/["“”«»]/.test(wrapped[2]!)) text = wrapped[2]!.trim();
  if (!text || /^https?:\/\/\S+$/i.test(text) || text === capture.title) return '';
  return text;
}
