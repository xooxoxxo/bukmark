import { classifyHost } from './ssrfGuard.js';

const HEAD_BYTES = 65536;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;
const UA = 'Mozilla/5.0 (compatible; bukmark/1.0; +https://bukmark.it)';

/** Why a page gave no HTTP answer. */
export type PageError = 'dns' | 'blocked' | 'timeout' | 'network' | 'redirects';

export interface PageFetch {
  /** The final HTTP status after redirects; null when no response came. */
  status: number | null;
  error: PageError | null;
  /** The body, up to the byte cap, when the page answered 2xx with HTML or text. */
  html: string | null;
  /** Where the redirects ended. */
  url: string;
}

async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}

/**
 * Fetches a page the way a check needs it: its final status, and its HTML up
 * to `maxBytes`. Guards against SSRF: only http(s), and every hop's host must
 * resolve to a public address. Redirects are followed manually so each
 * Location is re-validated before it is fetched.
 */
export async function fetchPage(rawUrl: string, maxBytes: number): Promise<PageFetch> {
  let url = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { status: null, error: 'network', html: null, url };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { status: null, error: 'blocked', html: null, url };
    }
    const host = await classifyHost(parsed.hostname);
    if (host !== 'public') {
      const error = host === 'unresolved' ? 'dns' : host === 'private' ? 'blocked' : 'network';
      return { status: null, error, html: null, url };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: 'text/html,*/*' },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!loc) return { status: res.status, error: null, html: null, url };
        url = new URL(loc, url).toString();
        continue;
      }
      const type = res.headers.get('content-type') ?? '';
      const readable = res.ok && (type === '' || /html|text\/plain|xml/i.test(type));
      const html = readable ? await readCapped(res, maxBytes) : null;
      if (!readable) await res.body?.cancel().catch(() => undefined);
      return { status: res.status, error: null, html, url };
    } catch {
      return { status: null, error: ctrl.signal.aborted ? 'timeout' : 'network', html: null, url };
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: null, error: 'redirects', html: null, url };
}

// Up to 64KB of a page's HTML, for its og:image: enough for any <head>.
export async function fetchHead(rawUrl: string): Promise<string | null> {
  return (await fetchPage(rawUrl, HEAD_BYTES)).html;
}
