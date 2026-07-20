import { createHash } from 'node:crypto';

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'twclid', 'igshid',
  'mc_cid', 'mc_eid', 'ref', '_hsenc', '_hsmi', 'mkt_tok',
]);

export type NormalizeResult =
  | { ok: true; url: string; urlHash: string }
  | { ok: false; reason: 'unparseable' | 'non-http' };

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function normalizeUrl(raw: string): NormalizeResult {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'non-http' };
  }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...u.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (TRACKING_PARAMS.has(k) || k.startsWith('utm_')) u.searchParams.delete(key);
  }
  if (u.pathname === '') u.pathname = '/';
  let url = u.toString();
  if (url.endsWith('?')) url = url.slice(0, -1);
  return { ok: true, url, urlHash: sha256Hex(url) };
}
