import { resolvesToPublic } from './ssrfGuard.js';

const MAX_BYTES = 65536;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;
const UA = 'Mozilla/5.0 (compatible; bukmark-og/1.0)';

async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).toString('utf8');
}

// Fetch up to 64KB of a page's HTML. Guards against SSRF: only http(s), and
// every hop's host must resolve to a public address. Redirects are followed
// manually so each Location is re-validated before it is fetched.
export async function fetchHead(rawUrl: string): Promise<string | null> {
  let url = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!(await resolvesToPublic(parsed.hostname))) return null;

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
        if (!loc) return null;
        url = new URL(loc, url).toString();
        continue;
      }
      if (!res.ok) return null;
      return await readCapped(res);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null; // too many redirects
}
