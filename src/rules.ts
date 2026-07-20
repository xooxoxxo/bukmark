export type JunkVerdict = { junk: false } | { junk: true; rule: string };

const BROWSER_SCHEMES = /^(chrome|chrome-extension|about|edge|brave|file):/i;
const AUTH_PATH = /\/(login|log-in|signin|sign-in|signup|sign-up|auth)(\/|$)/i;
const PRIVATE_HOST = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

export function nonHttpRule(raw: string): string {
  return BROWSER_SCHEMES.test(raw.trim()) ? 'browser-internal' : 'non-http';
}

export function parseAllowlist(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

export function isAllowed(url: string, allowlist: string[]): boolean {
  return allowlist.some((entry) =>
    entry.endsWith('*') ? url.startsWith(entry.slice(0, -1)) : url === entry,
  );
}

export function classifyJunk(normalizedUrl: string, allowlist: string[]): JunkVerdict {
  if (isAllowed(normalizedUrl, allowlist)) return { junk: false };
  const u = new URL(normalizedUrl);
  const host = u.hostname;
  if (host === 'mail.google.com') return { junk: true, rule: 'gmail' };
  if (/^google\.[a-z.]+$/.test(host) && u.pathname === '/search')
    return { junk: true, rule: 'google-search' };
  if (host === 'calendar.google.com') return { junk: true, rule: 'google-calendar' };
  if (host === 'meet.google.com') return { junk: true, rule: 'google-meet' };
  if (host === 'accounts.google.com') return { junk: true, rule: 'google-accounts' };
  if (PRIVATE_HOST.test(host)) return { junk: true, rule: 'local' };
  if (AUTH_PATH.test(u.pathname)) return { junk: true, rule: 'auth-page' };
  return { junk: false };
}
