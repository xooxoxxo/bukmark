/**
 * Compute a matching key for near-duplicates: normalize host, path, and params.
 * Two URLs with the same matchKey are treated as the same link.
 *
 * Removes: www., m., mobile., amp. subdomains; /amp path segment; trailing slash (root stays /);
 * and AMP-related query params (amp, amp=1, outputType=amp).
 * Keeps other query params sorted for stable matching.
 * Protocol (http vs https) is NOT part of the key; they match together.
 * Fragment is never part of the key.
 *
 * Examples:
 *   https://example.com/page and http://example.com/page => same key
 *   https://example.com/page and https://m.example.com/page => same key
 *   https://example.com/page and https://example.com/page/ => same key
 *   https://example.com/page?v=1 and https://example.com/page?v=2 => different keys
 */
export function matchKey(url: string): string {
  const u = new URL(url);
  let host = u.hostname.toLowerCase();

  // Strip www., m., mobile., amp. subdomains
  host = host.replace(/^(www|m|mobile|amp)\./, '');

  // Strip /amp path segment (only a whole segment: /amp or /amp/ — not /amp-guide)
  // and remove trailing slash (root stays /)
  let pathname = u.pathname.replace(/\/amp(?:[/?#]|$)/, '/').replace(/\/$/, '') || '/';

  // Remove AMP-related params, keep others sorted
  const params = new URLSearchParams();

  for (const [key, value] of u.searchParams) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'amp' || (lowerKey === 'outputtype' && value.toLowerCase() === 'amp')) {
      continue; // Skip AMP params
    }
    params.append(key, value);
  }

  // Sort params for consistent matching
  const sortedParams = new URLSearchParams([...params].sort());
  const queryStr = sortedParams.toString();

  return `//${host}${pathname}${queryStr ? `?${queryStr}` : ''}`;
}
