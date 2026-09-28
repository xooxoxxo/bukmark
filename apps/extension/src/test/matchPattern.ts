// scheme://host/path, with the host a name, *.name, * or [IPv6] — never a
// port, which Firefox never matches and Safari rejects (see lib/permissions.ts).
const PATTERN = /^(\*|https?):\/\/(\*|\*\.[^/*:[\]]+|[^/*:[\]]+|\[[0-9a-f:.]+\])(\/.*)$/i;

/** True for an http(s) match pattern that Chrome, Firefox and Safari all accept and honour. */
export function validEverywhere(pattern: string): boolean {
  return PATTERN.test(pattern);
}

const glob = (path: string): RegExp =>
  new RegExp(`^${path.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

/**
 * Whether a match pattern gives access to a URL in every browser the extension
 * is built for: a pattern without a port matches its host on any port in all
 * three, and one with a port matches nothing in Firefox or Safari.
 */
export function matchesEverywhere(pattern: string, url: string): boolean {
  const parts = PATTERN.exec(pattern);
  if (!parts) return false;
  const [, scheme = '', host = '', path = ''] = parts;
  const target = new URL(url);
  const schemeMatches = scheme === '*'
    ? target.protocol === 'http:' || target.protocol === 'https:'
    : target.protocol === `${scheme.toLowerCase()}:`;
  const wanted = host.toLowerCase();
  const hostMatches = wanted === '*'
    || target.hostname === wanted
    || (wanted.startsWith('*.') && (target.hostname === wanted.slice(2) || target.hostname.endsWith(wanted.slice(1))));
  return schemeMatches && hostMatches && glob(path).test(target.pathname + target.search);
}
